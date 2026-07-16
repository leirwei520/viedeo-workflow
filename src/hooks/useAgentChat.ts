/**
 * useAgentChat.ts
 *
 * SSE-based hook for communicating with the tool-calling Agent.
 * Processes the event stream and manages chat state, tool progress, and actions.
 * Includes localStorage-based session history.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { apiEndpoint } from '../config/api';
import { sanitizeError } from '../utils/errorSanitizer';

// ============================================================================
// TYPES
// ============================================================================

export interface AgentMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: ToolCallInfo[];
    actions?: AgentAction[];
    visionImages?: number;
    mediaUrls?: string[];
    timestamp: Date;
}

export interface ToolCallInfo {
    id: string;
    tool: string;
    args: string;
    result?: string;
    status: 'running' | 'done' | 'error';
}

export type AgentAction =
    | { type: 'create_storyboard_nodes'; data: StoryboardData }
    | { type: 'create_and_generate_images'; data: { images: ImageNodePlan[]; groupLabel?: string } }
    | { type: 'create_and_generate_videos'; data: VideoGenerationPlan }
    | { type: 'merge_videos'; data: VideoMergePlan }
    | { type: 'generate_tts'; data: TTSPlan };

export interface StoryboardData {
    scripts: Array<{
        sceneNumber: number;
        description: string;
        cameraAngle?: string;
        cameraMovement?: string;
        lighting?: string;
        mood?: string;
    }>;
    styleAnchor: string;
    characterDNA: Record<string, string>;
    sceneCount: number;
}

export interface ImageNodePlan {
    prompt: string;
    model: string;
    aspectRatio: string;
    title?: string;
}

export interface VideoGenerationPlan {
    sourceNodeIds: string[];
    model: string;
    duration: number;
    promptOverride: string | null;
}

export interface VideoMergePlan {
    sourceNodeIds: string[];
    transition: string;
    transitionDuration: number;
}

export interface TTSPlan {
    text: string;
    voice: string | null;
    language: string;
}

export interface AgentSession {
    id: string;
    topic: string;
    createdAt: string;
    updatedAt?: string;
    messageCount: number;
}

interface UseAgentChatReturn {
    messages: AgentMessage[];
    isLoading: boolean;
    error: string | null;
    currentToolCalls: ToolCallInfo[];
    pendingActions: AgentAction[];
    sessions: AgentSession[];
    isLoadingSessions: boolean;
    sendMessage: (content: string, canvasState?: CanvasStateSnapshot, media?: Array<{ base64?: string }>) => Promise<void>;
    clearActions: () => void;
    startNewChat: () => void;
    loadSession: (sessionId: string) => void;
    deleteSession: (sessionId: string) => void;
}

interface CanvasStateSnapshot {
    nodes: Array<{
        id: string;
        type: string;
        title?: string;
        prompt?: string;
        status: string;
        resultUrl?: string;
        model?: string;
        imageModel?: string;
        videoModel?: string;
        parentIds?: string[];
    }>;
    groups: Array<{
        id: string;
        label: string;
        nodeIds: string[];
    }>;
}

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// LOCAL STORAGE SESSION PERSISTENCE
// ============================================================================

const AGENT_SESSIONS_KEY = 'agent-chat-sessions';
const MAX_SESSIONS = 30;

interface StoredMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: ToolCallInfo[];
    actions?: AgentAction[];
    visionImages?: number;
    mediaUrls?: string[];
    timestamp: string;
}

interface StoredSession {
    meta: AgentSession;
    messages: StoredMessage[];
}

function getStoredSessions(): StoredSession[] {
    try {
        return JSON.parse(localStorage.getItem(AGENT_SESSIONS_KEY) || '[]');
    } catch { return []; }
}

function setStoredSessions(sessions: StoredSession[]) {
    try {
        localStorage.setItem(AGENT_SESSIONS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
    } catch { /* quota exceeded */ }
}

