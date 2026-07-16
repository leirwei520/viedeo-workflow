/**
 * agent/index.js
 * 
 * Main entry point for the LangGraph chat agent.
 * Exports the compiled graph and utility functions.
 * 
 * NOTE: Currently implemented in JavaScript/LangGraph.js for simplicity.
 * If more advanced agent capabilities are needed (complex tool chains,
 * multi-agent systems, advanced memory), consider migrating to Python
 * LangGraph which has a more mature and feature-rich ecosystem.
 */

import { createChatGraph, generateTopicTitle } from "./graph/chatGraph.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { getPool } from '../db/pool.js';
import { getRedis } from '../db/redis.js';

// ============================================================================
// IMAGE RESOLUTION
// ============================================================================

/**
 * Resolve an image URL or base64 to a base64 data URL.
 * For remote (OSS) URLs, returns as-is (API accepts URLs).
 */
function resolveImageToBase64(imageInput) {
    if (!imageInput) return null;
    if (imageInput.startsWith('data:')) return imageInput;
    if (imageInput.startsWith('http')) return imageInput;
    return imageInput;
}

export function setChatsDir() {
    // No-op — kept for backward compatibility, chats now stored in MySQL
}

// ============================================================================
// SESSION MANAGEMENT (MySQL + Redis cache)
// ============================================================================

const sessionCache = new Map();

/**
 * Convert multimodal content to text representation for serialization
 * This ensures context is preserved without huge base64 data
 */
function contentToText(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        const parts = [];
        let imageCount = 0;

        for (const part of content) {
            if (part.type === 'text') {
                parts.push(part.text);
            } else if (part.type === 'image_url') {
                imageCount++;
                parts.push(`[IMAGE ${imageCount} ATTACHED]`);
            }
        }

        return parts.join('\n');
    }

    return JSON.stringify(content);
}

/**
 * Convert LangChain messages to serializable format
 * Multimodal messages are converted to text with [IMAGE ATTACHED] markers
 */
function serializeMessages(messages) {
    return messages.map(msg => ({
        role: msg._getType?.() === 'human' ? 'user' : 'assistant',
        content: contentToText(msg.content),
        media: msg.additional_kwargs?.media,
        timestamp: new Date().toISOString()
    }));
}

/**
 * Convert serialized messages back to LangChain format
 * All messages are now stored as text (images converted to markers)
 */
function deserializeMessages(messages) {
    return messages.map(msg => {
        if (msg.role === 'user') {
            const message = new HumanMessage(msg.content);
            if (msg.media) {
                message.additional_kwargs = { media: msg.media };
            }
            return message;
        } else {
            return new AIMessage(msg.content);
        }
    });
}

function toMysqlDatetime(d) {
    return (d instanceof Date ? d : new Date(d || Date.now())).toISOString().slice(0, 19).replace('T', ' ');
}

async function saveSession(sessionId, session, userId) {
    const pool = getPool();
    if (!pool) return;
    const uid = String(userId || '0');
    const messages = JSON.stringify(serializeMessages(session.messages));
    const now = toMysqlDatetime(new Date());
    const createdAt = toMysqlDatetime(session.createdAt);
    try {
        await pool.execute(
            `INSERT INTO chat_sessions (id, user_id, topic, messages, message_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE topic=VALUES(topic), messages=VALUES(messages), message_count=VALUES(message_count), updated_at=VALUES(updated_at)`,
            [sessionId, uid, session.topic || null, messages, session.messages.length, createdAt, now]
        );
    } catch (err) {
        console.error(`[Chat] Failed to save session ${sessionId}:`, err.message);
    }
}

