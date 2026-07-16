/**
 * ChatMessage.tsx
 * 
 * Reusable message bubble component for the chat panel.
 * Displays user and assistant messages with multiple media support.
 * Renders code blocks with copy functionality.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTheme } from '../hooks/useTheme';
import { Copy, Check, ImagePlus, ChevronDown, Layers } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// ============================================================================
// IMAGE MODELS (mirrors NodeControls)
// ============================================================================

const QUICK_IMAGE_MODELS = [
    { id: 'chuhaibang', name: 'ChuHaiBang', group: 'ChuHaiBang' },
    { id: 'gem-3.0', name: 'Nano Banana Pro', group: 'Google' },
    { id: 'gem-3.1', name: 'Nano2', group: 'Google' },
    { id: 'gem-2.5', name: 'Nano Banana', group: 'Google' },
    { id: 'kling-img-3.0', name: '可灵 3.0', group: '可灵 Kling' },
    { id: 'kling-img-3.0-omni', name: '可灵 3.0-Omni', group: '可灵 Kling' },
    { id: 'kling-img-2.1', name: '可灵 2.1', group: '可灵 Kling' },
    { id: 'vidu-q2', name: '生数 Vidu q2', group: 'Vidu' },
    { id: 'si-4.0', name: '豆包 Seedream 4.0', group: '豆包 Seedream' },
    { id: 'si-4.5', name: '豆包 Seedream 4.5', group: '豆包 Seedream' },
    { id: 'si-5.0-lite', name: '豆包 Seedream 5.0-lite', group: '豆包 Seedream' },
    { id: 'jimeng-4.0', name: '即梦 4.0', group: '即梦 Jimeng' },
    { id: 'hunyuan-3.0', name: '混元 3.0', group: '混元 Hunyuan' },
    { id: 'qwen-0925', name: '千问 0925', group: '千问 Qwen' },
];

// ============================================================================
// TYPES
// ============================================================================

export interface CreateImageFromPrompt {
    prompt: string;
    imageModel: string;
    aspectRatio?: string;
    title?: string;
}

interface ChatMessageProps {
    role: 'user' | 'assistant';
    content: string;
    media?: {
        type: 'image' | 'video';
        url: string;
    }[];
    timestamp?: Date;
    onCreateImage?: (data: CreateImageFromPrompt) => void;
    onCreateAllImages?: (data: CreateImageFromPrompt[]) => void;
}

interface CodeBlockProps {
    code: string;
    onCreateImage?: (data: CreateImageFromPrompt) => void;
    isDark: boolean;
}

// ============================================================================
// CODE BLOCK COMPONENT
// ============================================================================

function tryParsePromptJson(code: string): { prompt: string; subject?: string; style?: string; lighting?: string; camera?: string; mood?: string; quality?: string; negative?: string } | null {
    try {
        const obj = JSON.parse(code);
        if (obj && typeof obj.prompt === 'string' && obj.prompt.length > 5) return obj;
    } catch { /* not JSON */ }
    return null;
}

function buildFullPrompt(obj: ReturnType<typeof tryParsePromptJson>): string {
    if (!obj) return '';
    const parts = [obj.prompt];
    if (obj.style) parts.push(obj.style);
    if (obj.lighting) parts.push(obj.lighting);
    if (obj.camera) parts.push(obj.camera);
    if (obj.mood) parts.push(obj.mood);
    if (obj.quality) parts.push(obj.quality);
    return parts.join(', ');
}

