/**
 * registry.js
 *
 * Skill registry for the Agent system.
 * Creates tool definitions in OpenAI function calling format
 * and provides execution dispatch.
 */

import { createStoryboardTool } from './storyboard.js';
import { createImageGenerationTool } from './imageGeneration.js';
import { createVideoGenerationTool } from './videoGeneration.js';
import { createVideoMergeTool } from './videoMerge.js';
import { createTTSTool } from './tts.js';
import { createCanvasQueryTool } from './canvas.js';
import { createDescribeTool } from './describe.js';

/**
 * Create a context object shared across all skills in one request.
 * Includes a mutable actions array that skills can append to.
 */
export function createSkillContext({ userId, apiKey, baseUrl, canvasState }) {
    const actions = [];
    return {
        userId,
        apiKey,
        baseUrl,
        canvasState: canvasState || { nodes: [], groups: [] },
        actions,
        addAction(action) {
            actions.push(action);
        },
    };
}

/**
 * Create all skill tool definitions for a given context.
 * Returns { tools, toolMap } where:
 *   - tools: OpenAI-format tool definitions for the API call
 *   - toolMap: name -> func mapping for execution
 */
export function createSkillTools(context) {
    const skillDefs = [
        createStoryboardTool(context),
        createImageGenerationTool(context),
        createVideoGenerationTool(context),
        createVideoMergeTool(context),
        createTTSTool(context),
        createCanvasQueryTool(context),
        createDescribeTool(context),
    ];

    const tools = skillDefs.map(skill => ({
        type: 'function',
        function: {
            name: skill.name,
            description: skill.description,
            parameters: skill.parameters,
        },
    }));

    const toolMap = {};
    for (const skill of skillDefs) {
        toolMap[skill.name] = skill.func;
    }

    return { tools, toolMap };
}

/**
 * Execute a tool call by name with the given arguments.
 */
export async function executeTool(toolMap, name, args) {
    const func = toolMap[name];
    if (!func) {
        return `Unknown tool: ${name}. Available tools: ${Object.keys(toolMap).join(', ')}`;
    }

    try {
        const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
        return await func(parsedArgs);
    } catch (err) {
        console.error(`[Agent] Tool "${name}" execution error:`, err.message);
        return `Tool execution failed: ${err.message}`;
    }
}