function messageToStored(msg: AgentMessage): StoredMessage {
    return {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        toolCalls: msg.toolCalls?.map(tc => ({
            ...tc,
            args: (tc.args || '').substring(0, 300),
            result: tc.result?.substring(0, 300),
        })),
        actions: msg.actions,
        visionImages: msg.visionImages,
        mediaUrls: msg.mediaUrls,
        timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : String(msg.timestamp),
    };
}

function storedToMessage(stored: StoredMessage): AgentMessage {
    return { ...stored, timestamp: new Date(stored.timestamp) };
}

function deriveSessionTopic(messages: AgentMessage[]): string {
    const firstUser = messages.find(m => m.role === 'user');
    if (!firstUser) return '新对话';
    const text = firstUser.content.trim();
    return text.length > 30 ? text.substring(0, 30) + '...' : text;
}

// ============================================================================
// HOOK
// ============================================================================

export function useAgentChat(): UseAgentChatReturn {
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentToolCalls, setCurrentToolCalls] = useState<ToolCallInfo[]>([]);
    const [pendingActions, setPendingActions] = useState<AgentAction[]>([]);
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(false);
    const sessionIdRef = useRef<string>(`agent-${generateId()}`);
    const abortRef = useRef<AbortController | null>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const refreshSessions = useCallback(() => {
        setIsLoadingSessions(true);
        const stored = getStoredSessions();
        setSessions(
            stored.map(s => s.meta).sort((a, b) =>
                new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
            )
        );
        setIsLoadingSessions(false);
    }, []);

    useEffect(() => { refreshSessions(); }, [refreshSessions]);

    const saveCurrentSession = useCallback((msgs: AgentMessage[]) => {
        if (msgs.length === 0) return;
        const sid = sessionIdRef.current;
        const stored = getStoredSessions();
        const existing = stored.findIndex(s => s.meta.id === sid);
        const now = new Date().toISOString();
        const sessionData: StoredSession = {
            meta: {
                id: sid,
                topic: deriveSessionTopic(msgs),
                createdAt: existing >= 0 ? stored[existing].meta.createdAt : now,
                updatedAt: now,
                messageCount: msgs.length,
            },
            messages: msgs.map(messageToStored),
        };
        if (existing >= 0) {
            stored[existing] = sessionData;
        } else {
            stored.unshift(sessionData);
        }
        setStoredSessions(stored);
        refreshSessions();
    }, [refreshSessions]);

    const sendMessage = useCallback(async (content: string, canvasState?: CanvasStateSnapshot, media?: Array<{ base64?: string; previewUrl?: string }>) => {
        if (!content.trim() || isLoading) return;

        setError(null);
        setIsLoading(true);
        setCurrentToolCalls([]);

        const visionCount = (canvasState?.nodes || [])
            .filter(n => n.type === 'Image' && n.status === 'success' && n.resultUrl).length;
        const uploadedCount = media?.length || 0;
        const mediaUrls = media?.filter(m => m.previewUrl).map(m => m.previewUrl!) || [];

        const userMsg: AgentMessage = {
            id: generateId(),
            role: 'user',
            content,
            visionImages: (visionCount + uploadedCount) > 0 ? Math.min(visionCount, 6) + uploadedCount : undefined,
            mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMsg]);

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        let assistantContent = '';
        const collectedToolCalls: ToolCallInfo[] = [];
        let collectedActions: AgentAction[] = [];

        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(apiEndpoint('/api/agent/chat'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    sessionId: sessionIdRef.current,
                    message: content,
                    canvasState: canvasState || undefined,
                    media: media && media.length > 0 ? media : undefined,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Request failed: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response stream');

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                let eventType = '';
                let eventData = '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        eventData = line.slice(6);
                        if (eventType && eventData) {
                            try {
                                const parsed = JSON.parse(eventData);
                                handleSSEEvent(eventType, parsed, {
                                    setCurrentToolCalls,
                                    collectedToolCalls,
                                    onContent: (c) => { assistantContent = c; },
                                    onActions: (a) => { collectedActions = a; },
                                });
                            } catch {
                                // skip malformed events
                            }
                        }
                        eventType = '';
                        eventData = '';
                    } else if (line === '') {
                        eventType = '';
                        eventData = '';
                    }
                }
            }

            // Create assistant message and save session
            if (assistantContent || collectedToolCalls.length > 0) {
                const assistantMsg: AgentMessage = {
                    id: generateId(),
                    role: 'assistant',
                    content: assistantContent,
                    toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
                    actions: collectedActions.length > 0 ? collectedActions : undefined,
                    timestamp: new Date(),
                };
                setMessages(prev => {
                    const updated = [...prev, assistantMsg];
                    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = setTimeout(() => saveCurrentSession(updated), 500);
                    return updated;
                });
            }

            if (collectedActions.length > 0) {
                setPendingActions(prev => [...prev, ...collectedActions]);
            }
        } catch (err: unknown) {
            if ((err as Error).name === 'AbortError') return;
            console.error('[AgentChat] Error:', err);
            setError(sanitizeError(err));
        } finally {
            setIsLoading(false);
            setCurrentToolCalls([]);
        }
    }, [isLoading, saveCurrentSession]);

    const clearActions = useCallback(() => {
        setPendingActions([]);
    }, []);

    const startNewChat = useCallback(() => {
        abortRef.current?.abort();
        setMessages([]);
        setError(null);
        setCurrentToolCalls([]);
        setPendingActions([]);
        sessionIdRef.current = `agent-${generateId()}`;
    }, []);

    const loadSession = useCallback((sessionId: string) => {
        const stored = getStoredSessions();
        const found = stored.find(s => s.meta.id === sessionId);
        if (found) {
            abortRef.current?.abort();
            setMessages(found.messages.map(storedToMessage));
            setError(null);
            setCurrentToolCalls([]);
            setPendingActions([]);
            sessionIdRef.current = sessionId;
        }
    }, []);

    const deleteSession = useCallback((sessionId: string) => {
        const stored = getStoredSessions();
        const filtered = stored.filter(s => s.meta.id !== sessionId);
        setStoredSessions(filtered);
        if (sessionIdRef.current === sessionId) {
            setMessages([]);
            setError(null);
            sessionIdRef.current = `agent-${generateId()}`;
        }
        refreshSessions();
    }, [refreshSessions]);

    return {
        messages,
        isLoading,
        error,
        currentToolCalls,
        pendingActions,
        sessions,
        isLoadingSessions,
        sendMessage,
        clearActions,
        startNewChat,
        loadSession,
        deleteSession,
    };
}