async function loadSession(sessionId) {
    const pool = getPool();
    if (!pool) return null;
    try {
        const [rows] = await pool.execute('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
        if (rows.length === 0) return null;
        const r = rows[0];
        const msgs = typeof r.messages === 'string' ? JSON.parse(r.messages) : r.messages;
        return {
            messages: deserializeMessages(msgs),
            topic: r.topic,
            createdAt: new Date(r.created_at)
        };
    } catch (err) {
        console.error(`[Chat] Failed to load session ${sessionId}:`, err.message);
        return null;
    }
}

export async function getSession(sessionId) {
    if (sessionCache.has(sessionId)) {
        return sessionCache.get(sessionId);
    }

    const loaded = await loadSession(sessionId);
    if (loaded) {
        sessionCache.set(sessionId, loaded);
        return loaded;
    }

    const newSession = { messages: [], topic: null, createdAt: new Date() };
    sessionCache.set(sessionId, newSession);
    return newSession;
}

export async function deleteSession(sessionId, userId) {
    const pool = getPool();
    if (!pool) return false;
    try {
        const [result] = await pool.execute('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
        if (result.affectedRows > 0) {
            sessionCache.delete(sessionId);
            const redis = getRedis();
            if (redis) await redis.del('chat_list').catch(() => {});
        }
        return result.affectedRows > 0;
    } catch (err) {
        console.error(`[Chat] Failed to delete session ${sessionId}:`, err.message);
        return false;
    }
}

export async function listSessions(userId) {
    const pool = getPool();
    if (!pool) return [];

    // Try Redis cache
    const redis = getRedis();
    const cacheKey = userId ? `chat_list:${userId}` : 'chat_list';
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch {}
    }

    try {
        const whereClause = userId ? 'WHERE user_id = ?' : '';
        const params = userId ? [userId] : [];
        const [rows] = await pool.execute(
            `SELECT id, topic, message_count, created_at, updated_at FROM chat_sessions ${whereClause} ORDER BY updated_at DESC`,
            params
        );
        const sessions = rows.map(r => ({
            id: r.id, topic: r.topic || 'New Chat',
            createdAt: r.created_at, updatedAt: r.updated_at,
            messageCount: r.message_count
        }));
        if (redis) redis.set(cacheKey, JSON.stringify(sessions), 'EX', 120).catch(() => {});
        return sessions;
    } catch (err) {
        console.error('[Chat] Failed to list sessions:', err.message);
        return [];
    }
}

export async function getSessionData(sessionId, userId) {
    const pool = getPool();
    if (!pool) return null;
    try {
        const [rows] = await pool.execute('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
        if (rows.length === 0) return null;
        const r = rows[0];
        return {
            id: r.id, topic: r.topic,
            createdAt: r.created_at, updatedAt: r.updated_at,
            messages: typeof r.messages === 'string' ? JSON.parse(r.messages) : r.messages
        };
    } catch (err) {
        console.error(`[Chat] Failed to load session data ${sessionId}:`, err.message);
        return null;
    }
}

// ============================================================================
// CHAT FUNCTIONS
// ============================================================================

/**
 * Send a message to the chat agent and get a response
 * @param {string} sessionId - Session identifier
 * @param {string} content - User message content
 * @param {Array} media - Optional media attachments [{ type, url, base64 }, ...]
 * @param {string} apiKey - Google AI API key
 * @returns {Promise<object>} { response: string, topic?: string }
 */
export async function sendMessage(sessionId, content, media, apiKey, userId) {
    const session = await getSession(sessionId);
    const graph = createChatGraph();

    // Debug: Log session state
    console.log(`[Chat] Session ${sessionId} has ${session.messages.length} existing messages`);

    // Build the user message content
    let messageContent;
    if (media && Array.isArray(media) && media.length > 0) {
        // Multimodal message with images/videos
        const contentParts = [{ type: "text", text: content || "What do you see in these images?" }];

        for (const m of media) {
            const resolved = resolveImageToBase64(m.base64);
            if (!resolved) continue;

            if (m.type === 'video') {
                // Qwen / DashScope requires video_url with an HTTP(S) URL.
                // If the input is already a URL, use it directly;
                // base64-encoded video is not supported by most providers.
                if (resolved.startsWith('http')) {
                    contentParts.push({
                        type: "video_url",
                        video_url: { url: resolved },
                        fps: 2,
                    });
                } else {
                    console.warn('[Chat] Skipping video: only URL-based video is supported for the current model.');
                }
            } else {
                const base64Data = resolved.includes(',')
                    ? resolved.split(',')[1]
                    : resolved;
                contentParts.push({
                    type: "image_url",
                    image_url: {
                        url: resolved.startsWith('http') ? resolved : `data:image/png;base64,${base64Data}`,
                    },
                });
            }
        }

        messageContent = contentParts;
    } else {
        messageContent = content;
    }

    // Debug logging


    // Add user message to session
    const userMessage = new HumanMessage(messageContent);

    // Attach metadata for persistence (excluding base64 to save space)
    if (media && Array.isArray(media)) {
        userMessage.additional_kwargs = {
            ...userMessage.additional_kwargs,
            media: media.map(m => {
                // If base64 field contains a URL, preserve it as url
                let url = m.url;
                const b64 = m.base64;
                if (!url && b64 && !b64.startsWith('data:')) {
                    url = b64;
                }
                return { ...m, url, base64: undefined };
            })
        };
    }

    session.messages.push(userMessage);

    console.log(`[Chat] Sending ${session.messages.length} messages to LLM`);

    // Invoke the graph
    const result = await graph.invoke(
        { messages: session.messages },
        { configurable: { apiKey } }
    );

    // Extract AI response from result
    const aiResponse = result.messages[result.messages.length - 1];
    session.messages.push(aiResponse);

    // Convert the multimodal user message to text for future context
    // This ensures the AI remembers what images contained in subsequent turns
    if (typeof messageContent !== 'string') {
        const textVersion = contentToText(messageContent);
        // Replace the last user message with text version but keep metadata
        const userMsgIndex = session.messages.length - 2;
        const originalMsg = session.messages[userMsgIndex];

        const newMsg = new HumanMessage(textVersion);
        if (originalMsg.additional_kwargs) {
            newMsg.additional_kwargs = originalMsg.additional_kwargs;
        }
        session.messages[userMsgIndex] = newMsg;

        session.messages[userMsgIndex] = newMsg;
    }

    // Generate topic if this is the first exchange (2 messages: user + AI)
    let topic = session.topic;
    if (session.messages.length === 2 && !session.topic) {
        try {
            topic = await generateTopicTitle(session.messages, apiKey);
            session.topic = topic;
        } catch (err) {
            console.error("Failed to generate topic:", err);
            topic = "New Chat";
        }
    }

    // Save session to DB after each message
    await saveSession(sessionId, session, userId);

    // Invalidate chat list cache
    const redis = getRedis();
    if (redis && userId) await redis.del(`chat_list:${userId}`).catch(() => {});

    return {
        response: aiResponse.content.toString(),
        topic: topic,
        messageCount: session.messages.length,
        totalTokens: result.totalTokens || 0,
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

export { createChatGraph, generateTopicTitle };

export default {
    getSession,
    deleteSession,
    listSessions,
    getSessionData,
    sendMessage,
    setChatsDir,
    createChatGraph,
    generateTopicTitle,
};
