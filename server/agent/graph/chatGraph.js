/**
 * chatGraph.js
 * 
 * LangGraph state graph for the chat agent.
 * Uses an OpenAI-compatible chat API (configurable via CHAT_BASE_URL).
 * 
 * Primary model: configurable via CHAT_MODEL env var
 * Fallback model: configurable via CHAT_FALLBACK_MODEL env var
 */

import { StateGraph, MessagesAnnotation, END } from "@langchain/langgraph";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { CHAT_AGENT_SYSTEM_PROMPT } from "../prompts/system.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

// Read env vars lazily (ES module imports hoist before dotenv.config() runs)
const env = (key, fallback) => process.env[key] || fallback;
const getChatBaseUrl = () => env('CHAT_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
const getPrimaryModel = () => env('CHAT_MODEL', 'qwen3.6-plus');
const getFallbackModel = () => env('CHAT_FALLBACK_MODEL', 'qwen-plus');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

// ============================================================================
// RETRY HELPER
// ============================================================================

async function retryWithBackoff(fn, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const status = err?.status ?? err?.statusCode ?? 0;
            if (status !== 429 || attempt === retries) throw err;
            const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
            console.warn(`[Retry] Attempt ${attempt + 1}/${retries} failed (429), retrying in ${Math.round(delay)}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// ============================================================================
// OPENAI-COMPATIBLE CHAT
// ============================================================================

function langchainToOpenAI(messages) {
    return messages.map(m => {
        const type = m._getType?.();
        const role = type === 'system' ? 'system' : type === 'ai' ? 'assistant' : 'user';

        if (Array.isArray(m.content)) {
            const parts = m.content.map(p => {
                if (p.type === 'text') return { type: 'text', text: p.text };
                if (p.type === 'image_url') return { type: 'image_url', image_url: p.image_url };
                if (p.type === 'video_url') return { type: 'video_url', video_url: p.video_url, ...(p.fps != null && { fps: p.fps }) };
                if (p.type === 'video') return p;
                if (typeof p === 'string') return { type: 'text', text: p };
                return { type: 'text', text: JSON.stringify(p) };
            });
            return { role, content: parts };
        }

        return { role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
    });
}

async function chatCompletion(messages, apiKey, { model, temperature = 0.7, maxTokens = 65536 } = {}) {
    const baseUrl = getChatBaseUrl();
    const useModel = model || getPrimaryModel();
    const url = `${baseUrl}/chat/completions`;
    console.log(`[Chat] URL=${url}, model=${useModel}, apiKey=${apiKey ? apiKey.slice(0, 8) + '...' + apiKey.slice(-4) : 'MISSING'}`);
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: useModel,
            messages: langchainToOpenAI(messages),
            temperature,
            max_completion_tokens: maxTokens,
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[Chat DEBUG] ${res.status} response: ${body}`);
        const err = new Error(`Chat API error: ${res.status}`);
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    const text = msg?.content || msg?.reasoning_content || '';
    const totalTokens = data?.usage?.total_tokens || 0;

    if (!text) {
        console.warn(`[Chat] Empty content from ${useModel}, finish_reason:`, data?.choices?.[0]?.finish_reason);
        return { text: 'Sorry, the AI model is currently overloaded. Please try again in a moment.', totalTokens };
    }
    return { text, totalTokens };
}

// ============================================================================
// GRAPH NODES
// ============================================================================

async function agentNode(state, config) {
    const apiKey = config.configurable?.apiKey;
    const systemMessage = new SystemMessage(CHAT_AGENT_SYSTEM_PROMPT);
    const allMessages = [systemMessage, ...state.messages];

    try {
        const result = await retryWithBackoff(() =>
            chatCompletion(allMessages, apiKey, { model: getPrimaryModel() })
        );
        return { messages: [new AIMessage(result.text)], totalTokens: result.totalTokens };
    } catch (err) {
        const status = err?.status ?? err?.statusCode ?? 0;
        if (status === 429) {
            console.warn(`[Fallback] ${getPrimaryModel()} rate-limited, switching to ${getFallbackModel()}...`);
            const result = await chatCompletion(allMessages, apiKey, { model: getFallbackModel() });
            return { messages: [new AIMessage(result.text)], totalTokens: result.totalTokens };
        }
        throw err;
    }
}

// ============================================================================
// GRAPH DEFINITION
// ============================================================================

export function createChatGraph() {
    const workflow = new StateGraph(MessagesAnnotation)
        .addNode("agent", agentNode)
        .addEdge("__start__", "agent")
        .addEdge("agent", END);

    return workflow.compile();
}

// ============================================================================
// TOPIC GENERATION
// ============================================================================

export async function generateTopicTitle(messages, apiKey) {
    const contextMessages = messages.slice(0, 6);
    const conversationSummary = contextMessages
        .map(m => `${m._getType?.() === 'human' ? 'User' : 'Assistant'}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
        .join('\n');

    try {
        const result = await retryWithBackoff(() =>
            chatCompletion(
                [
                    new SystemMessage('Generate a short topic title (max 6 words) for this conversation. Reply with ONLY the title.'),
                    new HumanMessage(conversationSummary)
                ],
                apiKey,
                { model: getPrimaryModel(), temperature: 0.5, maxTokens: 60 }
            )
        );
        return result.text.trim();
    } catch (err) {
        console.warn(`[Fallback] Topic generation: ${getPrimaryModel()} failed (${err.message}), switching to ${getFallbackModel()}...`);
        try {
            const result = await chatCompletion(
                [
                    new SystemMessage('Generate a short topic title (max 6 words) for this conversation. Reply with ONLY the title.'),
                    new HumanMessage(conversationSummary)
                ],
                apiKey,
                { model: getFallbackModel(), temperature: 0.5, maxTokens: 60 }
            );
            return result.text.trim();
        } catch (fallbackErr) {
            console.error('[Fallback] Topic fallback also failed:', fallbackErr.message);
            throw err;
        }
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    createChatGraph,
    generateTopicTitle,
};