// ============================================================================
// SSE EVENT HANDLER
// ============================================================================

function handleSSEEvent(
    type: string,
    data: any,
    ctx: {
        setCurrentToolCalls: React.Dispatch<React.SetStateAction<ToolCallInfo[]>>;
        collectedToolCalls: ToolCallInfo[];
        onContent: (c: string) => void;
        onActions: (a: AgentAction[]) => void;
    }
) {
    switch (type) {
        case 'thinking':
            break;

        case 'tool_start': {
            const tc: ToolCallInfo = {
                id: data.callId || generateId(),
                tool: data.tool,
                args: data.args,
                status: 'running',
            };
            ctx.collectedToolCalls.push(tc);
            ctx.setCurrentToolCalls([...ctx.collectedToolCalls]);
            break;
        }

        case 'tool_result': {
            const existing = ctx.collectedToolCalls.find(t => t.id === data.callId);
            if (existing) {
                existing.status = 'done';
                existing.result = typeof data.result === 'string'
                    ? data.result.substring(0, 500)
                    : JSON.stringify(data.result).substring(0, 500);
            }
            ctx.setCurrentToolCalls([...ctx.collectedToolCalls]);
            break;
        }

        case 'actions':
            if (data.actions) {
                ctx.onActions(data.actions);
            }
            break;

        case 'message':
            if (data.content) {
                ctx.onContent(data.content);
            }
            break;

        case 'error':
            console.error('[AgentChat] Server error:', data.message);
            break;

        case 'done':
            break;
    }
}

export default useAgentChat;
