/**
 * VideoEditorModal.tsx
 * 
 * Full-screen video editor modal with timeline trimming controls.
 * Allows users to set trim start/end points and export to library.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Play, Pause, Download, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ============================================================================
// TYPES
// ============================================================================

interface VideoEditorModalProps {
    isOpen: boolean;
    nodeId: string | null;
    videoUrl?: string;
    initialTrimStart?: number;
    initialTrimEnd?: number;
    onClose: () => void;
    onExport: (nodeId: string, trimStart: number, trimEnd: number, videoUrl: string) => void;
}

// ============================================================================
// HELPER: Format time as MM:SS.ms
// ============================================================================

const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

// ============================================================================
// COMPONENT
// ============================================================================

export const VideoEditorModal: React.FC<VideoEditorModalProps> = ({
    isOpen,
    nodeId,
    videoUrl,
    initialTrimStart = 0,
    initialTrimEnd,
    onClose,
    onExport
}) => {
    // --- State ---
    const { t } = useTranslation();
    const videoRef = useRef<HTMLVideoElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [trimStart, setTrimStart] = useState(initialTrimStart);
    const [trimEnd, setTrimEnd] = useState(initialTrimEnd ?? 0);
    const [isDragging, setIsDragging] = useState<'start' | 'end' | 'playhead' | null>(null);

    // --- Effects ---

    // Reset state when modal opens with new video
    useEffect(() => {
        if (isOpen && videoUrl) {
            setTrimStart(initialTrimStart);
            setCurrentTime(initialTrimStart);
            setIsPlaying(false);
            setDuration(0); // Reset duration to trigger re-detection
        }
    }, [isOpen, videoUrl, initialTrimStart]);

    // Load video duration - simplified effect
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !isOpen || !videoUrl) return;

        const handleLoadedMetadata = () => {
            const dur = video.duration;
            console.log('[VideoEditor] Video metadata loaded, duration:', dur);
            if (dur && dur > 0 && !isNaN(dur)) {
                setDuration(dur);
                setTrimEnd(prev => prev === 0 ? dur : prev);
            }
        };

        const handleTimeUpdate = () => {
            const time = video.currentTime;
            setCurrentTime(time);
            // Loop within trim range (only if trimEnd is set)
            if (trimEnd > 0 && time >= trimEnd) {
                video.currentTime = trimStart;
                video.pause();
                setIsPlaying(false);
            }
        };

        // If video is already loaded, immediately get duration
        if (video.readyState >= 1 && video.duration > 0) {
            handleLoadedMetadata();
        }

        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('timeupdate', handleTimeUpdate);

        return () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('timeupdate', handleTimeUpdate);
        };
    }, [isOpen, videoUrl, trimStart, trimEnd]);


    // --- Handlers ---

    const togglePlayPause = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        if (isPlaying) {
            video.pause();
        } else {
            // Start from trim start if at the end
            if (video.currentTime >= trimEnd || video.currentTime < trimStart) {
                video.currentTime = trimStart;
            }
            video.play();
        }
        setIsPlaying(!isPlaying);
    }, [isPlaying, trimStart, trimEnd]);

    const handleTimelineMouseDown = useCallback((e: React.MouseEvent, type: 'start' | 'end' | 'playhead') => {
        e.preventDefault();
        setIsDragging(type);
    }, []);

    const handleTimelineMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging || !timelineRef.current || !videoRef.current) return;

        const rect = timelineRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const time = (x / rect.width) * duration;

        if (isDragging === 'start') {
            const newStart = Math.max(0, Math.min(time, trimEnd - 0.1));
            setTrimStart(newStart);
            videoRef.current.currentTime = newStart;
            setCurrentTime(newStart);
        } else if (isDragging === 'end') {
            const newEnd = Math.max(trimStart + 0.1, Math.min(time, duration));
            setTrimEnd(newEnd);
        } else if (isDragging === 'playhead') {
            const newTime = Math.max(trimStart, Math.min(time, trimEnd));
            videoRef.current.currentTime = newTime;
            setCurrentTime(newTime);
        }
    }, [isDragging, duration, trimStart, trimEnd]);

    const handleTimelineMouseUp = useCallback(() => {
        setIsDragging(null);
    }, []);

    const handleExportClick = useCallback(() => {
        if (!nodeId || !videoUrl) return;
        onExport(nodeId, trimStart, trimEnd, videoUrl);
    }, [nodeId, videoUrl, trimStart, trimEnd, onExport]);

    const jumpToStart = useCallback(() => {
        if (videoRef.current) {
            videoRef.current.currentTime = trimStart;
            setCurrentTime(trimStart);
        }
    }, [trimStart]);

    const jumpToEnd = useCallback(() => {
        if (videoRef.current) {
            videoRef.current.currentTime = trimEnd - 0.1;
            setCurrentTime(trimEnd - 0.1);
        }
    }, [trimEnd]);

    // --- Render ---

    if (!isOpen) return null;

    const startPercent = duration > 0 ? (trimStart / duration) * 100 : 0;
    const endPercent = duration > 0 ? (trimEnd / duration) * 100 : 100;
    const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    const trimDuration = trimEnd - trimStart;

    return (
        <div
            className="fixed inset-0 z-[9999] bg-black/90 flex flex-col"
            onMouseMove={handleTimelineMouseMove}
            onMouseUp={handleTimelineMouseUp}
            onMouseLeave={handleTimelineMouseUp}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
                <h2 className="text-lg font-semibold text-white">{t('modals.videoEditor.title')}</h2>
                <button
                    onClick={onClose}
                    className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Main Content - scrollable to ensure timeline is visible */}
            <div className="flex-1 flex flex-col items-center p-8 gap-6 overflow-y-auto min-h-0">
                {/* Video Preview - limit height to ensure timeline fits */}
                {videoUrl ? (
                    <div className="relative w-full max-w-4xl flex-shrink-0">
                        <video
                            ref={videoRef}
                            src={videoUrl}
                            className="w-full max-h-[50vh] object-contain rounded-xl shadow-2xl mx-auto"
                            onClick={togglePlayPause}
                        />
                        {/* Play/Pause Overlay */}
                        <div
                            className="absolute inset-0 flex items-center justify-center cursor-pointer"
                            onClick={togglePlayPause}
                        >
                            {!isPlaying && (
                                <div className="w-20 h-20 rounded-full bg-black/50 flex items-center justify-center">
                                    <Play className="w-10 h-10 text-white ml-1" />
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="text-neutral-500 text-center">
                        <p>{t('modals.videoEditor.noVideo')}</p>
                        <p className="text-sm mt-2">{t('modals.videoEditor.noVideoHint')}</p>
                    </div>
                )}

                {/* Timeline Controls - show even while loading */}
                {videoUrl && (
                    <div className="w-full max-w-4xl space-y-4 flex-shrink-0">
                        {/* Playback Controls */}
                        <div className="flex items-center justify-center gap-4">
                            <button
                                onClick={jumpToStart}
                                className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
                            >
                                <SkipBack size={20} />
                            </button>
                            <button
                                onClick={togglePlayPause}
                                className="p-3 rounded-full sf-rainbow-btn transition-colors"
                            >
                                {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
                            </button>
                            <button
                                onClick={jumpToEnd}
                                className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
                            >
                                <SkipForward size={20} />
                            </button>
                        </div>

                        {/* Timeline */}
                        <div
                            ref={timelineRef}
                            className="relative h-16 bg-neutral-900 rounded-lg cursor-pointer select-none"
                            onMouseDown={(e) => handleTimelineMouseDown(e, 'playhead')}
                        >
                            {/* Full Duration Bar */}
                            <div className="absolute inset-y-0 left-0 right-0 bg-neutral-800 rounded-lg" />

                            {/* Selected Range */}
                            <div
                                className="absolute inset-y-0 bg-white/10 border-y-2 border-white/30"
                                style={{
                                    left: `${startPercent}%`,
                                    right: `${100 - endPercent}%`
                                }}
                            />

                            {/* Start Handle */}
                            <div
                                className="absolute top-0 bottom-0 w-3 bg-green-500 cursor-ew-resize flex items-center justify-center rounded-l-lg hover:bg-green-400 transition-colors"
                                style={{ left: `calc(${startPercent}% - 6px)` }}
                                onMouseDown={(e) => { e.stopPropagation(); handleTimelineMouseDown(e, 'start'); }}
                            >
                                <div className="w-0.5 h-8 bg-green-300 rounded" />
                            </div>

                            {/* End Handle */}
                            <div
                                className="absolute top-0 bottom-0 w-3 bg-red-500 cursor-ew-resize flex items-center justify-center rounded-r-lg hover:bg-red-400 transition-colors"
                                style={{ left: `calc(${endPercent}% - 6px)` }}
                                onMouseDown={(e) => { e.stopPropagation(); handleTimelineMouseDown(e, 'end'); }}
                            >
                                <div className="w-0.5 h-8 bg-red-300 rounded" />
                            </div>

                            {/* Playhead */}
                            <div
                                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
                                style={{ left: `${playheadPercent}%` }}
                            >
                                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full" />
                            </div>
                        </div>

                        {/* Time Display */}
                        <div className="flex justify-between text-sm text-neutral-400">
                            <span className="text-green-400">{t('modals.videoEditor.start')}: {formatTime(trimStart)}</span>
                            <span className="text-white">{t('modals.videoEditor.current')}: {formatTime(currentTime)}</span>
                            <span className="text-red-400">{t('modals.videoEditor.end')}: {formatTime(trimEnd)}</span>
                        </div>

                        {/* Trim Duration */}
                        <div className="text-center text-neutral-500 text-sm">
                            {t('modals.videoEditor.selectedDuration')}: <span className="text-white font-medium">{formatTime(trimDuration)}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-4 px-6 py-4 border-t border-neutral-800">
                <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                    {t('modals.videoEditor.cancel')}
                </button>
                <button
                    onClick={handleExportClick}
                    disabled={!videoUrl}
                    className="px-6 py-2 rounded-lg sf-rainbow-btn font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <Download size={18} />
                    {t('modals.videoEditor.exportToLibrary')}
                </button>
            </div>
        </div>
    );
};