/** Clipboard content — matches Generate (joined prompt fields), not raw JSON. */
function getClipboardTextForCodeBlock(code: string): string {
    const parsed = tryParsePromptJson(code);
    return parsed ? buildFullPrompt(parsed) : code;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, onCreateImage, isDark }) => {
    const [copied, setCopied] = useState(false);
    const [showModelMenu, setShowModelMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const promptData = tryParsePromptJson(code);

    useEffect(() => {
        if (!showModelMenu) return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowModelMenu(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showModelMenu]);

    const handleCopy = () => {
        const text = getClipboardTextForCodeBlock(code);
        try {
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                }).catch(() => fallbackCopy(text));
            } else {
                fallbackCopy(text);
            }
        } catch {
            fallbackCopy(text);
        }
    };

    const fallbackCopy = (text: string) => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleGenerateWithModel = (modelId: string) => {
        if (!promptData || !onCreateImage) return;
        onCreateImage({
            prompt: buildFullPrompt(promptData),
            imageModel: modelId,
            aspectRatio: '16:9',
            title: promptData.subject || undefined,
        });
        setShowModelMenu(false);
    };

    const preSurface = isDark
        ? 'bg-neutral-900 border-neutral-700'
        : 'bg-gray-50 border-gray-200';
    const menuSurface = isDark
        ? 'bg-neutral-800 border-neutral-700'
        : 'bg-white border-gray-200 shadow-lg';
    const menuHeader = isDark
        ? 'text-neutral-500 bg-[#1f1f1f] border-neutral-700'
        : 'text-gray-500 bg-gray-50 border-gray-200';
    const menuItem = isDark
        ? 'text-neutral-200 hover:bg-neutral-700'
        : 'text-gray-800 hover:bg-gray-100';
    const generateBtn = isDark
        ? 'sf-rainbow-btn'
        : 'bg-white border border-gray-200 text-gray-800 shadow-sm hover:bg-gray-50';
    const copyBtn = isDark
        ? 'bg-neutral-700 hover:bg-neutral-600'
        : 'bg-gray-200 hover:bg-gray-300';
    const copyIcon = isDark ? 'text-neutral-300' : 'text-gray-600';

    return (
        <div className="relative my-2 group">
            <pre className={`border rounded-lg p-3 text-sm overflow-x-auto ${preSurface}`}>
                <code className="sf-rainbow-text whitespace-pre-wrap break-words">{code}</code>
            </pre>
            <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {promptData && onCreateImage && (
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => setShowModelMenu(v => !v)}
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors text-xs font-medium ${generateBtn}`}
                            title="Generate image from this prompt"
                        >
                            <ImagePlus size={13} />
                            <span>Generate</span>
                            <ChevronDown size={11} />
                        </button>
                        {showModelMenu && (
                            <div className={`absolute right-0 top-full mt-1 w-48 border rounded-lg shadow-xl z-50 overflow-hidden max-h-[360px] overflow-y-auto ${menuSurface}`}>
                                {(() => {
                                    const groups: string[] = [];
                                    QUICK_IMAGE_MODELS.forEach(m => { if (!groups.includes(m.group)) groups.push(m.group); });
                                    return groups.map((g, gi) => (
                                        <div key={g}>
                                            <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${menuHeader} ${gi > 0 ? 'border-t' : ''}`}>{g}</div>
                                            {QUICK_IMAGE_MODELS.filter(m => m.group === g).map(m => (
                                                <button key={m.id} onClick={() => handleGenerateWithModel(m.id)} className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${menuItem}`}>{m.name}</button>
                                            ))}
                                        </div>
                                    ));
                                })()}
                            </div>
                        )}
                    </div>
                )}
                <button
                    onClick={handleCopy}
                    className={`p-1.5 rounded-md transition-colors ${copyBtn}`}
                    title={copied ? 'Copied!' : 'Copy to clipboard'}
                >
                    {copied ? (
                        <Check size={14} className="text-green-400" />
                    ) : (
                        <Copy size={14} className={copyIcon} />
                    )}
                </button>
            </div>
        </div>
    );
};

// ============================================================================
// CONTENT PARSER
// ============================================================================

/**
 * Parses message content and extracts code blocks
 * Returns an array of content segments (text or code)
 */
function parseContent(content: string): Array<{ type: 'text' | 'code'; content: string }> {
    const segments: Array<{ type: 'text' | 'code'; content: string }> = [];

    // Regex to match code blocks (```...``` or ```language\n...```)
    const codeBlockRegex = /```(?:\w+)?\n?([\s\S]*?)```/g;

    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
        // Add text before the code block
        if (match.index > lastIndex) {
            const text = content.slice(lastIndex, match.index).trim();
            if (text) {
                segments.push({ type: 'text', content: text });
            }
        }

        // Add the code block
        segments.push({ type: 'code', content: match[1].trim() });
        lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last code block
    if (lastIndex < content.length) {
        const text = content.slice(lastIndex).trim();
        if (text) {
            segments.push({ type: 'text', content: text });
        }
    }

    // If no code blocks found, return the entire content as text
    if (segments.length === 0) {
        segments.push({ type: 'text', content: content });
    }

    return segments;
}

// ============================================================================
// COMPONENT
// ============================================================================

const GenerateAllBar: React.FC<{
    prompts: ReturnType<typeof tryParsePromptJson>[];
    onCreateAllImages?: (data: CreateImageFromPrompt[]) => void;
    isDark: boolean;
}> = ({ prompts, onCreateAllImages, isDark }) => {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showMenu) return;
        const h = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [showMenu]);

    const handleSelect = (modelId: string) => {
        if (!onCreateAllImages) return;
        const batch = prompts.map((p, i) => ({
            prompt: buildFullPrompt(p),
            imageModel: modelId,
            aspectRatio: '16:9' as string,
            title: `镜头${i + 1}`,
        }));
        onCreateAllImages(batch);
        setShowMenu(false);
    };

    const menuSurface = isDark
        ? 'bg-neutral-800 border-neutral-700'
        : 'bg-white border-gray-200 shadow-lg';
    const menuHeader = isDark
        ? 'text-neutral-500 bg-[#1f1f1f] border-neutral-700'
        : 'text-gray-500 bg-gray-50 border-gray-200';
    const menuItem = isDark
        ? 'text-neutral-200 hover:bg-neutral-700'
        : 'text-gray-800 hover:bg-gray-100';
    const barBorder = isDark ? 'border-neutral-700/50' : 'border-gray-200';
    const hintText = isDark ? 'text-neutral-500' : 'text-gray-500';
    const generateAllBtn = isDark
        ? 'shadow-lg shadow-black/30'
        : 'shadow-md shadow-gray-400/25';

    return (
        <div className={`mt-3 pt-3 border-t flex items-center gap-2 ${barBorder}`}>
            <div className="relative" ref={menuRef}>
                <button
                    onClick={() => setShowMenu(v => !v)}
                    className={`flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 hover:from-pink-400 hover:via-purple-400 hover:to-blue-400 rounded-lg transition-all text-white text-xs font-medium ${generateAllBtn}`}
                >
                    <Layers size={14} />
                    <span>Generate All ({prompts.length} shots)</span>
                    <ChevronDown size={12} />
                </button>
                {showMenu && (
                    <div className={`absolute left-0 bottom-full mb-1 w-48 border rounded-lg shadow-xl z-50 overflow-hidden max-h-[360px] overflow-y-auto ${menuSurface}`}>
                        {(() => {
                            const groups: string[] = [];
                            QUICK_IMAGE_MODELS.forEach(m => { if (!groups.includes(m.group)) groups.push(m.group); });
                            return groups.map((g, gi) => (
                                <div key={g}>
                                    <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${menuHeader} ${gi > 0 ? 'border-t' : ''}`}>{g}</div>
                                    {QUICK_IMAGE_MODELS.filter(m => m.group === g).map(m => (
                                        <button key={m.id} onClick={() => handleSelect(m.id)} className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${menuItem}`}>{m.name}</button>
                                    ))}
                                </div>
                            ));
                        })()}
                    </div>
                )}
            </div>
            <span className={`text-[10px] ${hintText}`}>Select model to generate all shots at once</span>
        </div>
    );
};

export const ChatMessage: React.FC<ChatMessageProps> = ({
    role,
    content,
    media,
    timestamp,
    onCreateImage,
    onCreateAllImages,
}) => {
    const isUser = role === 'user';
    const { isDark } = useTheme();

    // Clean content and parse code blocks
    const cleanedContent = content.replace(/\[IMAGE \d+ ATTACHED\]/g, '').trim();
    const segments = parseContent(cleanedContent);

    const allPrompts = useMemo(() => {
        return segments
            .filter(s => s.type === 'code')
            .map(s => tryParsePromptJson(s.content))
            .filter((p): p is NonNullable<typeof p> => p !== null);
    }, [segments]);

    const showGenerateAll = !isUser && allPrompts.length >= 2 && onCreateAllImages;

    const markdownComponents = useMemo(() => ({
        p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
        ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
        ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
        li: ({ children }: { children?: React.ReactNode }) => <li className="ml-1">{children}</li>,
        h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-bold mb-2 mt-3">{children}</h1>,
        h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-bold mb-1.5 mt-2">{children}</h2>,
        h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-semibold mb-1 mt-2">{children}</h3>,
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
            const safeHref = href && /^(https?:|mailto:|#|\/)/i.test(href) ? href : undefined;
            return <a href={safeHref} target="_blank" rel="noopener noreferrer" className="sf-rainbow-text hover:underline">{children}</a>;
        },
        code: ({ children }: { children?: React.ReactNode }) => (
            <code className={`px-1.5 py-0.5 rounded text-xs sf-rainbow-text ${isDark ? 'bg-neutral-900/60' : 'bg-gray-100'}`}>{children}</code>
        ),
        blockquote: ({ children }: { children?: React.ReactNode }) => (
            <blockquote className={`border-l-2 pl-3 my-2 italic ${isDark ? 'border-neutral-600 text-neutral-400' : 'border-gray-300 text-gray-600'}`}>{children}</blockquote>
        ),
    }), [isDark]);

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
            <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${isUser
                    ? isDark ? 'bg-neutral-800 text-neutral-100 rounded-br-md' : 'bg-gray-50 text-gray-700 border border-gray-100 rounded-br-md'
                    : isDark ? 'bg-neutral-800 text-neutral-100 rounded-bl-md' : 'bg-gray-50 text-gray-700 border border-gray-100 rounded-bl-md'
                    }`}
            >
                {/* Media Attachments */}
                {media && media.length > 0 && (
                    <div className={`mb-2 ${media.length > 1 ? 'grid grid-cols-2 gap-2' : ''}`}>
                        {media.map((m, index) => (
                            <div key={index} className="relative">
                                {m.type === 'image' ? (
                                    <img
                                        src={m.url}
                                        alt={`Attached ${index + 1}`}
                                        className="w-full max-h-32 rounded-lg object-cover"
                                    />
                                ) : (
                                    <video
                                        src={m.url}
                                        className="w-full max-h-32 rounded-lg object-cover"
                                        controls
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Message Content with Markdown */}
                <div className="text-sm leading-relaxed select-text cursor-text chat-markdown">
                    {segments.map((segment, index) => (
                        segment.type === 'code' ? (
                            <CodeBlock key={index} code={segment.content} onCreateImage={onCreateImage} isDark={isDark} />
                        ) : (
                            <ReactMarkdown
                                key={index}
                                components={markdownComponents}
                            >
                                {segment.content}
                            </ReactMarkdown>
                        )
                    ))}
                </div>

                {/* Generate All Shots Bar */}
                {showGenerateAll && (
                    <GenerateAllBar prompts={allPrompts} onCreateAllImages={onCreateAllImages} isDark={isDark} />
                )}

                {/* Timestamp (optional) */}
                {timestamp && (
                    <div
                        className={`text-[10px] mt-1 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}
                    >
                        {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                )}
            </div>
        </div>
    );
};
