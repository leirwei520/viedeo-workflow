/**
 * ExpandedMediaModal.tsx
 * 
 * Gallery-style fullscreen media preview.
 * Shows a 2x2 grid of media items with the clicked item highlighted.
 * Click any item to view it solo with zoom/pan controls.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl, ossResize, API_URL, authFetch, isOssUrl } from '../../config/api';

// ============================================================================
// TYPES
// ============================================================================

export interface MediaItem {
    url: string;
    label?: string;
    isVideo?: boolean;
}

interface ExpandedMediaModalProps {
    mediaUrl: string | null;
    mediaList?: MediaItem[];
    onClose: () => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;
const GRID_COLS = 4;
const GRID_PAGE_SIZE = 8;

function detectVideo(url: string) {
    return url.includes('video') || url.endsWith('.mp4') || url.endsWith('.webm');
}

// ============================================================================
// SINGLE VIEW (zoom / pan)
// ============================================================================

const SingleView: React.FC<{
    url: string;
    isVideo: boolean;
    onBack?: () => void;
    onClose: () => void;
    onPrev?: () => void;
    onNext?: () => void;
}> = ({ url, isVideo, onBack, onClose, onPrev, onNext }) => {
    const { t } = useTranslation();
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const didDragRef = useRef(false);

    const handleDownload = useCallback(async () => {
        const fullUrl = assetUrl(url);
        const ext = isVideo ? 'mp4' : (url.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] || 'png');
        const filename = `download_${Date.now()}.${ext}`;
        const cleanUrl = fullUrl.split('?')[0];
        const isOss = isOssUrl(cleanUrl);

        const triggerBlob = (blob: Blob) => {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        };

        if (!isOss) {
            try {
                const res = await fetch(cleanUrl, { mode: 'cors', cache: 'no-store' });
                if (res.ok) { triggerBlob(await res.blob()); return; }
            } catch {}
        }

        try {
            const proxyRes = await authFetch(`${API_URL}/download?url=${encodeURIComponent(cleanUrl)}`);
            if (proxyRes.ok) { triggerBlob(await proxyRes.blob()); return; }
        } catch {}

        window.open(cleanUrl, '_blank');
    }, [url, isVideo]);

    useEffect(() => { setZoom(1); setPosition({ x: 0, y: 0 }); }, [url]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const onWheel = (e: WheelEvent) => e.preventDefault();
        container.addEventListener('wheel', onWheel, { passive: false });
        return () => container.removeEventListener('wheel', onWheel);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { onClose(); }
            else if (e.key === '0') { setZoom(1); setPosition({ x: 0, y: 0 }); }
            else if (e.key === '+' || e.key === '=') setZoom(p => Math.min(MAX_ZOOM, p + ZOOM_STEP));
            else if (e.key === '-') setZoom(p => Math.max(MIN_ZOOM, p - ZOOM_STEP));
            else if (e.key === 'ArrowLeft' && onPrev) onPrev();
            else if (e.key === 'ArrowRight' && onNext) onNext();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, onPrev, onNext]);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom(p => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p + delta)));
    }, []);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setIsDragging(true);
        didDragRef.current = false;
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, [position]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (isDragging) {
            didDragRef.current = true;
            setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
        }
    }, [isDragging, dragStart]);

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
        if (isDragging) {
            setIsDragging(false);
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
    }, [isDragging]);

    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget && !didDragRef.current) {
            onClose();
        }
    }, [onClose]);

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 flex items-center justify-center z-10"
            onClick={handleBackdropClick}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
            {onBack && (
                <button
                    className="absolute top-4 left-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-20"
                    onClick={(e) => { e.stopPropagation(); onBack(); }}
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                </button>
            )}

            {onPrev && (
                <button
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-2.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-20"
                    onClick={(e) => { e.stopPropagation(); onPrev(); }}
                >
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
            )}
            {onNext && (
                <button
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-2.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-20"
                    onClick={(e) => { e.stopPropagation(); onNext(); }}
                >
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
            )}

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2 z-20">
                <button className="p-1 text-white/80 hover:text-white" onClick={(e) => { e.stopPropagation(); setZoom(p => Math.max(MIN_ZOOM, p - ZOOM_STEP)); }}>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
                </button>
                <span className="text-white/90 text-sm font-medium min-w-[50px] text-center">{Math.round(zoom * 100)}%</span>
                <button className="p-1 text-white/80 hover:text-white" onClick={(e) => { e.stopPropagation(); setZoom(p => Math.min(MAX_ZOOM, p + ZOOM_STEP)); }}>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                </button>
                {zoom !== 1 && (
                    <button className="ml-2 px-2 py-0.5 text-xs text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded" onClick={(e) => { e.stopPropagation(); setZoom(1); setPosition({ x: 0, y: 0 }); }}>
                        {t('mediaModal.reset')}
                    </button>
                )}
                <div className="w-px h-4 bg-white/20" />
                <button
                    className="p-1 text-white/80 hover:text-white"
                    onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                    title={t('common.download')}
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                </button>
            </div>

            <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/50 text-sm pointer-events-none z-20">
                {t('mediaModal.zoomHint')}
            </div>

            <div
                className="max-w-[90vw] max-h-[90vh] select-none"
                style={{
                    transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {isVideo ? (
                    <video src={assetUrl(url)} controls autoPlay className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl" draggable={false} />
                ) : (
                    <img src={assetUrl(url)} alt="Preview" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl" draggable={false} />
                )}
            </div>
        </div>
    );
};

// ============================================================================
// GALLERY VIEW
// ============================================================================

const GalleryView: React.FC<{
    items: MediaItem[];
    activeIndex: number;
    onSelect: (index: number) => void;
    onClose: () => void;
}> = ({ items, activeIndex, onSelect, onClose }) => {

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div
            className="absolute inset-0 overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            {/* Scrollable content with side margins like a streaming platform */}
            <div className="mx-auto py-16 px-[8vw] lg:px-[12vw]">
                <div
                    className="grid gap-x-4 gap-y-8"
                    style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}
                >
                    {items.map((item, i) => {
                        const isActive = i === activeIndex;
                        const isVideo = item.isVideo ?? detectVideo(item.url);
                        return (
                            <div
                                key={i}
                                className="cursor-pointer group"
                                onClick={(e) => { e.stopPropagation(); onSelect(i); }}
                            >
                                {/* Thumbnail */}
                                <div
                                    className={`relative rounded-lg overflow-hidden transition-all duration-200 bg-neutral-900 ${isActive ? 'ring-2 ring-purple-400' : 'hover:ring-1 hover:ring-white/30'}`}
                                    style={{ aspectRatio: '16/9' }}
                                >
                                    {isVideo ? (
                                        <video
                                            src={assetUrl(item.url)}
                                            className="w-full h-full object-cover"
                                            muted
                                            playsInline
                                            preload="metadata"
                                            onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                                            onMouseLeave={(e) => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                                        />
                                    ) : (
                                        <img
                                            src={ossResize(assetUrl(item.url), 450)}
                                            alt={item.label || ''}
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                        />
                                    )}
                                    {isVideo && (
                                        <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[10px] text-white/80 font-medium tracking-wide">
                                            VIDEO
                                        </div>
                                    )}
                                </div>
                                {/* Info below card */}
                                <div className="mt-2 px-0.5">
                                    <p className="text-white/80 text-[13px] font-medium truncate group-hover:text-white transition-colors">
                                        {item.label || (isVideo ? 'Video' : 'Image')}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ExpandedMediaModal: React.FC<ExpandedMediaModalProps> = ({
    mediaUrl,
    mediaList,
    onClose
}) => {
    const items = useMemo(() => mediaList || [], [mediaList]);

    const initialIndex = useMemo(() => {
        if (!mediaUrl || items.length === 0) return -1;
        const idx = items.findIndex(m => m.url === mediaUrl);
        return idx >= 0 ? idx : -1;
    }, [mediaUrl, items]);

    const hasGallery = items.length > 1 && initialIndex >= 0;

    const [activeIndex, setActiveIndex] = useState(initialIndex);
    const [mode, setMode] = useState<'gallery' | 'single'>('single');

    useEffect(() => {
        setActiveIndex(initialIndex);
        setMode('single');
    }, [mediaUrl, initialIndex]);

    if (!mediaUrl) return null;

    const currentUrl = activeIndex >= 0 && activeIndex < items.length
        ? items[activeIndex]?.url || mediaUrl
        : mediaUrl;
    const isVideo = activeIndex >= 0 && activeIndex < items.length && items[activeIndex]
        ? (items[activeIndex].isVideo ?? detectVideo(items[activeIndex].url))
        : detectVideo(mediaUrl);

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100]">
            <button
                className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-30"
                onClick={onClose}
            >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            {mode === 'gallery' ? (
                <GalleryView
                    items={items}
                    activeIndex={activeIndex}
                    onSelect={(idx) => { setActiveIndex(idx); setMode('single'); }}
                    onClose={onClose}
                />
            ) : (
                <SingleView
                    url={currentUrl}
                    isVideo={isVideo}
                    onBack={undefined}
                    onClose={onClose}
                    onPrev={hasGallery && activeIndex > 0 ? () => setActiveIndex(p => Math.max(0, p - 1)) : undefined}
                    onNext={hasGallery && activeIndex >= 0 && activeIndex < items.length - 1 ? () => setActiveIndex(p => p + 1) : undefined}
                />
            )}
        </div>
    );
};
