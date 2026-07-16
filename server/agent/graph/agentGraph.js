/**
 * agentGraph.js
 *
 * ReAct agent graph with OpenAI function calling.
 * Implements a tool-calling loop: LLM → tool calls → LLM → ... → final response.
 * Streams events via callback for SSE support.
 */

import { AGENT_SYSTEM_PROMPT } from '../prompts/agentSystem.js';
import { createSkillContext, createSkillTools, executeTool } from '../skills/registry.js';

const env = (key, fallback) => process.env[key] || fallback;
const getAgentModel = () => env('AGENT_MODEL', env('CHAT_MODEL', 'gpt-5.4'));
const getAgentFallback = () => env('AGENT_FALLBACK_MODEL', env('CHAT_FALLBACK_MODEL', 'gemini-3.1-pro-preview'));
const getChatBaseUrl = () => env('CHAT_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
const getMaxIterations = () => parseInt(env('AGENT_MAX_ITERATIONS', '10'), 10);

/**
 * Call the LLM with tools (OpenAI function calling format).
 */
async function agentLLMCall(messages, tools, apiKey, { model, temperature = 0.7 } = {}) {
    const baseUrl = getChatBaseUrl();
    const useModel = model || getAgentModel();
    const url = `${baseUrl}/chat/completions`;

    const body = {
        model: useModel,
        messages,
        temperature,
        max_completion_tokens: 16384,
    };

    if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error(`[Agent] LLM error ${res.status}: ${errBody.slice(0, 300)}`);
        const err = new Error(`Agent LLM error: ${res.status}`);
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const totalTokens = data.usage?.total_tokens || 0;

    return {
        message: choice?.message || {},
        finishReason: choice?.finish_reason,
        totalTokens,
    };
}

/**
 * Build a multimodal user message that includes canvas images the agent can "see".
 * Selects up to MAX_VISION_IMAGES completed image nodes and attaches them
 * alongside the user's text so the LLM has visual context.
 */
const MAX_VISION_IMAGES = 6;

function buildUserContent(userMessage, canvasState, media) {
    const allNodes = canvasState?.nodes || [];
    const imageNodes = allNodes.filter(n => n.type === 'Image' && n.status === 'success' && n.resultUrl);
    const uploadedImages = Array.isArray(media) ? media.filter(m => m.base64) : [];

    console.log(`[Agent Vision] Canvas: ${allNodes.length} nodes, ${imageNodes.length} completed images | Uploaded: ${uploadedImages.length} images`);

    if (imageNodes.length === 0 && uploadedImages.length === 0) return userMessage;

    const parts = [{ type: 'text', text: userMessage }];

    // Uploaded images first (user explicitly attached these)
    for (let i = 0; i < uploadedImages.length; i++) {
        parts.push({ type: 'text', text: `[Uploaded image ${i + 1}]` });
        parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${uploadedImages[i].base64}` } });
    }

    // Canvas images (auto-attached from completed nodes, skip data URLs to avoid huge payloads)
    const httpImages = imageNodes.filter(n => n.resultUrl && !n.resultUrl.startsWith('data:'));
    const selected = httpImages.slice(-MAX_VISION_IMAGES);
    for (const node of selected) {
        let url = node.resultUrl;
        if (url.includes('aliyuncs.com') && !url.includes('x-oss-process')) {
            const sep = url.includes('?') ? '&' : '?';
            url = `${url}${sep}x-oss-process=image/resize,m_lfit,w_512/quality,Q_80`;
        }
        const label = node.title || node.id;
        parts.push({ type: 'text', text: `[Canvas image "${label}"]` });
        parts.push({ type: 'image_url', image_url: { url } });
    }
    return parts;
}

/**
 * Run the agent ReAct loop.
 *
 * @param {object} params
 * @param {string} params.userMessage - The user's message
 * @param {object[]} params.history - Previous conversation messages [{role, content}]
 * @param {string} params.apiKey - API key for LLM
 * @param {string} params.userId - Current user ID
 * @param {object} params.canvasState - Current canvas state {nodes, groups}
 * @param {function} params.onEvent - SSE event callback: (type, data) => void
 * @returns {object} { response, actions, totalTokens }
 */
export async function runAgent({ userMessage, history = [], apiKey, userId, canvasState, media, onEvent }) {
    const emit = onEvent || (() => {});

    const context = createSkillContext({
        userId,
        apiKey,
        baseUrl: getChatBaseUrl(),
        canvasState,
    });

    const { tools, toolMap } = createSkillTools(context);

    const userContent = buildUserContent(userMessage, canvasState, media);
    const visionImageCount = Array.isArray(userContent)
        ? userContent.filter(p => p.type === 'image_url').length
        : 0;

    const messages = [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userContent },
    ];

    let totalTokens = 0;
    const maxIter = getMaxIterations();
    const toolsUsed = [];

    for (let iteration = 0; iteration < maxIter; iteration++) {
        emit('thinking', { iteration, visionImages: visionImageCount });

        let result;
        try {
            result = await agentLLMCall(messages, tools, apiKey);
        } catch (err) {
            if (err.status === 429 && iteration === 0) {
                emit('thinking', { iteration, fallback: true });
                result = await agentLLMCall(messages, tools, apiKey, { model: getAgentFallback() });
            } else {
                throw err;
            }
        }

        totalTokens += result.totalTokens;
        const { message } = result;

        const toolCalls = message.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
            const content = message.content || '';
            emit('message', { content });
            return {
                response: content,
                actions: context.actions,
                totalTokens,
                toolsUsed,
            };
        }

        messages.push({
            role: 'assistant',
            content: message.content || null,
            tool_calls: toolCalls,
        });

        for (const tc of toolCalls) {
            const toolName = tc.function?.name;
            const toolArgs = tc.function?.arguments || '{}';
            const toolCallId = tc.id;

            emit('tool_start', { tool: toolName, args: toolArgs, callId: toolCallId });

            const toolResult = await executeTool(toolMap, toolName, toolArgs);
            toolsUsed.push({ tool: toolName, resultSummary: (typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)).substring(0, 300) });

            emit('tool_result', { tool: toolName, result: toolResult, callId: toolCallId });

            messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            });
        }
    }

    emit('message', { content: 'Agent reached maximum iterations. Please try a simpler request.' });
    return {
        response: 'Agent reached maximum iterations. Please try a simpler request.',
        actions: context.actions,
        totalTokens,
        toolsUsed,
    };
}
