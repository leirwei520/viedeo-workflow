/**
 * ChatPanel.tsx
 * 
 * Agent chat panel that slides in from the right side.
 * Supports two modes: Chat (simple assistant) and Agent (tool-calling with canvas actions).
 * Shows greeting, inspiration suggestions, chat messages, and input.
 * Supports drag-drop of image/video nodes from canvas.
 * Includes chat history panel for viewing past conversations.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, History, Paperclip, Send, Sparkles, Plus, Loader2, ChevronLeft, Trash2, MessageSquare, ImagePlus, Languages, Bot, MessageCircle, Wrench, CheckCircle2, AlertCircle, Zap, Image, Video, Film, Mic, Eye, ArrowRight, LayoutGrid, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChatMessage, type CreateImageFromPrompt } from './ChatMessage';
import { useChatAgent, ChatMessage as ChatMessageType, ChatSession } from '../hooks/useChatAgent';
import { useAgentChat, AgentMessage, ToolCallInfo, AgentAction } from '../hooks/useAgentChat';
import { useTheme } from '../hooks/useTheme';
import { HoverBorderGradient } from './ui/hover-border-gradient';
import { apiEndpoint, authFetch } from '../config/api';
import { sanitizeError } from '../utils/errorSanitizer';

// ============================================================================
// TYPES
// ============================================================================

type PanelMode = 'chat' | 'agent';

interface AttachedMedia {
    type: 'image' | 'video';
    url: string;
    nodeId: string;
    base64?: string;
}

interface CanvasStateForAgent {
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

interface ChatPanelProps {
    isOpen: boolean;
    onClose: () => void;
    userName?: string;
    isDraggingNode?: boolean;
    onNodeDrop?: (nodeId: string, url: string, type: 'image' | 'video') => void;
    onCreateImage?: (data: CreateImageFromPrompt) => void;
    onCreateAllImages?: (data: CreateImageFromPrompt[]) => void;
    onAgentActions?: (actions: AgentAction[]) => void;
    getCanvasState?: () => CanvasStateForAgent;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const ChatPanel: React.FC<ChatPanelProps> = ({
    isOpen,
    onClose,
    userName = 'Creator',
    isDraggingNode = false,
    onCreateImage,
    onCreateAllImages,
    onAgentActions,
    getCanvasState,
}) => {
    const { t } = useTranslation();
    const { isDark } = useTheme();
    // --- State ---
    const [message, setMessage] = useState('');
    const [attachedMedia, setAttachedMedia] = useState<AttachedMedia[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [mode, setMode] = useState<PanelMode>('agent');

    // Chat agent hook (simple chat mode)
    const chatHook = useChatAgent();

    // Agent hook (tool-calling agent mode)
    const agentHook = useAgentChat();

    // Derived state based on mode
    const isLoading = mode === 'agent' ? agentHook.isLoading : chatHook.isLoading;
    const error = mode === 'agent' ? agentHook.error : chatHook.error;
    const hasMessages = mode === 'agent' ? agentHook.messages.length > 0 : chatHook.hasMessages;

    // Stores uploaded reference images (as data URLs) so they can be attached
    // to agent-created image nodes as characterReferenceUrls.
    const agentMediaRef = useRef<string[]>([]);

    // Process pending agent actions
    const processedActionsRef = useRef(new Set<string>());
    useEffect(() => {
        if (mode !== 'agent' || !onAgentActions || agentHook.pendingActions.length === 0) return;
        const newActions = agentHook.pendingActions.filter((_, i) => {
            const key = `${i}-${JSON.stringify(_).substring(0, 50)}`;
            if (processedActionsRef.current.has(key)) return false;
            processedActionsRef.current.add(key);
            return true;
        });
        if (newActions.length > 0) {
            const refs = agentMediaRef.current;
            if (refs.length > 0) {
                for (const action of newActions) {
                    if (action.type === 'create_and_generate_images' || action.type === 'create_storyboard_nodes') {
                        (action as any)._referenceUrls = refs;
                    }
                }
                agentMediaRef.current = [];
            }
            onAgentActions(newActions);
            agentHook.clearActions();
        }
    }, [mode, agentHook.pendingActions, onAgentActions]);

    // Aliases for compatibility
    const messages = chatHook.messages;
    const topic = chatHook.topic;
    const sessions = chatHook.sessions;
    const isLoadingSessions = chatHook.isLoadingSessions;
    const sendMessage = chatHook.sendMessage;
    const startNewChat = chatHook.startNewChat;
    const loadSession = chatHook.loadSession;
    const deleteSession = chatHook.deleteSession;

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Effects ---

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, agentHook.messages, agentHook.currentToolCalls]);

    // --- Event Handlers ---

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        // Only set false if leaving the panel entirely
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        // Get data from drag event
        const nodeData = e.dataTransfer.getData('application/json');
        if (nodeData) {
            try {
                const { nodeId, url, type } = JSON.parse(nodeData);
                if (url && (type === 'image' || type === 'video')) {
                    // Convert URL to base64 for API consumption
                    let base64Data: string | undefined;

                    if (type === 'image') {
                        try {
                            // Fetch the image and convert to base64
                            const response = await fetch(url);
                            const blob = await response.blob();
                            base64Data = await new Promise<string>((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    const result = reader.result as string;
                                    // Extract just the base64 part (remove data:image/...;base64, prefix)
                                    const base64 = result.split(',')[1];
                                    resolve(base64);
                                };
                                reader.onerror = reject;
                                reader.readAsDataURL(blob);
                            });
                        } catch (err) {
                            console.error('Failed to convert image to base64:', err);
                        }
                    }

                    // Add to attachments if not already present
                    setAttachedMedia(prev => {
                        if (prev.some(m => m.nodeId === nodeId)) return prev;
                        return [...prev, { type, url, nodeId, base64: base64Data }];
                    });
                }
            } catch (err) {
                console.error('Failed to parse dropped node data:', err);
            }
        }
    };


    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue;

            const url = URL.createObjectURL(file);
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const result = reader.result as string;
                    resolve(result.split(',')[1]);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            setAttachedMedia(prev => [...prev, {
                type: 'image',
                url,
                nodeId: fileId,
                base64
            }]);
        }

        // Reset input so re-selecting the same file works
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
        const clipboard = e.clipboardData;
        if (!clipboard) return;

        // Collect image files from items API (Chrome/Edge/Firefox) or files API (Safari/macOS fallback)
        const imageFiles: File[] = [];

        if (clipboard.items?.length) {
            for (const item of Array.from(clipboard.items)) {
                if (item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                }
            }
        }

        if (imageFiles.length === 0 && clipboard.files?.length) {
            for (const file of Array.from(clipboard.files)) {
                if (file.type.startsWith('image/')) {
                    imageFiles.push(file);
                }
            }
        }

        if (imageFiles.length === 0) return;
        e.preventDefault();

        for (const file of imageFiles) {
            const url = URL.createObjectURL(file);
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const fileId = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            setAttachedMedia(prev => [...prev, { type: 'image', url, nodeId: fileId, base64 }]);
        }
    };

    const removeAttachment = (nodeId: string) => {
        setAttachedMedia(prev => prev.filter(m => m.nodeId !== nodeId));
    };

    const handleSend = async () => {
        if ((!message.trim() && attachedMedia.length === 0) || isLoading) return;

        const currentMessage = message;
        const currentMedia = attachedMedia;

        // Clear input immediately for better UX
        setMessage('');
        setAttachedMedia([]);

        // Reset textarea height
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        if (mode === 'agent') {
            const canvasState = getCanvasState?.();
            const media = currentMedia.length > 0
                ? currentMedia.map(m => ({ base64: m.base64, previewUrl: m.url }))
                : undefined;
            if (currentMedia.length > 0) {
                agentMediaRef.current = currentMedia
                    .filter(m => m.base64)
                    .map(m => `data:image/jpeg;base64,${m.base64}`);
            }
            await agentHook.sendMessage(currentMessage, canvasState, media);
        } else {
            await sendMessage(
                currentMessage,
                currentMedia.length > 0 ? currentMedia.map(m => ({
                    type: m.type,
                    url: m.url,
                    base64: m.base64,
                })) : undefined
            );
        }
    };

    const handleNewChat = () => {
        if (mode === 'agent') {
            agentHook.startNewChat();
        } else {
            startNewChat();
        }
        setMessage('');
        setAttachedMedia([]);
        setShowHistory(false);
    };

    const handleTranslate = async () => {
        if (!message.trim() || isTranslating || isLoading) return;
        setIsTranslating(true);
        try {
            const res = await authFetch(apiEndpoint('/api/translate'), {
                method: 'POST',
                body: JSON.stringify({ text: message })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.translated) {
                    setMessage(data.translated);
                    if (textareaRef.current) {
                        textareaRef.current.style.height = 'auto';
                        requestAnimationFrame(() => {
                            if (textareaRef.current) {
                                const h = Math.min(textareaRef.current.scrollHeight, 120);
                                textareaRef.current.style.height = h + 'px';
                            }
                        });
                    }
                }
            }
        } catch (err) {
            console.error('Translation failed:', err);
        } finally {
            setIsTranslating(false);
        }
    };

    const handleLoadSession = async (sessionId: string) => {
        if (mode === 'agent') {
            agentHook.loadSession(sessionId);
        } else {
            await loadSession(sessionId);
        }
        setShowHistory(false);
    };

    const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (mode === 'agent') {
            agentHook.deleteSession(sessionId);
        } else {
            await deleteSession(sessionId);
        }
    };

    const historySessions = (mode === 'agent' ? agentHook.sessions : sessions) as Array<{ id: string; topic: string; createdAt: string; updatedAt?: string; messageCount: number }>;
    const historyLoading = mode === 'agent' ? agentHook.isLoadingSessions : isLoadingSessions;

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return t('chat.yesterday');
        } else if (diffDays < 7) {
            return `${diffDays} ${t('chat.daysAgo')}`;
        } else {
            return date.toLocaleDateString();
        }
    };

    // --- Render ---

    if (!isOpen) return null;

    const showHighlight = isDraggingNode || isDragOver;

    return (
        <div
            className={`fixed top-0 right-0 w-[400px] h-full flex flex-col z-40 transition-all duration-300 ${
                isDark
                    ? 'bg-[var(--sf-bg-deep)]'
                    : 'border-l border-gray-200 bg-white shadow-[-4px_0_24px_rgba(0,0,0,0.06)]'
            }`}
            style={isDark ? {
                borderLeft: `${showHighlight ? '3px' : '2px'} solid transparent`,
                backgroundImage: `linear-gradient(var(--sf-bg-deep), var(--sf-bg-deep)), linear-gradient(to bottom, rgba(255,107,157,${showHighlight ? '0.8' : '0.4'}), rgba(192,132,252,${showHighlight ? '0.8' : '0.4'}), rgba(96,165,250,${showHighlight ? '0.8' : '0.4'}), rgba(52,211,153,${showHighlight ? '0.8' : '0.4'}), rgba(251,191,36,${showHighlight ? '0.8' : '0.4'}), rgba(255,107,157,${showHighlight ? '0.8' : '0.4'}))`,
                backgroundOrigin: 'border-box',
                backgroundClip: 'padding-box, border-box',
            } : undefined}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* Drag Overlay */}
            {showHighlight && (
                <div className="absolute inset-0 bg-white/10 pointer-events-none z-10 flex items-center justify-center">
                    <div className="bg-white/10 border-2 border-dashed border-white/20 rounded-2xl px-8 py-6 text-center">
                        <Sparkles className="w-10 h-10 mx-auto mb-2 sf-rainbow-text" />
                        <p className="sf-rainbow-text font-medium">{t('chat.dropHere')}</p>
                    </div>
                </div>
            )}

            {/* History Panel */}
            {showHistory && (
                <div className={`absolute inset-0 z-20 flex flex-col ${isDark ? 'bg-[var(--sf-bg-deep)]' : 'bg-white'}`}>
                    {/* History Header */}
                    <div className={`flex items-center gap-3 px-4 py-3 border-b ${isDark ? 'border-neutral-800' : 'border-gray-100'}`}>
                        <button
                            onClick={() => setShowHistory(false)}
                            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900'}`}
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <span className={`font-medium text-sm ${isDark ? 'text-white' : 'text-neutral-900'}`}>{t('chat.chatHistory')}</span>
                    </div>

                    {/* History List */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {historyLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 sf-rainbow-text animate-spin" />
                            </div>
                        ) : historySessions.length === 0 ? (
                            <div className="text-center py-8">
                                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-neutral-600" />
                                <p className="text-neutral-500 text-sm">{t('chat.noChatHistory')}</p>
                                <p className="text-neutral-600 text-xs mt-1">{t('chat.startConversation')}</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {historySessions.map((session) => (
                                    <div
                                        key={session.id}
                                        onClick={() => handleLoadSession(session.id)}
                                        role="button"
                                        tabIndex={0}
                                        className={`w-full text-left p-3 rounded-xl transition-colors group cursor-pointer ${isDark ? 'bg-neutral-800/50 hover:bg-neutral-800' : 'bg-gray-50 hover:bg-neutral-100 border border-gray-100'}`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                                                    {session.topic}
                                                </p>
                                                <p className={`text-xs mt-1 ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                                    {session.messageCount} {t('chat.messages')} · {formatDate(session.updatedAt || session.createdAt)}
                                                </p>
                                            </div>
                                            <button
                                                onClick={(e) => handleDeleteSession(e, session.id)}
                                                className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded-lg transition-all text-neutral-500 hover:text-red-400"
                                                title={t('chat.deleteChat')}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* New Chat Button */}
                    <div className={`p-4 border-t ${isDark ? 'border-neutral-800' : 'border-gray-100'}`}>
                        <button
                            onClick={handleNewChat}
                            className={`w-full py-2.5 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 bg-transparent border ${isDark ? 'border-white/20 text-white/80 hover:border-white/40 hover:text-white hover:shadow-[0_0_12px_rgba(255,255,255,0.08)]' : 'border-gray-200 text-gray-600 hover:text-gray-800 hover:border-gray-300'}`}
                        >
                            <Plus size={16} />
                            {t('chat.newChat')}
                        </button>
                    </div>
                </div>
            )
            }

            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-[var(--sf-border)]' : 'border-gray-100'}`}>
                <div className="flex items-center gap-2">
                    {/* Mode Toggle */}
                    <div className={`flex rounded-lg p-0.5 ${isDark ? 'bg-neutral-800/60' : 'bg-gray-100'}`}>
                        <button
                            onClick={() => setMode('chat')}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                                mode === 'chat'
                                    ? isDark ? 'bg-neutral-700 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm'
                                    : isDark ? 'text-neutral-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'
                            }`}
                            title="Chat mode"
                        >
                            <MessageCircle size={13} />
                            Chat
                        </button>
                        <button
                            onClick={() => setMode('agent')}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                                mode === 'agent'
                                    ? isDark ? 'bg-gradient-to-r from-purple-600/80 to-blue-600/80 text-white shadow-sm' : 'bg-gradient-to-r from-purple-500 to-blue-500 text-white shadow-sm'
                                    : isDark ? 'text-neutral-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'
                            }`}
                            title="Agent mode - can execute canvas actions"
                        >
                            <Bot size={13} />
                            Agent
                        </button>
                    </div>
                    <span className={`font-medium text-sm tracking-wide truncate max-w-[120px] ${isDark ? 'text-white/90' : 'text-gray-800'}`}>
                        {mode === 'agent' ? '' : (topic || (hasMessages ? '' : ''))}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    {hasMessages && (
                        <button
                            onClick={handleNewChat}
                            className={`p-1.5 rounded-lg transition-all ${isDark ? 'hover:bg-white/5 text-white/50 hover:text-white' : 'hover:bg-neutral-100 text-gray-400 hover:text-neutral-900'}`}
                            title={t('chat.newChat')}
                        >
                            <Plus size={18} />
                        </button>
                    )}
                    <button
                        onClick={() => setShowHistory(true)}
                        className={`p-1.5 rounded-lg transition-all ${isDark ? 'hover:bg-white/5 text-white/50 hover:text-white' : 'hover:bg-neutral-100 text-gray-400 hover:text-neutral-900'}`}
                        title={t('chat.chatHistory')}
                    >
                        <History size={18} />
                    </button>
                    <button
                        onClick={onClose}
                        className={`p-1.5 rounded-lg transition-all ${isDark ? 'hover:bg-white/5 text-white/50 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {/* Show greeting and tip if no messages */}
                {!hasMessages ? (
                    <>
                        {/* Greeting */}
                        <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-gray-800'}`}>
                            {t('chat.hiUser', { name: userName })}
                        </h1>
                        <p className={`text-lg mb-4 ${isDark ? 'text-white/60' : 'sf-rainbow-text'}`}>
                            {mode === 'agent' ? '我可以帮你操作画布' : t('chat.lookingForInspiration')}
                        </p>

                        {mode === 'agent' && (
                            <div className="grid grid-cols-1 gap-2 mt-5">
                                {([
                                    { icon: LayoutGrid, text: '帮我生成一组关于太空冒险的分镜', hint: '创建分镜' },
                                    { icon: Image, text: '帮我把画布上的图片生成视频，先给我看看模型列表', hint: '批量生成' },
                                    { icon: Film, text: '帮我合成所有视频', hint: '合成视频' },
                                    { icon: Eye, text: '看看画布上有什么', hint: '画布状态' },
                                ] as const).map((item) => {
                                    const SIcon = item.icon;
                                    return (
                                        <button
                                            key={item.text}
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => {
                                                if (isLoading) return;
                                                setMessage('');
                                                const canvasState = getCanvasState?.();
                                                void agentHook.sendMessage(item.text, canvasState);
                                            }}
                                            className={`group w-full text-left px-3.5 py-2.5 rounded-xl text-sm transition-all flex items-center gap-3 disabled:opacity-50 disabled:pointer-events-none ${
                                                isDark
                                                    ? 'bg-neutral-800/40 hover:bg-neutral-800/80 text-neutral-300 border border-neutral-700/40 hover:border-purple-500/30 hover:shadow-[0_0_12px_rgba(168,85,247,0.06)]'
                                                    : 'bg-gray-50 hover:bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:shadow-md'
                                            }`}
                                        >
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                                                isDark ? 'bg-neutral-700/50 group-hover:bg-purple-500/20' : 'bg-white shadow-sm group-hover:bg-blue-50'
                                            }`}>
                                                <SIcon size={15} className={`${isDark ? 'text-neutral-400 group-hover:text-purple-400' : 'text-gray-400 group-hover:text-blue-500'} transition-colors`} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-[11px] mb-0.5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{item.hint}</div>
                                                <div className="truncate">{item.text}</div>
                                            </div>
                                            <ArrowRight size={14} className={`flex-shrink-0 ${isDark ? 'text-neutral-600 group-hover:text-purple-400' : 'text-gray-300 group-hover:text-blue-400'} transition-colors`} />
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </>
                ) : mode === 'agent' ? (
                    /* Agent Messages */
                    <div className="space-y-4">
                        {agentHook.messages.map((msg: AgentMessage, msgIdx: number) => (
                            <div key={msg.id}>
                                {msg.role === 'user' ? (
                                    <div className="flex flex-col items-end mb-3">
                                        <div className={`max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed ${
                                            isDark
                                                ? 'bg-gradient-to-br from-purple-600/30 to-blue-600/30 border border-purple-500/20 text-white shadow-lg shadow-purple-900/10'
                                                : 'bg-blue-50 text-gray-800 border border-blue-100 shadow-sm'
                                        }`}>
                                            {msg.mediaUrls && msg.mediaUrls.length > 0 && (
                                                <div className={`mb-2 ${msg.mediaUrls.length > 1 ? 'grid grid-cols-2 gap-1.5' : ''}`}>
                                                    {msg.mediaUrls.map((url, idx) => (
                                                        <img key={idx} src={url} alt="" className="w-full max-h-28 rounded-lg object-cover cursor-pointer hover:brightness-110 transition" onClick={() => setPreviewImage(url)} />
                                                    ))}
                                                </div>
                                            )}
                                            {msg.content}
                                        </div>
                                        <div className={`flex items-center gap-1.5 mt-1 mr-1 text-[10px] ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>
                                            {msg.visionImages && msg.visionImages > 0 && (
                                                <span className={isDark ? 'text-purple-400/60' : 'text-blue-400/60'}>
                                                    附 {msg.visionImages} 张图 ·
                                                </span>
                                            )}
                                            {msg.timestamp instanceof Date && msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex gap-2.5 mb-3">
                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                            isDark
                                                ? 'bg-gradient-to-br from-purple-500/80 to-blue-500/80 shadow-lg shadow-purple-900/20'
                                                : 'bg-gradient-to-br from-purple-500 to-blue-500 shadow-sm'
                                        }`}>
                                            <Bot size={14} className="text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {/* Tool Calls */}
                                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                                                <div className="mb-2 space-y-1">
                                                    {msg.toolCalls.map((tc) => (
                                                        <ToolCallIndicator key={tc.id} toolCall={tc} isDark={isDark} />
                                                    ))}
                                                </div>
                                            )}
                                            {/* Action Result Cards */}
                                            {msg.actions && msg.actions.length > 0 && (
                                                <div className="mb-2 space-y-1.5">
                                                    {msg.actions.map((action, ai) => (
                                                        <ActionResultCard key={ai} action={action} isDark={isDark} />
                                                    ))}
                                                </div>
                                            )}
                                            {/* Message Content */}
                                            {msg.content && (
                                                <ChatMessage
                                                    role="assistant"
                                                    content={msg.content}
                                                    timestamp={msg.timestamp}
                                                    onCreateImage={onCreateImage}
                                                    onCreateAllImages={onCreateAllImages}
                                                />
                                            )}
                                            {/* Quick Action Buttons */}
                                            {!isLoading && msgIdx === agentHook.messages.length - 1 && (
                                                <QuickActions
                                                    msg={msg}
                                                    isDark={isDark}
                                                    onSend={(text) => {
                                                        setMessage('');
                                                        const canvasState = getCanvasState?.();
                                                        agentHook.sendMessage(text, canvasState);
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Active Tool Calls */}
                        {agentHook.currentToolCalls.length > 0 && (
                            <div className="flex gap-2.5 mb-3">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                    isDark
                                        ? 'bg-gradient-to-br from-purple-500/80 to-blue-500/80 shadow-lg shadow-purple-900/20'
                                        : 'bg-gradient-to-br from-purple-500 to-blue-500 shadow-sm'
                                }`}>
                                    <Bot size={14} className="text-white" />
                                </div>
                                <div className="flex-1 space-y-1">
                                    {agentHook.currentToolCalls.map((tc) => (
                                        <ToolCallIndicator key={tc.id} toolCall={tc} isDark={isDark} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Loading indicator */}
                        {isLoading && agentHook.currentToolCalls.length === 0 && (
                            <div className="flex gap-2.5 mb-4">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                    isDark
                                        ? 'bg-gradient-to-br from-purple-500/80 to-blue-500/80 shadow-lg shadow-purple-900/20'
                                        : 'bg-gradient-to-br from-purple-500 to-blue-500 shadow-sm'
                                }`}>
                                    <Bot size={14} className="text-white animate-pulse" />
                                </div>
                                <div className={`rounded-2xl px-4 py-3 flex items-center gap-3 ${isDark ? 'bg-neutral-800/80 border border-neutral-700/40' : 'bg-gray-50 border border-gray-100'}`}>
                                    <div className="flex gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                    <span className={`text-xs ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>思考中...</span>
                                </div>
                            </div>
                        )}

                        {/* Error message */}
                        {error && (
                            <div className="flex justify-center mb-4">
                                <div className={`rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${isDark ? 'bg-red-500/10 border border-red-500/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                                    <AlertCircle size={14} className="flex-shrink-0" />
                                    {sanitizeError(error)}
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                ) : (
                    /* Chat Messages */
                    <div className="space-y-1">
                        {messages.map((msg: ChatMessageType) => (
                            <ChatMessage
                                key={msg.id}
                                role={msg.role}
                                content={msg.content}
                                media={msg.media}
                                timestamp={msg.timestamp}
                                onCreateImage={onCreateImage}
                                onCreateAllImages={onCreateAllImages}
                            />
                        ))}

                        {/* Loading indicator */}
                        {isLoading && (
                            <div className="flex justify-start mb-4">
                                <div className={`rounded-2xl rounded-bl-md px-4 py-3 ${isDark ? 'bg-neutral-800' : 'bg-gray-50 border border-gray-100'}`}>
                                    <Loader2 className="w-5 h-5 sf-rainbow-text animate-spin" />
                                </div>
                            </div>
                        )}

                        {/* Error message */}
                        {error && (
                            <div className="flex justify-center mb-4">
                                <div className="bg-red-500/20 border border-red-500/50 rounded-lg px-4 py-2 text-red-400 text-sm">
                                    {sanitizeError(error)}
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className={`p-4 border-t ${isDark ? 'border-[var(--sf-border)]' : 'border-gray-100'}`}>
                <div className={`rounded-xl p-3 ${isDark ? 'bg-[var(--sf-bg-card)] border border-[var(--sf-border)]' : 'bg-gray-50 border border-gray-200'}`}>
                    {/* Attached Media Preview */}
                    {attachedMedia.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                            {attachedMedia.map((media) => {
                                const imgSrc = media.base64 ? `data:image/png;base64,${media.base64}` : media.url;
                                return (
                                    <div key={media.nodeId} className="relative">
                                        {media.type === 'image' ? (
                                            <img
                                                src={imgSrc}
                                                alt="Attached"
                                                className="w-14 h-14 object-cover rounded-lg cursor-pointer hover:brightness-75 transition-all"
                                                onClick={() => setPreviewImage(imgSrc)}
                                            />
                                        ) : (
                                            <video
                                                src={media.url}
                                                className="w-14 h-14 object-cover rounded-lg"
                                            />
                                        )}
                                        <button
                                            onClick={() => removeAttachment(media.nodeId)}
                                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white text-[10px]"
                                        >
                                            ×
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <textarea
                        ref={textareaRef}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onPaste={handlePaste}
                        placeholder={mode === 'agent' ? '告诉我你想做什么...' : t('chat.startJourney')}
                        className={`w-full bg-transparent text-sm outline-none mb-3 resize-none min-h-[24px] max-h-[120px] ${isDark ? 'text-white placeholder:text-neutral-500' : 'text-neutral-900 placeholder:text-neutral-400'}`}
                        rows={1}
                        style={{ scrollbarWidth: 'none' }}
                        disabled={isLoading}
                        onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            const newHeight = Math.min(target.scrollHeight, 120);
                            target.style.height = newHeight + 'px';
                            target.style.overflowY = target.scrollHeight > 120 ? 'auto' : 'hidden';
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                                multiple
                                className="hidden"
                                onChange={handleFileUpload}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-700 text-neutral-400 hover:text-white' : 'hover:bg-neutral-200 text-neutral-500 hover:text-neutral-900'}`}
                                title={t('chat.uploadImage')}
                            >
                                <ImagePlus size={16} />
                            </button>
                            <button
                                onClick={handleTranslate}
                                disabled={!message.trim() || isTranslating || isLoading}
                                className={`p-1.5 rounded-lg transition-colors ${
                                    !message.trim() || isTranslating
                                        ? isDark ? 'text-neutral-600 cursor-not-allowed' : 'text-neutral-300 cursor-not-allowed'
                                        : isDark ? 'hover:bg-neutral-700 text-neutral-400 hover:text-white' : 'hover:bg-neutral-200 text-neutral-500 hover:text-neutral-900'
                                }`}
                                title={t('chat.translate')}
                            >
                                {isTranslating ? <Loader2 size={16} className="animate-spin" /> : <Languages size={16} />}
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleSend}
                                disabled={isLoading || (!message.trim() && attachedMedia.length === 0)}
                                className={`p-2 rounded-lg transition-all ${isLoading || (!message.trim() && attachedMedia.length === 0)
                                    ? isDark ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    : isDark ? 'bg-transparent border border-white/20 text-white/80 hover:border-white/40 hover:text-white hover:shadow-[0_0_12px_rgba(255,255,255,0.08)]' : 'lt-btn-primary'
                                    }`}
                            >
                                {isLoading ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <Send size={14} />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            {/* Image Preview Lightbox */}
            {previewImage && (
                <div
                    className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center cursor-pointer"
                    onClick={() => setPreviewImage(null)}
                >
                    <img
                        src={previewImage}
                        alt="Preview"
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <button
                        onClick={() => setPreviewImage(null)}
                        className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
            )}
        </div >
    );
};

// ============================================================================
// TOOL CALL INDICATOR
// ============================================================================

const TOOL_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    storyboard_generate: { label: '生成分镜脚本', icon: LayoutGrid, color: 'text-purple-400' },
    image_generate_batch: { label: '批量生成图片', icon: Image, color: 'text-blue-400' },
    video_generate_batch: { label: '批量生成视频', icon: Video, color: 'text-emerald-400' },
    video_merge: { label: '合成视频', icon: Film, color: 'text-amber-400' },
    tts_generate: { label: '语音合成', icon: Mic, color: 'text-pink-400' },
    canvas_query: { label: '查看画布状态', icon: Eye, color: 'text-cyan-400' },
    describe_image: { label: '分析图片', icon: Eye, color: 'text-indigo-400' },
};

const ToolCallIndicator: React.FC<{ toolCall: ToolCallInfo; isDark: boolean }> = ({ toolCall, isDark }) => {
    const meta = TOOL_META[toolCall.tool] || { label: toolCall.tool, icon: Wrench, color: 'text-neutral-400' };
    const Icon = meta.icon;
    const isRunning = toolCall.status === 'running';
    const isDone = toolCall.status === 'done';

    return (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all ${
            isDark
                ? isRunning
                    ? 'bg-neutral-800/90 border border-purple-500/30 shadow-[0_0_8px_rgba(168,85,247,0.08)]'
                    : 'bg-neutral-800/60 border border-neutral-700/40'
                : isRunning
                    ? 'bg-purple-50/80 border border-purple-200'
                    : 'bg-gray-50 border border-gray-200'
        }`}>
            {isRunning ? (
                <div className="relative w-4 h-4 flex-shrink-0">
                    <div className="absolute inset-0 rounded-full border-[1.5px] border-purple-500/20" />
                    <div className="absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-purple-400 animate-spin" />
                </div>
            ) : isDone ? (
                <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
            ) : (
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
            )}
            <Icon size={13} className={`flex-shrink-0 ${isDone || !isDark ? meta.color : 'text-purple-300'}`} />
            <span className={`font-medium ${isDark ? 'text-neutral-200' : 'text-gray-700'}`}>{meta.label}</span>
            {isRunning && (
                <span className="ml-auto flex items-center gap-1">
                    <span className={`${isDark ? 'text-purple-400/70' : 'text-purple-500/70'}`}>处理中</span>
                    <span className="flex gap-0.5">
                        <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                </span>
            )}
        </div>
    );
};

// ============================================================================
// ACTION RESULT CARD
// ============================================================================

const ACTION_META: Record<string, { label: string; icon: React.ElementType; gradient: string }> = {
    create_storyboard_nodes: { label: '分镜已创建', icon: LayoutGrid, gradient: 'from-purple-500/20 to-blue-500/20' },
    create_and_generate_images: { label: '图片生成中', icon: Image, gradient: 'from-blue-500/20 to-cyan-500/20' },
    create_and_generate_videos: { label: '视频生成中', icon: Video, gradient: 'from-emerald-500/20 to-teal-500/20' },
    merge_videos: { label: '视频合成中', icon: Film, gradient: 'from-amber-500/20 to-orange-500/20' },
    generate_tts: { label: '语音生成中', icon: Mic, gradient: 'from-pink-500/20 to-rose-500/20' },
};

const ActionResultCard: React.FC<{ action: AgentAction; isDark: boolean }> = ({ action, isDark }) => {
    const meta = ACTION_META[action.type] || { label: action.type, icon: Zap, gradient: 'from-gray-500/20 to-gray-500/20' };
    const Icon = meta.icon;

    let detail = '';
    if (action.type === 'create_storyboard_nodes') {
        detail = `${action.data.scripts?.length || 0} 个场景`;
    } else if (action.type === 'create_and_generate_images') {
        detail = `${action.data.images?.length || 0} 张图片`;
    } else if (action.type === 'create_and_generate_videos') {
        detail = `${action.data.sourceNodeIds?.length || 0} 个视频`;
    }

    return (
        <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs ${
            isDark
                ? `bg-gradient-to-r ${meta.gradient} border border-white/[0.06]`
                : 'bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-200'
        }`}>
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/10' : 'bg-white shadow-sm'}`}>
                <Icon size={13} className={isDark ? 'text-white/80' : 'text-gray-600'} />
            </div>
            <div className="flex-1 min-w-0">
                <span className={`font-medium ${isDark ? 'text-white/90' : 'text-gray-800'}`}>{meta.label}</span>
                {detail && <span className={`ml-1.5 ${isDark ? 'text-white/50' : 'text-gray-500'}`}>· {detail}</span>}
            </div>
            <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
        </div>
    );
};

// ============================================================================
// QUICK ACTIONS
// ============================================================================

interface QuickAction {
    label: string;
    text: string;
    icon: React.ElementType;
}

const QuickActions: React.FC<{
    msg: AgentMessage;
    isDark: boolean;
    onSend: (text: string) => void;
}> = ({ msg, isDark, onSend }) => {
    const actions = useMemo(() => {
        const result: QuickAction[] = [];
        const actionTypes = msg.actions?.map(a => a.type) || [];
        const toolNames = msg.toolCalls?.map(t => t.tool) || [];

        if (actionTypes.includes('create_storyboard_nodes')) {
            result.push({ label: '开始生成图片', text: '开始生成所有分镜图片', icon: Image });
            result.push({ label: '调整分镜', text: '帮我调整一下分镜内容', icon: RefreshCw });
        } else if (actionTypes.includes('create_and_generate_images')) {
            result.push({ label: '生成视频', text: '图片好了，帮我生成视频，先告诉我有哪些模型可以选', icon: Video });
            result.push({ label: '合成视频', text: '帮我把所有视频合成一个', icon: Film });
        } else if (actionTypes.includes('create_and_generate_videos')) {
            result.push({ label: '合成视频', text: '帮我合成所有视频', icon: Film });
            result.push({ label: '添加配音', text: '帮我添加旁白配音', icon: Mic });
        } else if (actionTypes.includes('merge_videos')) {
            result.push({ label: '添加配音', text: '帮我给合成视频添加旁白', icon: Mic });
        } else if (toolNames.includes('canvas_query')) {
            result.push({ label: '生成图片', text: '帮我生成画布上的图片', icon: Image });
            result.push({ label: '生成视频', text: '帮我把图片转成视频，先告诉我有哪些模型', icon: Video });
        }

        if (result.length === 0) {
            result.push({ label: '查看画布', text: '查看一下画布上有什么', icon: Eye });
            result.push({ label: '创建分镜', text: '帮我创建一组分镜', icon: LayoutGrid });
        }

        return result;
    }, [msg.actions, msg.toolCalls]);

    if (actions.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
            {actions.map((action, i) => {
                const Icon = action.icon;
                return (
                    <button
                        key={i}
                        onClick={() => onSend(action.text)}
                        className={`group flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                            isDark
                                ? 'bg-neutral-800/70 hover:bg-neutral-700/80 border border-neutral-700/50 hover:border-purple-500/40 text-neutral-300 hover:text-white'
                                : 'bg-white hover:bg-gray-50 border border-gray-200 hover:border-blue-300 text-gray-600 hover:text-gray-900 shadow-sm'
                        }`}
                    >
                        <Icon size={13} className={`${isDark ? 'text-neutral-500 group-hover:text-purple-400' : 'text-gray-400 group-hover:text-blue-500'} transition-colors`} />
                        {action.label}
                        <ArrowRight size={11} className={`${isDark ? 'text-neutral-600 group-hover:text-purple-400' : 'text-gray-300 group-hover:text-blue-400'} transition-colors`} />
                    </button>
                );
            })}
        </div>
    );
};

// ============================================================================
// CHAT BUBBLE
// ============================================================================

/**
 * ChatBubble - Floating button to open chat
 */
interface ChatBubbleProps {
    onClick: () => void;
    isOpen: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ onClick, isOpen }) => {
    const { isDark } = useTheme();
    if (isOpen) return null;

    return isDark ? (
        <HoverBorderGradient
            as="button"
            containerClassName="fixed bottom-6 right-6 z-50 rounded-xl"
            className="w-12 h-12 rounded-xl flex items-center justify-center transition-all hover:scale-110 bg-transparent"
            duration={2}
            onClick={onClick}
        >
            <MessageSquare size={24} strokeWidth={1.8} />
        </HoverBorderGradient>
    ) : (
        <button
            className="fixed bottom-6 right-6 z-50 lt-btn-primary text-white w-12 h-12 rounded-xl flex items-center justify-center transition-all hover:scale-110 shadow-lg"
            onClick={onClick}
        >
            <MessageSquare size={24} strokeWidth={1.8} />
        </button>
    );
};
