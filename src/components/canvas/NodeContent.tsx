/**
 * NodeContent.tsx
 * 
 * Displays the content area of a canvas node.
 * Handles result display (image/video) and placeholder states.
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Maximize2, ImageIcon as ImageIcon, Film, Upload, Pencil, Video, GripVertical, Download, Expand, Shrink, HardDrive, Sparkles } from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { assetUrl, ossResize, ossVideoPoster } from '../../config/api';
import { useTheme } from '../../hooks/useTheme';

const TYPICAL_DURATIONS: Record<string, number> = {
    image: 15, video: 60, local: 30
};

function useElapsedTime(isLoading: boolean, startTime?: number) {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!isLoading) { setElapsed(0); return; }
        const origin = startTime || Date.now();
        const tick = () => setElapsed(Math.floor((Date.now() - origin) / 1000));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [isLoading, startTime]);
    return elapsed;
}

interface NodeContentProps {
    data: NodeData;
    inputUrl?: string;
    selected: boolean;
    isIdle: boolean;
    isLoading: boolean;
    isSuccess: boolean;
    aspectRatioStyle: { aspectRatio: string };
    onUpload?: (nodeId: string, imageDataUrl: string) => void;
    onExpand?: (imageUrl: string) => void;
    isMediaExpanded?: boolean;
    onDragStart?: (nodeId: string, hasContent: boolean) => void;
    onDragEnd?: () => void;
    // Text node callbacks
    onWriteContent?: (nodeId: string) => void;
    onTextToVideo?: (nodeId: string) => void;
    onTextToImage?: (nodeId: string) => void;
    // Image node callbacks
    onImageToImage?: (nodeId: string) => void;
    onImageToVideo?: (nodeId: string) => void;
    onUpdate?: (nodeId: string, updates: Partial<NodeData>) => void;
}

export const NodeContent: React.FC<NodeContentProps> = React.memo(({
    data,
    inputUrl,
    selected,
    isIdle,
    isLoading,
    isSuccess,
    aspectRatioStyle,
    onUpload,
    onExpand,
    isMediaExpanded,
    onDragStart,
    onDragEnd,
    onWriteContent,
    onTextToVideo,
    onTextToImage,
    onImageToImage,
    onImageToVideo,
    onUpdate,
}) => {
    const { isDark } = useTheme();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    const isImageType = data.type === NodeType.IMAGE || data.type === NodeType.LOCAL_IMAGE_MODEL;
    const isVideoType = data.type === NodeType.VIDEO || data.type === NodeType.LOCAL_VIDEO_MODEL;
    const isLocalModel = data.type === NodeType.LOCAL_IMAGE_MODEL || data.type === NodeType.LOCAL_VIDEO_MODEL;

    const elapsed = useElapsedTime(isLoading, data.generationStartTime);
    const typicalDuration = isVideoType ? TYPICAL_DURATIONS.video : isLocalModel ? TYPICAL_DURATIONS.local : TYPICAL_DURATIONS.image;
    const progressPct = Math.min(95, Math.round((elapsed / typicalDuration) * 100));
    const formatElapsed = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

    // Local state for text node textarea to prevent lag
    const [localPrompt, setLocalPrompt] = useState(data.prompt || '');
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt);

    // Sync local state ONLY when data.prompt changes externally (not from our own update)
    useEffect(() => {
        if (data.prompt !== lastSentPromptRef.current) {
            setLocalPrompt(data.prompt || '');
            lastSentPromptRef.current = data.prompt;
        }
    }, [data.prompt]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
            }
        };
    }, []);

    // Auto play/pause video based on node selection, expand state, and loading state
    useEffect(() => {
        const vid = videoRef.current;
        if (!vid) return;
        if (selected && !isMediaExpanded && !isLoading) {
            vid.play().catch(() => {});
        } else {
            vid.pause();
        }
    }, [selected, isMediaExpanded, isLoading]);

    const handleTextChange = (value: string) => {
        setLocalPrompt(value); // Update local state immediately
        lastSentPromptRef.current = value; // Track that we're about to send this

        // Debounce parent update
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        updateTimeoutRef.current = setTimeout(() => {
            onUpdate?.(data.id, { prompt: value });
        }, 150);
    };

    // Drag-drop state for the placeholder area
    const [isFileDragOver, setIsFileDragOver] = useState(false);

    const uploadFile = (file: File) => {
        if (!onUpload || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onloadend = () => onUpload(data.id, reader.result as string);
        reader.readAsDataURL(file);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) uploadFile(file);
    };

    const handleFileDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsFileDragOver(false);
        if (!onUpload) return;

        const file = e.dataTransfer.files?.[0];
        if (file) uploadFile(file);
    };

    const handleFilePaste = (e: React.ClipboardEvent) => {
        if (!onUpload) return;
        const clipboard = e.clipboardData;
        if (!clipboard) return;

        let file: File | null = null;

        if (clipboard.items?.length) {
            for (const item of Array.from(clipboard.items)) {
                if (item.type.startsWith('image/')) {
                    file = item.getAsFile();
                    if (file) break;
                }
            }
        }

        if (!file && clipboard.files?.length) {
            for (const f of Array.from(clipboard.files)) {
                if (f.type.startsWith('image/')) { file = f; break; }
            }
        }

        if (file) {
            e.preventDefault();
            e.stopPropagation();
            uploadFile(file);
        }
    };

    return (
        <div className={`transition-all duration-200 ${!selected ? 'p-0 rounded-2xl overflow-hidden' : 'p-1'}`}>
            {/* Hidden File Input - Always rendered for upload functionality (image types only) */}
            {isImageType && onUpload && (
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                />
            )}

            {/* Result View - Show whenever resultUrl exists, regardless of status */}
            {data.resultUrl ? (
                <div
                    className={`relative w-full bg-black group/image ${!selected ? '' : 'rounded-xl overflow-hidden'}`}
                    style={aspectRatioStyle}
                >
                    {isVideoType ? (
                        <div className="absolute inset-0">
                            <video
                                ref={videoRef}
                                src={assetUrl(data.resultUrl)}
                                poster={ossVideoPoster(assetUrl(data.resultUrl), 500) || undefined}
                                controls={selected && !isLoading && !isMediaExpanded}
                                loop
                                muted={!selected || isLoading || !!isMediaExpanded}
                                preload="metadata"
                                className={`w-full h-full object-cover ${isLoading ? 'pointer-events-none' : ''}`}
                                onPointerDown={(e) => { if (selected && !isLoading) e.stopPropagation(); }}
                            />
                            {/* Transparent drag overlay — covers everything except the bottom controls bar */}
                            {selected && !isLoading && (
                                <div
                                    className="absolute inset-0 cursor-move"
                                    style={{ bottom: 44 }}
                                    onPointerDown={() => { /* allow propagation for drag */ }}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        if (onExpand && data.resultUrl) {
                                            videoRef.current?.pause();
                                            onExpand(data.resultUrl);
                                        }
                                    }}
                                />
                            )}
                        </div>
                    ) : (
                        <div
                            className="absolute w-full h-full"
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (onExpand && data.resultUrl) onExpand(data.resultUrl);
                            }}
                        >
                            <img src={ossResize(assetUrl(data.resultUrl), 500)} alt="Generated" className="w-full h-full object-cover pointer-events-none" />
                            {/* Expand button (hover only) */}
                            {onExpand && !isLoading && (
                                <button
                                    className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/80 rounded-lg text-white opacity-0 group-hover/image:opacity-100 transition-all z-10"
                                    onClick={() => onExpand(data.resultUrl!)}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    title={t('nodes.viewFullSize')}
                                >
                                    <Maximize2 size={14} />
                                </button>
                            )}
                        </div>
                    )}

                    {isLoading && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                            <Loader2 size={40} className="animate-spin sf-rainbow-text" />
                            <span className="mt-3 text-sm text-white font-medium">{t('nodes.generating')}</span>
                            <div className="mt-2 w-3/4 max-w-[160px]">
                                <div className="h-1 rounded-full bg-white/20 overflow-hidden">
                                    <div className="h-full rounded-full bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 transition-all duration-1000" style={{ width: `${progressPct}%` }} />
                                </div>
                                <span className="block mt-1 text-[10px] text-white/60 text-center font-mono">{formatElapsed(elapsed)}</span>
                            </div>
                        </div>
                    )}

                    {data.isReversingPrompt && !isLoading && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm flex items-center gap-2 px-3 py-2 z-20">
                            <Sparkles size={14} className="animate-pulse text-purple-400 shrink-0" />
                            <span className="text-xs text-white/90">{t('contextMenu.reversingPrompt')}</span>
                        </div>
                    )}
                </div>
            ) : data.type === NodeType.TEXT ? (
                /* Text Node - Menu or Editing Mode */
                <div className={`relative w-full rounded-2xl overflow-hidden ${isDark ? 'bg-[#1a1a1a]' : 'bg-white border border-gray-200'} ${selected ? 'ring-1 ring-white/30' : ''}`}>
                    {data.textMode === 'editing' ? (
                        /* Editing Mode - Text Area */
                        <div className="p-4">
                            <textarea
                                value={localPrompt}
                                onChange={(e) => handleTextChange(e.target.value)}
                                onPointerDown={(e) => e.stopPropagation()}
                                onWheel={(e) => e.stopPropagation()}
                                onBlur={() => {
                                    // Ensure final value is saved on blur
                                    if (updateTimeoutRef.current) {
                                        clearTimeout(updateTimeoutRef.current);
                                    }
                                    if (localPrompt !== data.prompt) {
                                        onUpdate?.(data.id, { prompt: localPrompt });
                                    }
                                }}
                                placeholder={t('nodes.writeContentPlaceholder')}
                                className="w-full bg-transparent text-white text-sm resize-none outline-none placeholder:text-neutral-600"
                                style={{ minHeight: data.isPromptExpanded ? '300px' : '150px' }}
                                autoFocus
                            />
                            {/* Expand/Shrink Button */}
                            <div className="flex justify-end mt-2">
                                <button
                                    onClick={() => onUpdate?.(data.id, { isPromptExpanded: !data.isPromptExpanded })}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 rounded transition-colors"
                                    title={data.isPromptExpanded ? t('nodes.shrinkTextArea') : t('nodes.expandTextArea')}
                                >
                                    {data.isPromptExpanded ? <Shrink size={12} /> : <Expand size={12} />}
                                    <span>{data.isPromptExpanded ? t('nodes.shrink') : t('nodes.expand')}</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Menu Mode - Show Options */
                        <div className="p-5 flex flex-col gap-4">
                            {/* Header */}
                            <div className="text-neutral-500 text-sm font-medium">
                                {t('nodes.tryTo')}
                            </div>

                            {/* Menu Options */}
                            <div className="flex flex-col gap-1">
                                <TextNodeMenuItem
                                    icon={<Pencil size={16} />}
                                    label={t('nodes.writeYourOwnContent')}
                                    onClick={() => onWriteContent?.(data.id)}
                                    isDark={isDark}
                                />
                                <TextNodeMenuItem
                                    icon={<Video size={16} />}
                                    label={t('nodes.textToVideo')}
                                    onClick={() => onTextToVideo?.(data.id)}
                                    isDark={isDark}
                                />
                                <TextNodeMenuItem
                                    icon={<ImageIcon size={16} />}
                                    label={t('nodes.textToImage')}
                                    onClick={() => onTextToImage?.(data.id)}
                                    isDark={isDark}
                                />
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                /* Placeholder / Empty State for Image/Video */
                <div
                    className={`relative w-full aspect-[4/3] flex flex-col items-center justify-center gap-3 overflow-hidden
            ${isDark ? 'bg-[var(--sf-bg-deep)]' : 'bg-gray-50'}
            ${isLoading ? 'sf-pulse' : ''} 
            ${isFileDragOver ? `rounded-xl border-2 border-dashed ${isDark ? 'border-[var(--sf-cyan)] bg-[var(--sf-cyan)]/5' : 'border-blue-400 bg-blue-50'}` : !selected ? 'rounded-xl' : `rounded-xl border border-dashed ${isDark ? 'border-[var(--sf-border)]' : 'border-gray-200'}`}`}
                    tabIndex={isImageType && !isLoading ? 0 : undefined}
                    onDragOver={isImageType && onUpload ? (e) => { e.preventDefault(); e.stopPropagation(); setIsFileDragOver(true); } : undefined}
                    onDragEnter={isImageType && onUpload ? (e) => { e.preventDefault(); e.stopPropagation(); setIsFileDragOver(true); } : undefined}
                    onDragLeave={isImageType && onUpload ? (e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsFileDragOver(false); } : undefined}
                    onDrop={isImageType && onUpload ? handleFileDrop : undefined}
                    onPaste={isImageType && onUpload ? handleFilePaste : undefined}
                >
                    {/* Input Image Preview for Video Nodes */}
                    {isVideoType && inputUrl && (
                        <div className="absolute inset-0 z-0">
                            <img src={ossResize(assetUrl(inputUrl), 400)} alt={t('nodes.inputFrame')} className="w-full h-full object-cover opacity-30 blur-sm" />
                            <div className="absolute inset-0 bg-black/40" />
                            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-white font-medium flex items-center gap-1">
                                <ImageIcon size={10} />
                                {t('nodes.inputFrame')}
                            </div>
                        </div>
                    )}

                    {/* Drag overlay */}
                    {isFileDragOver && (
                        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/10 pointer-events-none">
                            <Upload size={32} className="sf-rainbow-text" />
                            <span className="mt-2 text-sm sf-rainbow-text font-medium">{t('nodes.dropImage')}</span>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="relative z-10 flex flex-col items-center gap-2">
                            <Loader2 size={32} className={`animate-spin ${isDark ? 'text-[var(--sf-cyan)]' : 'text-gray-500'}`} />
                            <span className={`text-xs font-mono tracking-wider ${isDark ? 'text-[var(--sf-cyan-dim)]' : 'text-gray-500'}`}>{t('nodes.generating')}</span>
                            <div className="w-3/4 max-w-[140px] mt-1">
                                <div className={`h-1 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
                                    <div className="h-full rounded-full bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 transition-all duration-1000" style={{ width: `${progressPct}%` }} />
                                </div>
                                <span className={`block mt-1 text-[10px] text-center font-mono ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{formatElapsed(elapsed)}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="relative z-10 flex flex-col items-center gap-3">
                            {/* Upload Button for Image Nodes (including local image models) */}
                            {isImageType && onUpload && (
                                <>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />
                                    {isDark ? (
                                        <HoverBorderGradient
                                            as="button"
                                            containerClassName="rounded-full"
                                            className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium bg-[var(--sf-bg-deep)] text-white"
                                            duration={2}
                                            onClick={() => fileInputRef.current?.click()}
                                            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
                                        >
                                            <Upload size={14} />
                                            {t('common.upload')}
                                        </HoverBorderGradient>
                                    ) : (
                                        <button
                                            className="lt-btn-primary text-white flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium"
                                            onClick={() => fileInputRef.current?.click()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                        >
                                            <Upload size={14} />
                                            {t('common.upload')}
                                        </button>
                                    )}
                                </>
                            )}

                            <div className="text-neutral-700">
                                {isVideoType ? (
                                    isLocalModel ? <><Film size={40} /><HardDrive size={16} className="absolute -bottom-1 -right-1 sf-rainbow-text" /></> : <Film size={40} />
                                ) : (
                                    isLocalModel ? <><ImageIcon size={40} /><HardDrive size={16} className="absolute -bottom-1 -right-1 sf-rainbow-text" /></> : <ImageIcon size={40} />
                                )}
                            </div>
                            {selected && (
                                <>
                                    <div className="text-neutral-500 text-sm font-medium">
                                        {isVideoType && inputUrl
                                            ? t('nodes.readyToAnimate')
                                            : isVideoType
                                                ? t('nodes.waitingForInput')
                                                : isLocalModel
                                                    ? t('nodes.selectModelAndPrompt')
                                                    : t('nodes.tryTo')
                                        }
                                    </div>
                                    {!isVideoType && !isLocalModel && (
                                        <div className="flex flex-col gap-1 w-full px-2">
                                            <TextNodeMenuItem
                                                icon={<ImageIcon size={16} />}
                                                label={t('nodes.imageToImage')}
                                                onClick={() => onImageToImage?.(data.id)}
                                                isDark={isDark}
                                            />
                                            <TextNodeMenuItem
                                                icon={<Film size={16} />}
                                                label={t('nodes.imageToVideo')}
                                                onClick={() => onImageToVideo?.(data.id)}
                                                isDark={isDark}
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface TextNodeMenuItemProps {
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
    isDark?: boolean;
}

/**
 * Menu item component for Text node options
 */
const TextNodeMenuItem: React.FC<TextNodeMenuItemProps> = ({ icon, label, onClick, isDark = true }) => (
    <button
        className={`flex items-center gap-3 w-full p-2.5 rounded-lg text-left transition-colors ${isDark ? 'text-neutral-400 hover:bg-[#252525] hover:text-white' : 'text-gray-500 hover:bg-gray-100'}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClick}
    >
        <span className="text-neutral-500">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
    </button>
);
