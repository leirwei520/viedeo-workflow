/**
 * agent.js
 *
 * SSE streaming endpoint for the tool-calling Agent.
 * POST /api/agent/chat — streams events as the agent reasons and calls tools.
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { runAgent } from '../agent/graph/agentGraph.js';
import { getModelPrice, calculateCost } from './pricing.js';
import { logUsage, checkBalance } from './generation.js';

const router = express.Router();

const getAgentModel = () => process.env.AGENT_MODEL || process.env.CHAT_MODEL || 'gpt-5.4';

// In-memory session store for agent conversations (mirrors chatAgent pattern)
const agentSessions = new Map();
const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours

function getOrCreateSession(sessionId, userId) {
    const existing = agentSessions.get(sessionId);
    if (existing && existing.userId === userId) {
        existing.lastAccess = Date.now();
        return existing;
    }
    const session = {
        id: sessionId,
        userId,
        history: [],
        lastAccess: Date.now(),
    };
    agentSessions.set(sessionId, session);
    return session;
}

// Cleanup old sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of agentSessions) {
        if (now - session.lastAccess > SESSION_TTL) {
            agentSessions.delete(id);
        }
    }
}, 10 * 60 * 1000);

/**
 * POST /api/agent/chat
 *
 * Body: { sessionId, message, canvasState? }
 * Response: SSE stream with events:
 *   - thinking: agent is reasoning
 *   - tool_start: { tool, args }
 *   - tool_result: { tool, result }
 *   - actions: { actions: [...] }
 *   - message: { content }
 *   - done: { totalTokens }
 *   - error: { message }
 */
router.post('/chat', authMiddleware, async (req, res) => {
    const { sessionId, message, canvasState, media } = req.body;
    const userId = req.userId;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }
    if (!message) {
        return res.status(400).json({ error: 'message is required' });
    }

    const apiKey = process.env.CHAT_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Server missing API Key config' });
    }

    try {
        await checkBalance(userId, getAgentModel());
    } catch (err) {
        if (err.status === 402) return res.status(402).json({ error: err.message });
        throw err;
    }

    // Set up SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    const sendEvent = (type, data) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const session = getOrCreateSession(sessionId, String(userId));

    try {
        const result = await runAgent({
            userMessage: message,
            history: session.history.slice(-20),
            apiKey,
            userId: String(userId),
            canvasState: canvasState || { nodes: [], groups: [] },
            media: Array.isArray(media) ? media : undefined,
            onEvent: sendEvent,
        });

        // Update session history with tool context so subsequent calls know what was done
        session.history.push({ role: 'user', content: message });

        let assistantContent = result.response || '';
        if (result.toolsUsed && result.toolsUsed.length > 0) {
            const toolSummary = result.toolsUsed.map(t => `${t.tool}: ${t.resultSummary}`).join('\n');
            assistantContent = `[Tools executed in this turn:\n${toolSummary}]\n\n${assistantContent}`;
        }
        if (assistantContent) {
            session.history.push({ role: 'assistant', content: assistantContent });
        }

        // Trim history to prevent unbounded growth
        if (session.history.length > 40) {
            session.history = session.history.slice(-30);
        }

        // Send actions if any
        if (result.actions && result.actions.length > 0) {
            sendEvent('actions', { actions: result.actions });
        }

        // Send done
        sendEvent('done', { totalTokens: result.totalTokens });

        // Bill usage
        try {
            const price = await getModelPrice(getAgentModel());
            const cost = calculateCost(price, { tokens: result.totalTokens });
            logUsage({
                userId,
                type: 'text',
                model: getAgentModel(),
                prompt: message.substring(0, 200),
                cost,
                tokens: result.totalTokens,
                status: 'success',
            });
        } catch (billingErr) {
            console.error('[Agent] Billing error:', billingErr.message);
        }
    } catch (err) {
        console.error('[Agent] Error:', err.message);
        sendEvent('error', { message: err.message || 'Agent execution failed' });
    } finally {
        res.end();
    }
});

/**
 * DELETE /api/agent/sessions/:id
 */
router.delete('/sessions/:id', authMiddleware, (req, res) => {
    const sessionId = req.params.id;
    const userId = String(req.userId);
    const session = agentSessions.get(sessionId);
    if (session && session.userId === userId) {
        agentSessions.delete(sessionId);
    }
    res.json({ success: true });
});

export default router;
