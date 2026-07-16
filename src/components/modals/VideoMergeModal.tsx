import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { X, Loader2, Trash2, Film, ChevronDown, ChevronLeft, ChevronRight, Play, Pause, Clock, ZoomIn, ZoomOut, Minus, Music, Upload, Plus, Volume2, VolumeX, Type, Download, Settings2, Scissors, GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API_URL, API_BASE_URL, authFetch, assetUrl, isOssUrl } from '../../config/api';
import { sanitizeError } from '../../utils/errorSanitizer';
import { useTheme } from '../../hooks/useTheme';

// ============================================================================
// Types
// ============================================================================

interface VideoItem {
  id: string;
  url: string;
  name: string;
  thumbnail?: string;
}

const MIN_TRIM_SEC = 0.1;

interface EnrichedVideo extends VideoItem {
  /** Length used on timeline & merge (trimOut − trimIn). */
  duration: number;
  /** Full source file length in seconds. */
  sourceDuration: number;
  /** Start time in source file (seconds). */
  trimIn: number;
  /** End time in source file (seconds), exclusive. */
  trimOut: number;
  frames: string[];
  loading: boolean;
  volume: number;
  /** Playback speed multiplier (0.25 – 4.0, default 1.0). */
  speed: number;
}

interface AudioTrack {
  id: string;
  name: string;
  file?: File;
  url: string;
  duration: number;
  startTime: number;
  volume: number;
}

export interface SubtitleCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  outlineWidth: number;
  bold: boolean;
  position: 'bottom' | 'top' | 'center';
}

export interface SubtitleTrack {
  id: string;
  name: string;
  cues: SubtitleCue[];
  style: SubtitleStyle;
}

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'Noto Sans SC',
  fontSize: 48,
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 2,
  bold: true,
  position: 'bottom',
};

export interface PendingAudioTrack {
  url: string;
  name: string;
}

interface VideoMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialVideos?: VideoItem[];
  allVideos?: VideoItem[];
  onMerged?: (videoUrl: string, sourceIds: string[]) => void;
  initialSubtitleTracks?: SubtitleTrack[];
  initialAudioTracks?: PendingAudioTrack[];
}

const TRANSITIONS = [
  'fade', 'dissolve', 'wipeleft', 'wiperight',
  'slideup', 'slidedown', 'slideleft', 'slideright',
  'circlecrop', 'radial', 'none'
] as const;

type TransitionType = typeof TRANSITIONS[number];

const RESOLUTION_PRESETS = [
  { id: '1080p-landscape', w: 1920, h: 1080, label: 'resolution1080pLandscape' },
  { id: '1080p-portrait', w: 1080, h: 1920, label: 'resolution1080pPortrait' },
  { id: '720p-landscape', w: 1280, h: 720, label: 'resolution720pLandscape' },
  { id: '720p-portrait', w: 720, h: 1280, label: 'resolution720pPortrait' },
  { id: '4k-landscape', w: 3840, h: 2160, label: 'resolution4kLandscape' },
] as const;

// ============================================================================
// Frame extraction
// ============================================================================

const MAX_FRAMES = 60;

function ossVideoSnapshot(url: string, timeMs: number, width = 160): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}x-oss-process=video/snapshot,t_${Math.round(timeMs)},f_jpg,w_${width},m_fast`;
}

function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { const d = v.duration; v.src = ''; resolve(d && isFinite(d) ? d : 0); };
    v.onerror = () => resolve(0);
    v.src = url;
  });
}

async function extractFrames(videoUrl: string): Promise<{ duration: number; frames: string[] }> {
  if (isOssUrl(videoUrl)) {
    const dur = await getVideoDuration(videoUrl);
    if (!dur) return { duration: 0, frames: [] };
    const count = Math.max(4, Math.min(MAX_FRAMES, Math.ceil(dur * 2)));
    const frames = Array.from({ length: count }, (_, k) =>
      ossVideoSnapshot(videoUrl, ((dur * (k + 0.5)) / count) * 1000)
    );
    return { duration: dur, frames };
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';

    video.onloadedmetadata = () => {
      const dur = video.duration;
      if (!dur || !isFinite(dur)) { resolve({ duration: 0, frames: [] }); return; }

      const count = Math.max(4, Math.min(MAX_FRAMES, Math.ceil(dur * 2)));
      const frames: string[] = [];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = 160;
      canvas.height = 90;

      let i = 0;
      const times = Array.from({ length: count }, (_, k) => (dur * (k + 0.5)) / count);

      const captureNext = () => {
        if (i >= times.length) { video.src = ''; resolve({ duration: dur, frames }); return; }
        video.currentTime = times[i];
      };
      video.onseeked = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', 0.5));
        i++;
        captureNext();
      };
      captureNext();
    };
    video.onerror = () => resolve({ duration: 0, frames: [] });
    video.src = videoUrl;
  });
}

function formatTime(sec: number): string {
  if (sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  if (m > 0) return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  return `${s}.${ms}s`;
}

// ============================================================================
// Timeline Track component
// ============================================================================

const TRACK_HEIGHT = 56;
/** CapCut-style trim strip width (px); full source = time × pps, clamped for scroll. */
const TRIM_STRIP_MIN_W = 320;
const TRIM_STRIP_MAX_W = 2200;
const MIN_PPS = 15;   // min pixels per second
const MAX_PPS = 200;  // max pixels per second
const DEFAULT_PPS = 60;
const TRANSITION_GAP = 6;

interface TimelineProps {
  videos: EnrichedVideo[];
  pps: number;
  selectedIdx: number | null;
  dragOverIdx: number | null;
  onSelect: (idx: number) => void;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDrop: (idx: number) => void;
  onDragEnd: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (idx: number) => void;
  playheadTime: number;
  onPlayheadChange: (t: number) => void;
  transition: string;
  transitionDuration: number;
  t: (key: string) => string;
  isDark: boolean;
  onVideoVolumeChange: (idx: number, volume: number) => void;
  audioTracks: AudioTrack[];
  onAudioUpdate: (id: string, patch: Partial<AudioTrack>) => void;
  onAudioRemove: (id: string) => void;
  subtitleTracks: SubtitleTrack[];
  editingCueId: string | null;
  onCueClick: (cueId: string) => void;
  onSubtitleTrackRemove: (trackId: string) => void;
  trimModeIdx: number | null;
  onToggleTrimMode: (idx: number) => void;
  onClipTrim: (idx: number, trimIn?: number, trimOut?: number) => void;
  onClipTrimReset: (idx: number) => void;
}

const Timeline: React.FC<TimelineProps> = ({
  videos, pps, selectedIdx, dragOverIdx,
  onSelect, onDragStart, onDragOver, onDrop, onDragEnd,
  onMove, onRemove,
  playheadTime, onPlayheadChange,
  transition, transitionDuration, t, isDark,
  onVideoVolumeChange,
  audioTracks, onAudioUpdate, onAudioRemove,
  subtitleTracks, editingCueId, onCueClick, onSubtitleTrackRemove,
  trimModeIdx, onToggleTrimMode, onClipTrim, onClipTrimReset
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const isDraggingPlayhead = useRef(false);

  const clipWidths = videos.map(v => v.loading ? 80 : Math.max(40, v.duration * pps));
  const totalWidth = clipWidths.reduce((s, w) => s + w, 0) + Math.max(0, videos.length - 1) * TRANSITION_GAP;
  const totalDur = videos.reduce((s, v) => s + v.duration, 0);

  const maxAudioEnd = audioTracks.reduce((m, at) => Math.max(m, at.startTime + at.duration), 0);
  const maxSubEnd = subtitleTracks.reduce((m, st) => Math.max(m, ...st.cues.map(c => c.endTime)), 0);
  const effectiveEndTime = Math.max(totalDur, maxAudioEnd, maxSubEnd);
  const effectiveWidth = Math.max(totalWidth, effectiveEndTime * pps);

  // Time ruler ticks
  const tickInterval = pps >= 100 ? 1 : pps >= 40 ? 2 : pps >= 20 ? 5 : 10;
  const ticks: number[] = [];
  for (let ts = 0; ts <= effectiveEndTime + tickInterval; ts += tickInterval) ticks.push(ts);

  // Convert time to px
  const timeToPx = (time: number): number => {
    let px = 0;
    let elapsed = 0;
    for (let i = 0; i < videos.length; i++) {
      const d = videos[i].duration;
      if (elapsed + d >= time) {
        px += (time - elapsed) * pps;
        return px;
      }
      px += clipWidths[i] + (i < videos.length - 1 ? TRANSITION_GAP : 0);
      elapsed += d;
    }
    // After all videos end (or no videos): extend at pps rate so audio/subtitle clips
    // beyond video duration map to distinct x positions instead of stacking at the end.
    if (time > elapsed) px += (time - elapsed) * pps;
    return px;
  };

  // Convert px to time
  const pxToTime = (px: number): number => {
    let x = 0;
    let elapsed = 0;
    for (let i = 0; i < videos.length; i++) {
      const w = clipWidths[i];
      if (px <= x + w) {
        const frac = Math.max(0, px - x) / w;
        return elapsed + frac * videos[i].duration;
      }
      x += w + (i < videos.length - 1 ? TRANSITION_GAP : 0);
      elapsed += videos[i].duration;
    }
    // Beyond video area: continue at pps rate (mirror timeToPx so seek/drag stays consistent)
    if (px > x) elapsed += (px - x) / pps;
    return elapsed;
  };

  const handleRulerPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isDraggingPlayhead.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = rulerRef.current!.getBoundingClientRect();
    onPlayheadChange(pxToTime(e.clientX - rect.left));
  };

  const handleRulerPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingPlayhead.current) return;
    const rect = rulerRef.current!.getBoundingClientRect();
    onPlayheadChange(Math.max(0, Math.min(totalDur, pxToTime(e.clientX - rect.left))));
  };

  const handleRulerPointerUp = () => { isDraggingPlayhead.current = false; };

  const handleAudioPointerDown = (e: React.PointerEvent, at: AudioTrack) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const origLeft = timeToPx(at.startTime);
    const handlePointerMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const newTime = pxToTime(Math.max(0, origLeft + dx));
      onAudioUpdate(at.id, { startTime: Math.max(0, Math.min(totalDur - 0.1, newTime)) });
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const playheadPx = timeToPx(playheadTime);

  return (
    <div className="flex flex-col select-none">
      {/* Scrollable area for ruler + track */}
      <div ref={scrollRef} className="overflow-x-auto timeline-scroll" style={{ scrollbarWidth: 'thin', scrollbarColor: isDark ? '#333 #0d0d0d' : '#ccc #f0f0f0' }}>
        {/* Time ruler */}
        <div
          ref={rulerRef}
          className={`relative h-6 ${isDark ? 'bg-neutral-900 border-b border-neutral-800' : 'bg-gray-100 border-b border-gray-300'} cursor-pointer`}
          style={{ width: effectiveWidth + 60 }}
          onPointerDown={handleRulerPointerDown}
          onPointerMove={handleRulerPointerMove}
          onPointerUp={handleRulerPointerUp}
        >
          {ticks.map(ts => {
            const x = timeToPx(ts);
            if (x > totalWidth + 40) return null;
            return (
              <div key={ts} className="absolute top-0 flex flex-col items-center" style={{ left: x }}>
                <div className={`w-px h-2.5 ${isDark ? 'bg-neutral-600' : 'bg-gray-400'}`} />
                <span className={`text-[8px] font-mono ${isDark ? 'text-neutral-500' : 'text-gray-500'} mt-px leading-none`}>{formatTime(ts)}</span>
              </div>
            );
          })}
          {/* Playhead on ruler */}
          <div className="absolute top-0 z-10" style={{ left: playheadPx - 5 }}>
            <div className={`w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent ${isDark ? 'border-t-pink-400' : 'border-t-pink-500'}`} />
          </div>
        </div>

        {/* CapCut-style trim strip: full source filmstrip + dim discard + drag handles */}
        {trimModeIdx !== null && videos[trimModeIdx] && !videos[trimModeIdx].loading && videos[trimModeIdx].sourceDuration > 0 && (() => {
          const ti = trimModeIdx;
          const tv = videos[ti];
          const src = tv.sourceDuration;
          const stripW = Math.max(TRIM_STRIP_MIN_W, Math.min(TRIM_STRIP_MAX_W, src * pps));
          const FRAME_TARGET_W = 28;
          const visCount = Math.max(4, Math.round(stripW / FRAME_TARGET_W));
          const stripFrames: string[] = [];
          if (tv.frames.length > 0) {
            for (let fi = 0; fi < visCount; fi++) {
              const srcIdx = Math.min(tv.frames.length - 1, Math.round((fi * (tv.frames.length - 1)) / Math.max(1, visCount - 1)));
              stripFrames.push(tv.frames[srcIdx]);
            }
          }
          const fw = stripFrames.length > 0 ? stripW / stripFrames.length : stripW;
          const xL = (tv.trimIn / src) * stripW;
          const xR = (tv.trimOut / src) * stripW;

          const handleTrimEdgePointerDownLocal = (edge: 'left' | 'right') => (e: React.PointerEvent) => {
            e.stopPropagation();
            e.preventDefault();
            const target = e.currentTarget as HTMLElement;
            target.setPointerCapture(e.pointerId);
            const startX = e.clientX;
            const startIn = tv.trimIn;
            const startOut = tv.trimOut;
            const onMove = (ev: PointerEvent) => {
              const ds = (ev.clientX - startX) / pps;
              if (edge === 'left') onClipTrim(ti, startIn + ds, undefined);
              else onClipTrim(ti, undefined, startOut + ds);
            };
            const onUp = (ev: PointerEvent) => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              try { target.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          };

          const handlePanWindowPointerDown = (e: React.PointerEvent) => {
            e.stopPropagation();
            e.preventDefault();
            const target = e.currentTarget as HTMLElement;
            target.setPointerCapture(e.pointerId);
            const startX = e.clientX;
            const startIn = tv.trimIn;
            const startOut = tv.trimOut;
            const dur = startOut - startIn;
            const onMove = (ev: PointerEvent) => {
              const ds = (ev.clientX - startX) / pps;
              let ni = startIn + ds;
              let no = startOut + ds;
              if (ni < 0) {
                no -= ni;
                ni = 0;
              }
              if (no > src) {
                const over = no - src;
                ni -= over;
                no = src;
              }
              if (no - ni < MIN_TRIM_SEC) return;
              onClipTrim(ti, ni, no);
            };
            const onUp = (ev: PointerEvent) => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              try { target.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          };

          return (
            <div
              className={`shrink-0 border-b ${isDark ? 'border-neutral-800 bg-[#141414]' : 'border-gray-300 bg-[#f4f4f5]'}`}
              style={{ minWidth: effectiveWidth + 60 }}
            >
              <div className="flex items-center justify-between gap-3 px-3 pt-2 pb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`text-[11px] font-semibold shrink-0 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('videoMerge.trimPanelTitle')}</span>
                  <span className={`text-[10px] truncate ${isDark ? 'text-neutral-500' : 'text-gray-500'}`} title={tv.name}>{tv.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onClipTrimReset(ti)}
                    className={`text-[10px] px-2.5 py-1 rounded-lg border transition-colors ${
                      isDark ? 'border-neutral-600 text-neutral-300 hover:bg-neutral-800' : 'border-gray-300 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {t('videoMerge.resetTrim')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleTrimMode(ti)}
                    className={`text-[10px] px-3 py-1 rounded-lg font-medium text-white bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-500 hover:to-violet-500 shadow`}
                  >
                    {t('videoMerge.trimDone')}
                  </button>
                </div>
              </div>
              <p className={`px-3 pb-2 text-[10px] leading-snug ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>
                {t('videoMerge.trimCapCutHint')}
              </p>
              <div className="overflow-x-auto pb-3 px-3" style={{ scrollbarWidth: 'thin' }}>
                <div
                  className={`relative rounded-xl overflow-hidden ring-2 shadow-xl touch-none ${
                    isDark ? 'ring-white/25 shadow-black/50' : 'ring-black/15 shadow-black/10'
                  }`}
                  style={{ width: stripW, height: 72 }}
                >
                  {/* Film */}
                  <div className="absolute inset-0 flex bg-neutral-950">
                    {stripFrames.length > 0 ? stripFrames.map((fr, fi) => (
                      <img key={fi} src={fr} alt="" className="h-full object-cover shrink-0" draggable={false} style={{ width: fw, minWidth: 0 }} />
                    )) : (
                      <div className="flex-1 flex items-center justify-center"><Film size={22} className="text-neutral-700" /></div>
                    )}
                  </div>
                  {/* Discard overlays */}
                  <div className="absolute inset-y-0 left-0 bg-black/[0.58] pointer-events-none border-r border-white/15" style={{ width: xL }} />
                  <div className="absolute inset-y-0 right-0 bg-black/[0.58] pointer-events-none border-l border-white/15" style={{ width: stripW - xR }} />
                  {/* Selected window tint */}
                  <div
                    className="absolute inset-y-0 pointer-events-none border-x-[3px] border-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]"
                    style={{ left: xL, width: Math.max(8, xR - xL) }}
                  />
                  {/* Mid drag */}
                  <div
                    role="presentation"
                    className="absolute inset-y-0 z-[8] cursor-grab active:cursor-grabbing"
                    style={{ left: xL, width: Math.max(8, xR - xL) }}
                    onPointerDown={handlePanWindowPointerDown}
                  />
                  {/* Handles */}
                  <div
                    role="slider"
                    aria-label={t('videoMerge.trimIn')}
                    className="absolute top-0 bottom-0 z-[12] flex cursor-ew-resize flex-col items-center justify-center"
                    style={{ left: Math.max(0, xL - 10), width: 20 }}
                    onPointerDown={handleTrimEdgePointerDownLocal('left')}
                  >
                    <div className="flex h-[calc(100%-10px)] w-[11px] flex-col items-center rounded-md bg-white shadow-[2px_0_8px_rgba(0,0,0,0.45)] ring-1 ring-black/10">
                      <GripVertical size={14} className="my-auto shrink-0 text-neutral-700 opacity-90" strokeWidth={2.5} />
                    </div>
                  </div>
                  <div
                    role="slider"
                    aria-label={t('videoMerge.trimOut')}
                    className="absolute top-0 bottom-0 z-[12] flex cursor-ew-resize flex-col items-center justify-center"
                    style={{ left: Math.min(stripW - 20, xR - 10), width: 20 }}
                    onPointerDown={handleTrimEdgePointerDownLocal('right')}
                  >
                    <div className="flex h-[calc(100%-10px)] w-[11px] flex-col items-center rounded-md bg-white shadow-[-2px_0_8px_rgba(0,0,0,0.45)] ring-1 ring-black/10">
                      <GripVertical size={14} className="my-auto shrink-0 text-neutral-700 opacity-90" strokeWidth={2.5} />
                    </div>
                  </div>
                  {/* Time chips */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-1">
                    <div className="rounded-md bg-black/72 px-2 py-0.5 text-[10px] font-mono tabular-nums text-white backdrop-blur-[2px]">
                      <span>{formatTime(tv.trimIn)}</span>
                      <span className="mx-1 opacity-50">|</span>
                      <span>{formatTime(tv.trimOut)}</span>
                      <span className="mx-1.5 opacity-55">({formatTime(tv.duration)})</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Track */}
        <div className={`relative ${isDark ? 'bg-neutral-950' : 'bg-gray-200'}`} style={{ width: totalWidth + 60, height: TRACK_HEIGHT }}>
          {/* Clips */}
          <div className="flex h-full">
            {videos.map((video, idx) => {
              const w = clipWidths[idx];
              // Subsample frames based on zoom: target ~30px per visible frame
              const FRAME_TARGET_W = 30;
              const visibleCount = Math.max(1, Math.round(w / FRAME_TARGET_W));
              const sampledFrames: string[] = [];
              if (video.frames.length > 0) {
                for (let fi = 0; fi < visibleCount; fi++) {
                  const srcIdx = Math.min(video.frames.length - 1, Math.round(fi * (video.frames.length - 1) / Math.max(1, visibleCount - 1)));
                  sampledFrames.push(video.frames[srcIdx]);
                }
              }
              const frameW = sampledFrames.length > 0 ? w / sampledFrames.length : w;

              const trimActive = trimModeIdx === idx && !video.loading && video.sourceDuration > 0;

              return (
                <React.Fragment key={video.id}>
                  <div
                    draggable={!trimActive}
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => onDragOver(e, idx)}
                    onDrop={() => onDrop(idx)}
                    onDragEnd={onDragEnd}
                    onClick={() => onSelect(idx)}
                    title={`${idx + 1}. ${video.name} (${formatTime(video.duration)})`}
                    className={`relative shrink-0 h-full cursor-grab active:cursor-grabbing group/clip rounded-sm transition-all ${
                      selectedIdx === idx ? 'ring-2 ring-white/30 ring-inset' : ''
                    } ${dragOverIdx === idx ? 'ring-2 ring-yellow-400 ring-inset' : ''} ${
                      trimActive ? 'ring-2 ring-pink-500/60 ring-inset z-[5]' : ''
                    }`}
                    style={{ width: w }}
                  >
                    {/* Frame images — count adapts to zoom */}
                    <div className="flex h-full overflow-hidden rounded-sm">
                      {video.loading ? (
                        <div className={`flex-1 flex items-center justify-center ${isDark ? 'bg-neutral-800' : 'bg-gray-300'}`}>
                          <Loader2 size={14} className={`animate-spin ${isDark ? 'text-neutral-600' : 'text-gray-500'}`} />
                        </div>
                      ) : sampledFrames.length > 0 ? (
                        sampledFrames.map((frame, fi) => (
                          <img
                            key={fi} src={frame} alt=""
                            className="h-full object-cover"
                            style={{ width: frameW, minWidth: 0 }}
                            draggable={false}
                          />
                        ))
                      ) : (
                        <div className={`flex-1 flex items-center justify-center ${isDark ? 'bg-neutral-800' : 'bg-gray-300'}`}>
                          <Film size={14} className={isDark ? 'text-neutral-700' : 'text-gray-500'} />
                        </div>
                      )}
                    </div>


                    {/* Hover controls */}
                    <div className={`absolute top-0.5 right-0.5 flex items-center gap-px z-10 transition-opacity ${
                      trimModeIdx === idx || selectedIdx === idx ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100'
                    }`}>
                      {!video.loading && video.sourceDuration > 0 && (
                        <button
                          type="button"
                          title={t('videoMerge.trimTooltip')}
                          className={`flex items-center gap-1 rounded-md px-1 py-0.5 ${
                            trimModeIdx === idx
                              ? 'bg-gradient-to-r from-pink-600 to-violet-600 text-white shadow-md ring-1 ring-white/25'
                              : selectedIdx === idx
                                ? 'bg-neutral-900/92 text-white ring-1 ring-white/35 hover:bg-neutral-800'
                                : 'bg-black/82 text-neutral-200 hover:bg-black/70 hover:text-white'
                          }`}
                          onClick={(e) => { e.stopPropagation(); onToggleTrimMode(idx); }}
                          onPointerDown={e => e.stopPropagation()}
                        >
                          <Scissors size={12} strokeWidth={2.25} />
                          <span className="max-[380px]:hidden text-[10px] font-medium pr-0.5">{t('videoMerge.trim')}</span>
                        </button>
                      )}
                      {idx > 0 && (
                        <button type="button" className="bg-black/80 rounded p-px text-neutral-300 hover:text-white" onClick={(e) => { e.stopPropagation(); onMove(idx, idx - 1); }}>
                          <ChevronLeft size={10} />
                        </button>
                      )}
                      {idx < videos.length - 1 && (
                        <button type="button" className="bg-black/80 rounded p-px text-neutral-300 hover:text-white" onClick={(e) => { e.stopPropagation(); onMove(idx, idx + 1); }}>
                          <ChevronRight size={10} />
                        </button>
                      )}
                      <button type="button" className="bg-black/80 rounded p-px text-neutral-400 hover:text-red-400" onClick={(e) => { e.stopPropagation(); onRemove(idx); }}>
                        <Trash2 size={9} />
                      </button>
                    </div>

                    {/* Volume indicator */}
                    {video.volume === 0 && (
                      <div className="absolute bottom-1 left-1 z-10">
                        <VolumeX size={10} className="text-red-400/80" />
                      </div>
                    )}
                  </div>

                  {/* Transition gap */}
                  {idx < videos.length - 1 && (
                    <div
                      className={`shrink-0 flex items-center justify-center ${isDark ? 'bg-white/10' : 'bg-black/10'} relative`}
                      style={{ width: TRANSITION_GAP, height: TRACK_HEIGHT }}
                      title={t(`videoMerge.transitions.${transition}`) + ` ${transitionDuration}s`}
                    >
                      <div className={`w-px h-full ${isDark ? 'bg-white/50' : 'bg-black/30'}`} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Playhead line */}
          <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: playheadPx }}>
            <div className="w-px h-full bg-gradient-to-b from-pink-500 via-purple-500 to-blue-500" />
          </div>
        </div>

        {/* Audio tracks */}
        {audioTracks.map(at => {
          const leftPx = timeToPx(at.startTime);
          const widthPx = Math.max(20, at.duration * pps);
          return (
            <div key={at.id} className={`relative ${isDark ? 'bg-neutral-950 border-t border-neutral-800/50' : 'bg-gray-200 border-t border-gray-300'}`}
              style={{ width: effectiveWidth + 60, height: 28 }}>
              <div
                className={`absolute top-1 bottom-1 rounded cursor-grab active:cursor-grabbing group/audio transition-colors ${
                  isDark ? 'bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1]' : 'bg-gray-300/60 border border-gray-400/40 hover:bg-gray-300/80'
                }`}
                style={{ left: leftPx, width: widthPx }}
                title={`${at.name} · ${formatTime(at.startTime)} – ${formatTime(at.startTime + at.duration)}`}
                onPointerDown={(e) => handleAudioPointerDown(e, at)}
              >
                <div className="flex items-center h-full px-1.5 gap-1 overflow-hidden">
                  <Music size={9} className={`shrink-0 ${isDark ? 'text-neutral-500' : 'text-gray-500'}`} />
                  <span className={`text-[9px] truncate ${isDark ? 'text-neutral-400' : 'text-gray-600'}`}>{at.name}</span>
                </div>
                {/* Delete & mute indicator */}
                <div className="absolute top-0 right-0 opacity-0 group-hover/audio:opacity-100 transition-opacity z-10">
                  <button
                    className={`p-0.5 rounded-bl ${isDark ? 'bg-black/80 text-neutral-400 hover:text-red-400' : 'bg-white/80 text-gray-500 hover:text-red-500'}`}
                    onClick={(e) => { e.stopPropagation(); onAudioRemove(at.id); }}
                    onPointerDown={e => e.stopPropagation()}
                  >
                    <Trash2 size={9} />
                  </button>
                </div>
                {at.volume === 0 && (
                  <div className="absolute bottom-0 left-0.5 z-10">
                    <VolumeX size={9} className="text-red-400/80" />
                  </div>
                )}
              </div>
              <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: playheadPx }}>
                <div className="w-px h-full bg-gradient-to-b from-pink-500/50 via-purple-500/50 to-blue-500/50" />
              </div>
            </div>
          );
        })}

        {/* Subtitle tracks */}
        {subtitleTracks.map(st => (
          <div key={st.id} className={`relative ${isDark ? 'bg-neutral-950 border-t border-neutral-800/50' : 'bg-gray-200 border-t border-gray-300'}`}
            style={{ width: effectiveWidth + 60, height: 28 }}>
            {/* Cue blocks */}
            {st.cues.map(cue => {
              const leftPx = timeToPx(cue.startTime);
              const widthPx = Math.max(12, (cue.endTime - cue.startTime) * pps);
              const isEditing = editingCueId === cue.id;
              return (
                <div
                  key={cue.id}
                  className={`absolute top-1 bottom-1 rounded cursor-pointer group/cue transition-colors ${
                    isEditing
                      ? isDark ? 'bg-cyan-500/30 border border-cyan-400/60' : 'bg-cyan-200/60 border border-cyan-500'
                      : isDark ? 'bg-cyan-500/10 border border-cyan-400/20 hover:bg-cyan-500/20' : 'bg-cyan-100/60 border border-cyan-300/60 hover:bg-cyan-200/60'
                  }`}
                  style={{ left: leftPx, width: widthPx }}
                  title={`${cue.text} (${formatTime(cue.startTime)} – ${formatTime(cue.endTime)})`}
                  onClick={() => onCueClick(cue.id)}
                >
                  <div className="flex items-center h-full px-1 overflow-hidden">
                    <span className={`text-[8px] truncate ${isDark ? 'text-cyan-300/80' : 'text-cyan-700'}`}>{cue.text}</span>
                  </div>
                </div>
              );
            })}
            {/* Delete track button */}
            <div className="absolute top-0.5 right-0.5 z-20">
              <button
                className={`p-0.5 rounded opacity-0 hover:opacity-100 transition-opacity ${isDark ? 'bg-black/80 text-neutral-400 hover:text-red-400' : 'bg-white/80 text-gray-500 hover:text-red-500'}`}
                onClick={() => onSubtitleTrackRemove(st.id)}
              >
                <Trash2 size={8} />
              </button>
            </div>
            {/* Playhead */}
            <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: playheadPx }}>
              <div className="w-px h-full bg-gradient-to-b from-pink-500/50 via-purple-500/50 to-blue-500/50" />
            </div>
          </div>
        ))}

        
      </div>
    </div>
  );
};

// ============================================================================
// Main Modal
// ============================================================================

export const VideoMergeModal: React.FC<VideoMergeModalProps> = ({
  isOpen, onClose, initialVideos = [], allVideos = [], onMerged, initialSubtitleTracks, initialAudioTracks
}) => {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [videos, setVideos] = useState<EnrichedVideo[]>([]);
  const [transition, setTransition] = useState<TransitionType>('fade');
  const [duration, setDuration] = useState(0.5);
  const [status, setStatus] = useState<'idle' | 'merging' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showTransitionDropdown, setShowTransitionDropdown] = useState(false);
  const [showResolutionDropdown, setShowResolutionDropdown] = useState(false);
  const [outputResolution, setOutputResolution] = useState(RESOLUTION_PRESETS[0]);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [pps, setPps] = useState(DEFAULT_PPS);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [showVideoSelector, setShowVideoSelector] = useState(false);
  const [showVolumeMixer, setShowVolumeMixer] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const resDropdownRef = useRef<HTMLDivElement>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const mixerRef = useRef<HTMLDivElement>(null);
  const dragIdx = useRef<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const isRulerSeekingRef = useRef(false);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  /** Timeline trim UI: only shown after clicking scissors on a clip. */
  const [trimModeIdx, setTrimModeIdx] = useState<number | null>(null);

  // Subtitle state
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [showSubtitleStyle, setShowSubtitleStyle] = useState(false);
  const subtitleStyleRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showTransitionDropdown && !showVideoSelector && !showVolumeMixer && !showSubtitleStyle && !showResolutionDropdown) return;
    const handler = (e: MouseEvent) => {
      if (showTransitionDropdown && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowTransitionDropdown(false);
      }
      if (showResolutionDropdown && resDropdownRef.current && !resDropdownRef.current.contains(e.target as Node)) {
        setShowResolutionDropdown(false);
      }
      if (showVideoSelector && selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setShowVideoSelector(false);
      }
      if (showVolumeMixer && mixerRef.current && !mixerRef.current.contains(e.target as Node)) {
        setShowVolumeMixer(false);
      }
      if (showSubtitleStyle && subtitleStyleRef.current && !subtitleStyleRef.current.contains(e.target as Node)) {
        setShowSubtitleStyle(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTransitionDropdown, showResolutionDropdown, showVideoSelector, showVolumeMixer, showSubtitleStyle]);

  useEffect(() => {
    if (!isOpen) return;
    setStatus('idle');
    setErrorMsg('');
    setPreviewIdx(null);
    setPps(DEFAULT_PPS);
    setPlayheadTime(0);
    setShowVideoSelector(false);
    setAudioTracks([]);
    setSubtitleTracks(initialSubtitleTracks || []);
    setEditingCueId(null);
    setShowSubtitleStyle(false);
    setTrimModeIdx(null);

    setVideos(initialVideos.map(v => ({
      ...v,
      duration: 0,
      sourceDuration: 0,
      trimIn: 0,
      trimOut: 0,
      frames: [],
      loading: true,
      volume: 1,
      speed: 1,
    })));

    initialVideos.forEach((v, idx) => {
      const fullUrl = assetUrl(v.url);
      extractFrames(fullUrl).then(({ duration: dur, frames }) => {
        setVideos(prev => prev.map((item, i) =>
          i === idx ? {
            ...item,
            duration: dur,
            sourceDuration: dur,
            trimIn: 0,
            trimOut: dur,
            frames,
            loading: false,
          } : item
        ));
      });
    });

    if (initialAudioTracks?.length) {
      initialAudioTracks.forEach(at => addAudioFromUrl(at.url, at.name));
    }
  }, [isOpen, initialVideos, initialSubtitleTracks, initialAudioTracks]);

  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx); };
  const handleDrop = (idx: number) => {
    const from = dragIdx.current;
    if (from === null || from === idx) { dragIdx.current = null; setDragOverIdx(null); return; }
    setTrimModeIdx(null);
    setVideos(prev => { const arr = [...prev]; const [item] = arr.splice(from, 1); arr.splice(idx, 0, item); return arr; });
    dragIdx.current = null; setDragOverIdx(null);
  };
  const handleDragEnd = () => { dragIdx.current = null; setDragOverIdx(null); };

  const moveVideo = (from: number, to: number) => {
    if (to < 0 || to >= videos.length) return;
    setTrimModeIdx(null);
    setVideos(prev => { const arr = [...prev]; const [item] = arr.splice(from, 1); arr.splice(to, 0, item); return arr; });
    if (previewIdx === from) setPreviewIdx(to);
  };

  const removeVideo = (idx: number) => {
    setVideos(prev => prev.filter((_, i) => i !== idx));
    if (previewIdx === idx) setPreviewIdx(null);
    else if (previewIdx !== null && previewIdx > idx) setPreviewIdx(previewIdx - 1);
    setTrimModeIdx(tm => {
      if (tm === null) return null;
      if (tm === idx) return null;
      if (tm > idx) return tm - 1;
      return tm;
    });
  };

  const totalDuration = videos.reduce((s, v) => s + v.duration, 0)
    - Math.max(0, videos.length - 1) * (transition !== 'none' ? duration : 0);

  const addAudioFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
      const track: AudioTrack = {
        id: `audio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        file,
        url,
        duration: audio.duration,
        startTime: playheadTime,
        volume: 0.7,
      };
      setAudioTracks(prev => [...prev, track]);
    };
  }, [playheadTime]);

  const addAudioFromUrl = useCallback((audioUrl: string, name: string) => {
    const audio = new Audio(audioUrl);
    audio.onloadedmetadata = () => {
      const track: AudioTrack = {
        id: `audio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        url: audioUrl,
        duration: audio.duration,
        startTime: 0,
        volume: 0.7,
      };
      setAudioTracks(prev => [...prev, track]);
    };
    audio.onerror = () => {
      console.warn('[VideoMerge] Failed to load audio from URL:', audioUrl);
    };
  }, []);

  const removeAudioTrack = useCallback((id: string) => {
    setAudioTracks(prev => {
      const t = prev.find(a => a.id === id);
      if (t?.url.startsWith('blob:')) URL.revokeObjectURL(t.url);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const updateAudioTrack = useCallback((id: string, patch: Partial<AudioTrack>) => {
    setAudioTracks(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  }, []);

  const updateVideoVolume = useCallback((idx: number, volume: number) => {
    setVideos(prev => prev.map((v, i) => i === idx ? { ...v, volume } : v));
  }, []);

  const updateVideoSpeed = useCallback((idx: number, speed: number) => {
    setVideos(prev => prev.map((v, i) => i === idx ? { ...v, speed } : v));
  }, []);

  const updateClipTrim = useCallback((idx: number, nextIn?: number, nextOut?: number) => {
    setVideos(prev => prev.map((v, i) => {
      if (i !== idx) return v;
      const src = v.sourceDuration > 0 ? v.sourceDuration : v.duration;
      if (src <= 0) return v;
      let tin = nextIn !== undefined ? nextIn : v.trimIn;
      let tout = nextOut !== undefined ? nextOut : v.trimOut;
      tin = Math.max(0, Math.min(tin, src - MIN_TRIM_SEC));
      tout = Math.min(Math.max(tin + MIN_TRIM_SEC, tout), src);
      const dur = tout - tin;
      return { ...v, trimIn: tin, trimOut: tout, duration: dur };
    }));
  }, []);

  const resetClipTrim = useCallback((idx: number) => {
    setVideos(prev => prev.map((v, i) => {
      if (i !== idx) return v;
      const src = v.sourceDuration;
      if (src <= 0) return v;
      return { ...v, trimIn: 0, trimOut: src, duration: src };
    }));
  }, []);

  const handleTimelineSelect = useCallback((idx: number) => {
    setPreviewIdx(idx);
    setTrimModeIdx(null);
  }, []);

  const handleToggleTrimMode = useCallback((idx: number) => {
    setTrimModeIdx(prev => (prev === idx ? null : idx));
    setPreviewIdx(idx);
  }, []);

  // Subtitle management
  const removeSubtitleTrack = useCallback((trackId: string) => {
    setSubtitleTracks(prev => prev.filter(st => st.id !== trackId));
    setEditingCueId(null);
  }, []);

  const updateSubtitleCue = useCallback((cueId: string, patch: Partial<SubtitleCue>) => {
    setSubtitleTracks(prev => prev.map(st => ({
      ...st,
      cues: st.cues.map(c => c.id === cueId ? { ...c, ...patch } : c),
    })));
  }, []);

  const deleteSubtitleCue = useCallback((cueId: string) => {
    setSubtitleTracks(prev => prev.map(st => ({
      ...st,
      cues: st.cues.filter(c => c.id !== cueId),
    })));
    setEditingCueId(null);
  }, []);

  const updateSubtitleStyle = useCallback((trackId: string, patch: Partial<SubtitleStyle>) => {
    setSubtitleTracks(prev => prev.map(st =>
      st.id === trackId ? { ...st, style: { ...st.style, ...patch } } : st
    ));
  }, []);

  // SRT parsing
  const parseSRT = useCallback((text: string): SubtitleCue[] => {
    const blocks = text.trim().replace(/\r\n/g, '\n').split(/\n\n+/);
    const cues: SubtitleCue[] = [];
    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.length < 2) continue;
      const timeMatch = lines.find(l => l.includes('-->'));
      if (!timeMatch) continue;
      const [startStr, endStr] = timeMatch.split('-->').map(s => s.trim());
      const parseSRTTime = (s: string): number => {
        const [hms, msStr] = s.split(',');
        const parts = hms.split(':').map(Number);
        return parts[0] * 3600 + parts[1] * 60 + parts[2] + (parseInt(msStr || '0') / 1000);
      };
      const textIdx = lines.indexOf(timeMatch);
      const cueText = lines.slice(textIdx + 1).join('\n').trim();
      if (!cueText) continue;
      cues.push({
        id: `cue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        startTime: parseSRTTime(startStr),
        endTime: parseSRTTime(endStr),
        text: cueText,
      });
    }
    return cues;
  }, []);

  const handleImportSRT = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const cues = parseSRT(text);
      if (cues.length === 0) return;
      const track: SubtitleTrack = {
        id: `sub_${Date.now()}`,
        name: file.name.replace(/\.srt$/i, ''),
        cues,
        style: { ...DEFAULT_SUBTITLE_STYLE },
      };
      setSubtitleTracks(prev => [...prev, track]);
    };
    reader.readAsText(file);
  }, [parseSRT]);

  // SRT export
  const exportSRT = useCallback(() => {
    const allCues = subtitleTracks.flatMap(st => st.cues);
    if (allCues.length === 0) return;
    const sorted = [...allCues].sort((a, b) => a.startTime - b.startTime);
    const fmtTime = (sec: number): string => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.round((sec % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    const srt = sorted.map((cue, i) =>
      `${i + 1}\n${fmtTime(cue.startTime)} --> ${fmtTime(cue.endTime)}\n${cue.text}`
    ).join('\n\n');
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subtitles.srt';
    a.click();
    URL.revokeObjectURL(url);
  }, [subtitleTracks]);

  const handleMerge = useCallback(async () => {
    if (videos.length < 2) return;
    setStatus('merging'); setErrorMsg('');
    try {
      const formData = new FormData();
      formData.append(
        'videos',
        JSON.stringify(
          videos.map(v => {
            const trimIn = Math.max(0, Number(v.trimIn ?? 0));
            const fallbackEnd = Number(v.sourceDuration || v.duration || 0);
            const trimOut = Math.max(
              trimIn + MIN_TRIM_SEC,
              Number(v.trimOut != null && Number.isFinite(Number(v.trimOut)) ? Number(v.trimOut) : fallbackEnd)
            );
            return {
              url: v.url,
              volume: v.volume ?? 1,
              trimIn,
              trimOut,
              speed: v.speed ?? 1,
            };
          })
        )
      );
      formData.append('transition', transition);
      formData.append('transitionDuration', String(duration));
      formData.append('outputWidth', String(outputResolution.w));
      formData.append('outputHeight', String(outputResolution.h));

      const tracksMeta = audioTracks.map((at, i) => ({
        index: i,
        startTime: at.startTime,
        volume: at.volume,
      }));
      formData.append('audioTracks', JSON.stringify(tracksMeta));

      for (let i = 0; i < audioTracks.length; i++) {
        const at = audioTracks[i];
        if (at.file) {
          formData.append(`audio_${i}`, at.file);
        } else if (at.url) {
          try {
            const resp = await fetch(at.url);
            const blob = await resp.blob();
            formData.append(`audio_${i}`, new File([blob], at.name || `audio_${i}.mp3`));
          } catch {
            console.warn(`[VideoMerge] Failed to fetch audio track ${i} from URL, skipping`);
          }
        }
      }

      if (subtitleTracks.length > 0) {
        formData.append('subtitleTracks', JSON.stringify(subtitleTracks));
      }

      const res = await authFetch(`${API_URL}/merge-videos`, {
        method: 'POST',
        headers: {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Merge failed');
      onMerged?.(data.url, videos.map(v => v.id));
      onClose();
    } catch (err: any) { setErrorMsg(err.message); setStatus('error'); }
  }, [videos, transition, duration, audioTracks, subtitleTracks, onMerged, onClose]);

  // Zoom with Ctrl+Wheel on the timeline
  const handleTimelineWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPps(prev => Math.max(MIN_PPS, Math.min(MAX_PPS, prev - e.deltaY * 0.3)));
    }
  }, []);

  // Audio preview: compute clip start times for absolute time tracking
  const clipStartTimes = useMemo(() => {
    const times: number[] = [];
    let acc = 0;
    for (const v of videos) { times.push(acc); acc += v.duration; }
    return times;
  }, [videos]);

  const pauseAllAudio = useCallback(() => {
    audioRefs.current.forEach(el => { if (!el.paused) el.pause(); });
  }, []);

  const syncAudioPlayback = useCallback((absoluteTime: number, playing: boolean) => {
    audioTracks.forEach(at => {
      const el = audioRefs.current.get(at.id);
      if (!el) return;
      if (playing && absoluteTime >= at.startTime && absoluteTime < at.startTime + at.duration) {
        const offset = absoluteTime - at.startTime;
        if (Math.abs(el.currentTime - offset) > 0.3) el.currentTime = offset;
        el.volume = at.volume;
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }
    });
  }, [audioTracks]);

  const handlePlayheadSeek = useCallback((time: number) => {
    isRulerSeekingRef.current = true;
    setPlayheadTime(time);

    let targetIdx: number | null = null;
    let localOffset = 0;
    for (let i = 0; i < videos.length; i++) {
      if (time >= clipStartTimes[i] && time < clipStartTimes[i] + videos[i].duration) {
        targetIdx = i;
        localOffset = time - clipStartTimes[i];
        break;
      }
    }
    if (targetIdx === null && videos.length > 0) {
      targetIdx = videos.length - 1;
      localOffset = videos[targetIdx].duration;
    }
    if (targetIdx === null) return;

    if (targetIdx === previewIdx) {
      const v = previewVideoRef.current;
      const clip = videos[targetIdx];
      if (v && clip) {
        v.currentTime = clip.trimIn + localOffset;
        syncAudioPlayback(time, !v.paused);
      }
    } else {
      pendingSeekRef.current = localOffset;
      setPreviewIdx(targetIdx);
    }
    requestAnimationFrame(() => { isRulerSeekingRef.current = false; });
  }, [videos, clipStartTimes, previewIdx, syncAudioPlayback]);

  // Pause audio when switching preview clips
  useEffect(() => { pauseAllAudio(); }, [previewIdx, pauseAllAudio]);

  // Keep preview element inside trim window when trim values change
  useEffect(() => {
    if (previewIdx === null) return;
    const clip = videos[previewIdx];
    const vid = previewVideoRef.current;
    if (!clip || clip.loading || !vid || clip.sourceDuration <= 0) return;
    if (vid.currentTime < clip.trimIn) vid.currentTime = clip.trimIn;
    else if (vid.currentTime > clip.trimOut - 0.02) vid.currentTime = Math.max(clip.trimIn, clip.trimOut - 0.05);
  }, [videos, previewIdx]);

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 ${isDark ? 'bg-black/80' : 'bg-black/40'} backdrop-blur-sm flex items-center justify-center z-[100]`}>
      <div className={`${isDark ? 'bg-[var(--sf-bg-panel)] border-[var(--sf-border)]' : 'bg-white border-gray-200'} border rounded-2xl shadow-2xl flex flex-col overflow-hidden m-4`} style={{ width: 'calc(100vw - 32px)', height: 'calc(100vh - 32px)' }}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-3 border-b ${isDark ? 'border-neutral-800 bg-[#1a1a1a]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isDark ? 'sf-rainbow-btn !p-0 text-white' : 'lt-btn !p-0 !shadow-sm'
              }`}
            >
              <Film size={16} />
            </div>
            <h2 className={`text-base font-semibold leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('videoMerge.title')}
            </h2>
            <div className="relative" ref={selectorRef}>
              <button
                onClick={() => setShowVideoSelector(!showVideoSelector)}
                className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                  showVideoSelector
                    ? (isDark ? 'text-white bg-neutral-700' : 'text-gray-900 bg-gray-300')
                    : (isDark ? 'text-neutral-400 bg-neutral-800 hover:bg-neutral-700 hover:text-neutral-200' : 'text-gray-500 bg-gray-200 hover:bg-gray-300')
                }`}
              >
                <Clock size={10} />
                <span>{videos.length} {t('videoMerge.clips')}</span>
                <span className={isDark ? 'text-neutral-600' : 'text-gray-400'}>·</span>
                <span>{formatTime(totalDuration > 0 ? totalDuration : 0)}</span>
                <ChevronDown size={10} className={`transition-transform ${showVideoSelector ? 'rotate-180' : ''}`} />
              </button>

              {showVideoSelector && allVideos.length > 0 && (
                <div className={`absolute top-full mt-1 left-0 w-64 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${
                  isDark ? 'bg-neutral-900 border border-neutral-700' : 'bg-white border border-gray-200'
                }`}>
                  <div className={`flex items-center justify-between px-3 py-2 border-b ${isDark ? 'border-neutral-800' : 'border-gray-100'}`}>
                    <span className={`text-[10px] font-medium ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                      {t('videoMerge.selectVideos')}
                    </span>
                    <button
                      className="text-[10px] font-medium sf-rainbow-text"
                      onClick={() => {
                        const allSelected = allVideos.every(av => videos.some(v => v.id === av.id));
                        if (allSelected) {
                          setVideos([]);
                          setPreviewIdx(null);
                        } else {
                          const toAdd = allVideos.filter(av => !videos.some(v => v.id === av.id));
                          const newItems: EnrichedVideo[] = toAdd.map(av => ({
                            ...av,
                            duration: 0,
                            sourceDuration: 0,
                            trimIn: 0,
                            trimOut: 0,
                            frames: [],
                            loading: true,
                            volume: 1,
                            speed: 1,
                          }));
                          setVideos(prev => [...prev, ...newItems]);
                          toAdd.forEach(av => {
                            extractFrames(assetUrl(av.url)).then(({ duration: dur, frames }) => {
                              setVideos(prev => prev.map(v =>
                                v.id === av.id ? {
                                  ...v,
                                  duration: dur,
                                  sourceDuration: dur,
                                  trimIn: 0,
                                  trimOut: dur,
                                  frames,
                                  loading: false,
                                } : v
                              ));
                            });
                          });
                        }
                      }}
                    >
                      {allVideos.every(av => videos.some(v => v.id === av.id)) ? t('common.deselectAll') : t('common.selectAll')}
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1" style={{ scrollbarWidth: 'thin', scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #ffffff' }}>
                    {allVideos.map(av => {
                      const isSelected = videos.some(v => v.id === av.id);
                      const thumb = isOssUrl(av.url) ? ossVideoSnapshot(assetUrl(av.url), 1000, 80) : undefined;
                      return (
                        <button
                          key={av.id}
                          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors ${
                            isSelected
                              ? (isDark ? 'bg-neutral-800' : 'bg-gray-50')
                              : (isDark ? 'hover:bg-neutral-800' : 'hover:bg-gray-50')
                          }`}
                          onClick={() => {
                            if (isSelected) {
                              const idx = videos.findIndex(v => v.id === av.id);
                              if (idx >= 0) removeVideo(idx);
                            } else {
                              const newItem: EnrichedVideo = {
                                ...av,
                                duration: 0,
                                sourceDuration: 0,
                                trimIn: 0,
                                trimOut: 0,
                                frames: [],
                                loading: true,
                                volume: 1,
                                speed: 1,
                              };
                              setVideos(prev => [...prev, newItem]);
                              const fullUrl = assetUrl(av.url);
                              extractFrames(fullUrl).then(({ duration: dur, frames }) => {
                                setVideos(prev => prev.map(v =>
                                  v.id === av.id ? {
                                    ...v,
                                    duration: dur,
                                    sourceDuration: dur,
                                    trimIn: 0,
                                    trimOut: dur,
                                    frames,
                                    loading: false,
                                  } : v
                                ));
                              });
                            }
                          }}
                        >
                          <div className={`w-10 h-6 rounded overflow-hidden shrink-0 ${isDark ? 'bg-neutral-800' : 'bg-gray-100'}`}>
                            {thumb ? (
                              <img src={thumb} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Film size={9} className={isDark ? 'text-neutral-600' : 'text-gray-400'} />
                              </div>
                            )}
                          </div>
                          <span className={`text-[11px] truncate flex-1 ${
                            isSelected ? (isDark ? 'text-neutral-200' : 'text-gray-900') : (isDark ? 'text-neutral-400' : 'text-gray-600')
                          }`}>
                            {av.name}
                          </span>
                          <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 border-0'
                              : (isDark ? 'border border-neutral-600' : 'border border-gray-300')
                          }`}>
                            {isSelected && (
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Volume mixer */}
            <div className="relative" ref={mixerRef}>
              <button
                onClick={() => setShowVolumeMixer(!showVolumeMixer)}
                className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                  showVolumeMixer
                    ? (isDark ? 'text-white bg-neutral-700' : 'text-gray-900 bg-gray-300')
                    : (isDark ? 'text-neutral-400 bg-neutral-800 hover:bg-neutral-700 hover:text-neutral-200' : 'text-gray-500 bg-gray-200 hover:bg-gray-300')
                }`}
              >
                <Volume2 size={10} />
                <span>{t('videoMerge.mixer')}</span>
              </button>
              {showVolumeMixer && (
                <div className={`absolute top-full mt-1 left-0 min-w-[240px] max-h-[320px] overflow-y-auto rounded-xl shadow-2xl border z-50 ${
                  isDark ? 'bg-[#1a1a1a] border-neutral-700' : 'bg-white border-gray-200'
                }`}>
                  {/* Video tracks */}
                  {videos.length > 0 && (
                    <div className="p-2.5">
                      <div className={`flex items-center justify-between mb-1.5`}>
                        <div className={`text-[10px] font-medium ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                          <Film size={10} className="inline mr-1" />{t('videoMerge.videoTracksLabel')}
                        </div>
                        <button
                          onClick={() => {
                            const allMuted = videos.every(v => v.volume === 0);
                            videos.forEach((_, idx) => updateVideoVolume(idx, allMuted ? 1 : 0));
                          }}
                          className={`text-[9px] transition-colors ${isDark ? 'text-neutral-600 hover:text-neutral-300' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                          {videos.every(v => v.volume === 0) ? t('videoMerge.unmuteAll') : t('videoMerge.muteAll')}
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {videos.map((video, idx) => (
                          <div key={video.id} className="flex items-center gap-2">
                            <button
                              onClick={() => updateVideoVolume(idx, video.volume > 0 ? 0 : 1)}
                              className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors ${
                                isDark ? 'hover:bg-neutral-700' : 'hover:bg-gray-100'
                              }`}
                            >
                              {video.volume > 0
                                ? <Volume2 size={12} className={isDark ? 'text-neutral-300' : 'text-gray-600'} />
                                : <VolumeX size={12} className="text-red-400" />
                              }
                            </button>
                            <span className={`text-[10px] truncate w-14 shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                              {idx + 1}. {video.name?.slice(0, 6) || `V${idx + 1}`}
                            </span>
                            <input type="range" min="0" max="150" step="5" value={Math.round(video.volume * 100)}
                              onChange={e => updateVideoVolume(idx, parseInt(e.target.value) / 100)}
                              className={`flex-1 h-4 min-w-0 cursor-pointer ${isDark ? 'accent-white' : 'accent-gray-800'}`}
                              style={{ WebkitAppearance: 'auto' }}
                            />
                            <span className={`text-[10px] font-mono w-8 text-right tabular-nums shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                              {Math.round(video.volume * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Speed controls */}
                  {videos.length > 0 && (
                    <div className={`p-2.5 border-t ${isDark ? 'border-neutral-700' : 'border-gray-200'}`}>
                      <div className={`flex items-center justify-between mb-1.5`}>
                        <div className={`text-[10px] font-medium ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                          <Clock size={10} className="inline mr-1" />{t('videoMerge.speedLabel')}
                        </div>
                        <button
                          onClick={() => videos.forEach((_, idx) => updateVideoSpeed(idx, 1))}
                          className={`text-[9px] transition-colors ${isDark ? 'text-neutral-600 hover:text-neutral-300' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                          {t('videoMerge.resetAll')}
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {videos.map((video, idx) => (
                          <div key={video.id} className="flex items-center gap-2">
                            <Clock size={12} className={`shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`} />
                            <span className={`text-[10px] truncate w-14 shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                              {idx + 1}. {video.name?.slice(0, 6) || `V${idx + 1}`}
                            </span>
                            <input type="range" min="25" max="400" step="25" value={Math.round((video.speed ?? 1) * 100)}
                              onChange={e => updateVideoSpeed(idx, parseInt(e.target.value) / 100)}
                              className={`flex-1 h-4 min-w-0 cursor-pointer ${isDark ? 'accent-white' : 'accent-gray-800'}`}
                              style={{ WebkitAppearance: 'auto' }}
                            />
                            <span className={`text-[10px] font-mono w-10 text-right tabular-nums shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                              {(video.speed ?? 1).toFixed(2)}x
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Audio tracks */}
                  {audioTracks.length > 0 && (
                    <div className={`p-2.5 ${videos.length > 0 ? `border-t ${isDark ? 'border-neutral-700' : 'border-gray-200'}` : ''}`}>
                      <div className={`flex items-center justify-between mb-1.5`}>
                        <div className={`text-[10px] font-medium ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                          <Music size={10} className="inline mr-1" />{t('videoMerge.audioTracksLabel')}
                        </div>
                        <button
                          onClick={() => {
                            const allMuted = audioTracks.every(a => a.volume === 0);
                            audioTracks.forEach(a => updateAudioTrack(a.id, { volume: allMuted ? 0.7 : 0 }));
                          }}
                          className={`text-[9px] transition-colors ${isDark ? 'text-neutral-600 hover:text-neutral-300' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                          {audioTracks.every(a => a.volume === 0) ? t('videoMerge.unmuteAll') : t('videoMerge.muteAll')}
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {audioTracks.map(at => (
                          <div key={at.id} className="flex items-center gap-2">
                            <button
                              onClick={() => updateAudioTrack(at.id, { volume: at.volume > 0 ? 0 : 1 })}
                              className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors ${
                                isDark ? 'hover:bg-neutral-700' : 'hover:bg-gray-100'
                              }`}
                            >
                              {at.volume > 0
                                ? <Volume2 size={12} className={isDark ? 'text-neutral-300' : 'text-gray-600'} />
                                : <VolumeX size={12} className="text-red-400" />
                              }
                            </button>
                            <span className={`text-[10px] truncate w-14 shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                              {at.name?.slice(0, 6) || 'Audio'}
                            </span>
                            <input type="range" min="0" max="100" step="5" value={Math.round(at.volume * 100)}
                              onChange={e => updateAudioTrack(at.id, { volume: parseInt(e.target.value) / 100 })}
                              className={`flex-1 h-4 min-w-0 cursor-pointer ${isDark ? 'accent-pink-500' : 'accent-pink-500'}`}
                              style={{ WebkitAppearance: 'auto' }}
                            />
                            <span className={`text-[10px] font-mono w-8 text-right tabular-nums shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                              {Math.round(at.volume * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {videos.length === 0 && audioTracks.length === 0 && (
                    <div className={`p-4 text-center text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                      {t('videoMerge.noTracks')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Add audio button */}
            <button
              onClick={() => audioInputRef.current?.click()}
              className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                isDark ? 'text-neutral-400 bg-neutral-800 hover:bg-neutral-700 hover:text-neutral-200' : 'text-gray-500 bg-gray-200 hover:bg-gray-300'
              }`}
            >
              <Plus size={10} />
              <span>{t('videoMerge.addAudio')}</span>
            </button>

            {/* Import SRT button */}
            <button
              onClick={() => srtInputRef.current?.click()}
              className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                isDark ? 'text-cyan-400/70 bg-neutral-800 hover:bg-neutral-700 hover:text-cyan-300' : 'text-cyan-600 bg-gray-200 hover:bg-gray-300'
              }`}
            >
              <Type size={10} />
              <span>{t('videoMerge.importSRT')}</span>
            </button>

            {/* Export SRT button */}
            {subtitleTracks.length > 0 && (
              <button
                onClick={exportSRT}
                className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                  isDark ? 'text-neutral-400 bg-neutral-800 hover:bg-neutral-700 hover:text-neutral-200' : 'text-gray-500 bg-gray-200 hover:bg-gray-300'
                }`}
              >
                <Download size={10} />
                <span>{t('videoMerge.exportSRT')}</span>
              </button>
            )}

            {/* Subtitle style button */}
            {subtitleTracks.length > 0 && (
              <div className="relative" ref={subtitleStyleRef}>
                <button
                  onClick={() => setShowSubtitleStyle(!showSubtitleStyle)}
                  className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                    showSubtitleStyle
                      ? (isDark ? 'text-white bg-neutral-700' : 'text-gray-900 bg-gray-300')
                      : (isDark ? 'text-neutral-400 bg-neutral-800 hover:bg-neutral-700 hover:text-neutral-200' : 'text-gray-500 bg-gray-200 hover:bg-gray-300')
                  }`}
                >
                  <Settings2 size={10} />
                  <span>{t('videoMerge.subtitleStyle')}</span>
                </button>
                {showSubtitleStyle && subtitleTracks.length > 0 && (
                  <div className={`absolute top-full mt-1 left-0 min-w-[240px] rounded-xl shadow-2xl border z-50 p-3 ${
                    isDark ? 'bg-[#1a1a1a] border-neutral-700' : 'bg-white border-gray-200'
                  }`}>
                    {subtitleTracks.map(st => (
                      <div key={st.id} className="flex flex-col gap-2">
                        <div className={`text-[10px] font-medium ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                          {st.name}
                        </div>
                        {/* Font size */}
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] w-12 shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('videoMerge.fontSize')}</span>
                          <input type="range" min="20" max="80" step="2" value={st.style.fontSize}
                            onChange={e => updateSubtitleStyle(st.id, { fontSize: Number(e.target.value) })}
                            className={`flex-1 h-4 min-w-0 cursor-pointer ${isDark ? 'accent-cyan-500' : 'accent-cyan-500'}`}
                          />
                          <span className={`text-[10px] font-mono w-6 text-right ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{st.style.fontSize}</span>
                        </div>
                        {/* Font color */}
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] w-12 shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('videoMerge.fontColor')}</span>
                          <input type="color" value={st.style.primaryColor}
                            onChange={e => updateSubtitleStyle(st.id, { primaryColor: e.target.value })}
                            className="w-6 h-5 rounded border-0 cursor-pointer"
                          />
                          <span className={`text-[10px] font-mono ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{st.style.primaryColor}</span>
                        </div>
                        {/* Outline color */}
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] w-12 shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('videoMerge.outlineColor')}</span>
                          <input type="color" value={st.style.outlineColor}
                            onChange={e => updateSubtitleStyle(st.id, { outlineColor: e.target.value })}
                            className="w-6 h-5 rounded border-0 cursor-pointer"
                          />
                          <span className={`text-[10px] font-mono ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{st.style.outlineColor}</span>
                        </div>
                        {/* Outline width */}
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] w-12 shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('videoMerge.outlineWidth')}</span>
                          <input type="range" min="0" max="6" step="0.5" value={st.style.outlineWidth}
                            onChange={e => updateSubtitleStyle(st.id, { outlineWidth: Number(e.target.value) })}
                            className={`flex-1 h-4 min-w-0 cursor-pointer ${isDark ? 'accent-cyan-500' : 'accent-cyan-500'}`}
                          />
                          <span className={`text-[10px] font-mono w-4 text-right ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{st.style.outlineWidth}</span>
                        </div>
                        {/* Bold toggle */}
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={st.style.bold}
                            onChange={e => updateSubtitleStyle(st.id, { bold: e.target.checked })}
                            className="rounded accent-cyan-500"
                          />
                          <span className={`text-[10px] ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('videoMerge.bold')}</span>
                        </label>
                        {/* Position */}
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] w-12 shrink-0 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('videoMerge.position')}</span>
                          {(['bottom', 'center', 'top'] as const).map(pos => (
                            <button key={pos}
                              onClick={() => updateSubtitleStyle(st.id, { position: pos })}
                              className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                                st.style.position === pos
                                  ? 'bg-cyan-500/20 text-cyan-400 font-medium'
                                  : isDark ? 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                              }`}
                            >
                              {t(`videoMerge.position${pos.charAt(0).toUpperCase() + pos.slice(1)}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}>
            <X size={16} />
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 min-h-0 flex flex-col">
          {videos.length === 0 ? (
            <div className={`flex-1 flex flex-col items-center justify-center ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
              <Film size={40} className="mb-3 opacity-30" />
              <p className="text-sm">{t('videoMerge.noVideos')}</p>
            </div>
          ) : (
            <>
              {/* Video preview area */}
              <div className={`flex-1 min-h-0 flex items-center justify-center ${isDark ? 'bg-black/50' : 'bg-gray-100'} p-3`}>
                {previewIdx !== null && videos[previewIdx] ? (
                  <div
                    className="relative flex items-center justify-center w-full h-full cursor-pointer group/preview"
                    onClick={() => {
                      const v = previewVideoRef.current;
                      if (!v) return;
                      if (v.paused) {
                        const clip = videos[previewIdx];
                        const atClipEnd = clip && clip.sourceDuration > 0 && v.currentTime >= clip.trimOut - 0.1;
                        const isLastClip = previewIdx >= videos.length - 1;
                        if (atClipEnd && isLastClip) {
                          setPlayheadTime(0);
                          pendingSeekRef.current = 0;
                          if (previewIdx === 0) {
                            v.currentTime = clip.trimIn;
                            v.play().catch(() => {});
                          } else {
                            setPreviewIdx(0);
                          }
                          return;
                        }
                        v.play().catch(() => {});
                      } else {
                        v.pause();
                      }
                    }}
                  >
                    <video
                      ref={previewVideoRef}
                      key={videos[previewIdx].id}
                      src={assetUrl(videos[previewIdx].url)}
                      className="max-w-full max-h-full rounded-lg bg-black"
                      autoPlay
                      onLoadedMetadata={() => {
                        const v = previewVideoRef.current;
                        const clip = videos[previewIdx];
                        if (!v || !clip) return;
                        v.volume = Math.min(1, Math.max(0, clip.volume ?? 1));
                        if (pendingSeekRef.current !== null) {
                          v.currentTime = clip.trimIn + pendingSeekRef.current;
                          pendingSeekRef.current = null;
                        } else if (v.currentTime < clip.trimIn) {
                          v.currentTime = clip.trimIn;
                        }
                      }}
                      onLoadedData={() => {
                        const v = previewVideoRef.current;
                        const clip = videos[previewIdx];
                        if (!v || !clip) return;
                        if (pendingSeekRef.current !== null) {
                          v.currentTime = clip.trimIn + pendingSeekRef.current;
                          pendingSeekRef.current = null;
                        }
                      }}
                      onTimeUpdate={() => {
                        if (isRulerSeekingRef.current) return;
                        const v = previewVideoRef.current;
                        if (!v || previewIdx === null) return;
                        const clip = videos[previewIdx];
                        const targetVol = Math.min(1, Math.max(0, clip.volume ?? 1));
                        if (v.volume !== targetVol) v.volume = targetVol;
                        if (clip.loading || clip.sourceDuration <= 0) {
                          const absTime = clipStartTimes[previewIdx] + v.currentTime;
                          setPlayheadTime(absTime);
                          syncAudioPlayback(absTime, !v.paused);
                          return;
                        }
                        let srcT = v.currentTime;
                        if (clip.sourceDuration > 0) {
                          if (srcT < clip.trimIn - 0.02) {
                            v.currentTime = clip.trimIn;
                            return;
                          }
                          if (srcT >= clip.trimOut - 0.04) {
                            v.pause();
                            pauseAllAudio();
                            setIsPlaying(false);
                            const absEnd = clipStartTimes[previewIdx] + clip.duration;
                            setPlayheadTime(absEnd);
                            if (previewIdx < videos.length - 1) {
                              setPreviewIdx(previewIdx + 1);
                              pendingSeekRef.current = 0;
                            }
                            return;
                          }
                          srcT = Math.min(Math.max(srcT, clip.trimIn), clip.trimOut);
                        }
                        const localOffset = srcT - clip.trimIn;
                        const absTime = clipStartTimes[previewIdx] + localOffset;
                        setPlayheadTime(absTime);
                        syncAudioPlayback(absTime, !v.paused);
                      }}
                      onPlay={() => {
                        setIsPlaying(true);
                        const v = previewVideoRef.current;
                        if (v && previewIdx !== null) {
                          const clip = videos[previewIdx];
                          const local = v.currentTime - clip.trimIn;
                          syncAudioPlayback(clipStartTimes[previewIdx] + local, true);
                        }
                      }}
                      onPause={() => { setIsPlaying(false); pauseAllAudio(); }}
                      onEnded={() => {
                        setIsPlaying(false);
                        pauseAllAudio();
                        const clip = previewIdx !== null ? videos[previewIdx] : null;
                        if (clip && clip.trimOut < clip.sourceDuration - 0.08) return;
                        if (previewIdx !== null && previewIdx < videos.length - 1) {
                          setPreviewIdx(previewIdx + 1);
                          pendingSeekRef.current = 0;
                        }
                      }}
                    />
                    {/* Subtitle overlay */}
                    {subtitleTracks.length > 0 && (() => {
                      const activeCues = subtitleTracks.flatMap(st => {
                        const style = st.style;
                        return st.cues
                          .filter(c => playheadTime >= c.startTime && playheadTime < c.endTime)
                          .map(c => ({ ...c, style }));
                      });
                      if (activeCues.length === 0) return null;
                      return (
                        <div className="absolute inset-0 pointer-events-none flex flex-col" style={{ justifyContent: activeCues[0]?.style.position === 'top' ? 'flex-start' : activeCues[0]?.style.position === 'center' ? 'center' : 'flex-end' }}>
                          <div className="flex flex-col items-center gap-1 px-4 py-3">
                            {activeCues.map(cue => (
                              <span
                                key={cue.id}
                                style={{
                                  fontFamily: cue.style.fontFamily,
                                  fontSize: Math.max(14, Math.min(cue.style.fontSize * 0.4, 36)),
                                  fontWeight: cue.style.bold ? 700 : 400,
                                  color: cue.style.primaryColor,
                                  WebkitTextStroke: `${Math.max(0.5, cue.style.outlineWidth * 0.4)}px ${cue.style.outlineColor}`,
                                  paintOrder: 'stroke fill',
                                  textShadow: `0 0 ${cue.style.outlineWidth * 2}px ${cue.style.outlineColor}, 0 1px 3px rgba(0,0,0,0.5)`,
                                  lineHeight: 1.3,
                                  textAlign: 'center' as const,
                                  maxWidth: '90%',
                                  wordBreak: 'break-word' as const,
                                }}
                              >
                                {cue.text}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {!isPlaying && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm opacity-0 group-hover/preview:opacity-100 transition-opacity">
                          <Play size={20} className="text-white ml-0.5" />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className={`text-xs ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>{t('videoMerge.clickToPreview')}</p>
                )}
              </div>

              {/* Timeline area */}
              <div className={`shrink-0 border-t ${isDark ? 'border-neutral-800 bg-[#0d0d0d]' : 'border-gray-300 bg-gray-50'}`}>
                {/* Zoom controls */}
                <div className={`flex items-center justify-between px-4 py-1.5 border-b ${isDark ? 'border-neutral-800/50' : 'border-gray-200'}`}>
                  <span className={`text-[10px] ${isDark ? 'text-neutral-500' : 'text-gray-500'} font-mono`}>
                    {t('videoMerge.playhead')}: {formatTime(playheadTime)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPps(p => Math.max(MIN_PPS, p - 10))} className={`${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-700'} transition-colors`}>
                      <ZoomOut size={14} />
                    </button>
                    <input
                      type="range" min={MIN_PPS} max={MAX_PPS} value={pps}
                      onChange={e => setPps(Number(e.target.value))}
                      className={`w-24 h-4 cursor-pointer ${isDark ? 'accent-pink-500' : 'accent-pink-500'}`}
                    />
                    <button onClick={() => setPps(p => Math.min(MAX_PPS, p + 10))} className={`${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-700'} transition-colors`}>
                      <ZoomIn size={14} />
                    </button>
                    <span className={`text-[10px] ${isDark ? 'text-neutral-600' : 'text-gray-400'} font-mono w-10 text-right`}>{pps}px/s</span>
                  </div>
                </div>

                {/* Timeline track */}
                <div onWheel={handleTimelineWheel}>
                  <Timeline
                    videos={videos}
                    pps={pps}
                    selectedIdx={previewIdx}
                    dragOverIdx={dragOverIdx}
                    onSelect={handleTimelineSelect}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onMove={moveVideo}
                    onRemove={removeVideo}
                    playheadTime={playheadTime}
                    onPlayheadChange={handlePlayheadSeek}
                    transition={transition}
                    transitionDuration={duration}
                    t={t}
                    isDark={isDark}
                    onVideoVolumeChange={updateVideoVolume}
                    audioTracks={audioTracks}
                    onAudioUpdate={updateAudioTrack}
                    onAudioRemove={removeAudioTrack}
                    subtitleTracks={subtitleTracks}
                    editingCueId={editingCueId}
                    onCueClick={setEditingCueId}
                    onSubtitleTrackRemove={removeSubtitleTrack}
                    trimModeIdx={trimModeIdx}
                    onToggleTrimMode={handleToggleTrimMode}
                    onClipTrim={updateClipTrim}
                    onClipTrimReset={resetClipTrim}
                  />
                </div>

                <input type="file" ref={audioInputRef} accept="audio/*" multiple className="hidden" onChange={(e) => {
                  const files = e.target.files;
                  if (files) {
                    Array.from(files).forEach(f => addAudioFile(f));
                  }
                  e.target.value = '';
                }} />
                <input type="file" ref={srtInputRef} accept=".srt" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportSRT(file);
                  e.target.value = '';
                }} />
                {/* Hidden audio elements for preview playback */}
                {audioTracks.map(at => (
                  <audio
                    key={at.id}
                    ref={el => {
                      if (el) audioRefs.current.set(at.id, el);
                      else audioRefs.current.delete(at.id);
                    }}
                    src={at.url}
                    preload="auto"
                  />
                ))}

                {/* Inline cue editor */}
                {editingCueId && (() => {
                  const cue = subtitleTracks.flatMap(st => st.cues).find(c => c.id === editingCueId);
                  if (!cue) return null;
                  return (
                    <div className={`flex items-center gap-2 px-4 py-1.5 border-t ${isDark ? 'border-neutral-800/50 bg-neutral-900/50' : 'border-gray-200 bg-gray-50'}`}>
                      <Type size={10} className={isDark ? 'text-cyan-400/60' : 'text-cyan-600'} />
                      <input
                        type="text"
                        value={cue.text}
                        onChange={e => updateSubtitleCue(cue.id, { text: e.target.value })}
                        className={`flex-1 text-xs px-2 py-1 rounded border outline-none ${
                          isDark ? 'bg-neutral-800 border-neutral-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                        placeholder={t('videoMerge.cueText')}
                      />
                      <span className={`text-[9px] shrink-0 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('videoMerge.cueStart')}</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={Number(cue.startTime.toFixed(2))}
                        onChange={e => updateSubtitleCue(cue.id, { startTime: Math.max(0, Number(e.target.value)) })}
                        className={`w-16 text-[10px] font-mono px-1.5 py-1 rounded border outline-none ${
                          isDark ? 'bg-neutral-800 border-neutral-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      />
                      <span className={`text-[9px] shrink-0 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('videoMerge.cueEnd')}</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={Number(cue.endTime.toFixed(2))}
                        onChange={e => updateSubtitleCue(cue.id, { endTime: Math.max(0, Number(e.target.value)) })}
                        className={`w-16 text-[10px] font-mono px-1.5 py-1 rounded border outline-none ${
                          isDark ? 'bg-neutral-800 border-neutral-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      />
                      <button
                        onClick={() => deleteSubtitleCue(cue.id)}
                        className={`p-1 rounded transition-colors ${isDark ? 'text-neutral-500 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                      >
                        <Trash2 size={12} />
                      </button>
                      <button
                        onClick={() => setEditingCueId(null)}
                        className={`p-1 rounded transition-colors ${isDark ? 'text-neutral-500 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>

        {/* Bottom controls */}
        <div className={`px-5 py-3 border-t ${isDark ? 'border-neutral-800 bg-[#1a1a1a]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-center gap-4">
            {/* Transition picker */}
            <div className="flex-1 relative" ref={dropdownRef}>
              <label className={`text-[10px] ${isDark ? 'text-neutral-500' : 'text-gray-500'} mb-0.5 block`}>{t('videoMerge.transition')}</label>
              <button
                onClick={() => setShowTransitionDropdown(!showTransitionDropdown)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg ${isDark ? 'bg-neutral-800 border-neutral-700 text-neutral-200 hover:border-neutral-600' : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'} border text-xs transition-colors`}
              >
                {t(`videoMerge.transitions.${transition}`)}
                <ChevronDown size={12} className={`${isDark ? 'text-neutral-500' : 'text-gray-400'} transition-transform ${showTransitionDropdown ? 'rotate-180' : ''}`} />
              </button>
              {showTransitionDropdown && (
                <div className={`absolute bottom-full mb-1 left-0 right-0 ${isDark ? 'bg-[#222] border-neutral-700' : 'bg-white border-gray-200'} border rounded-lg shadow-xl max-h-[200px] overflow-y-auto z-30`}>
                  {TRANSITIONS.map(tr => (
                    <button
                      key={tr}
                      onClick={() => { setTransition(tr); setShowTransitionDropdown(false); }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                        transition === tr ? (isDark ? 'sf-rainbow-text bg-white/10' : 'sf-rainbow-text bg-gray-100') : (isDark ? 'text-neutral-300 hover:bg-neutral-700' : 'text-gray-600 hover:bg-gray-100')
                      }`}
                    >
                      {t(`videoMerge.transitions.${tr}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Resolution picker */}
            <div className="flex-1 relative" ref={resDropdownRef}>
              <label className={`text-[10px] ${isDark ? 'text-neutral-500' : 'text-gray-500'} mb-0.5 block`}>{t('videoMerge.outputResolution')}</label>
              <button
                onClick={() => setShowResolutionDropdown(!showResolutionDropdown)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg ${isDark ? 'bg-neutral-800 border-neutral-700 text-neutral-200 hover:border-neutral-600' : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'} border text-xs transition-colors`}
              >
                {t(`videoMerge.${outputResolution.label}`)}
                <ChevronDown size={12} className={`${isDark ? 'text-neutral-500' : 'text-gray-400'} transition-transform ${showResolutionDropdown ? 'rotate-180' : ''}`} />
              </button>
              {showResolutionDropdown && (
                <div className={`absolute bottom-full mb-1 left-0 right-0 ${isDark ? 'bg-[#222] border-neutral-700' : 'bg-white border-gray-200'} border rounded-lg shadow-xl max-h-[200px] overflow-y-auto z-30`}>
                  {RESOLUTION_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => { setOutputResolution(preset); setShowResolutionDropdown(false); }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                        outputResolution.id === preset.id ? (isDark ? 'sf-rainbow-text bg-white/10' : 'sf-rainbow-text bg-gray-100') : (isDark ? 'text-neutral-300 hover:bg-neutral-700' : 'text-gray-600 hover:bg-gray-100')
                      }`}
                    >
                      {t(`videoMerge.${preset.label}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Duration slider */}
            <div className="flex-1">
              <label className={`text-[10px] ${isDark ? 'text-neutral-500' : 'text-gray-500'} mb-0.5 block`}>
                {t('videoMerge.duration')}: {duration.toFixed(1)}{t('videoMerge.seconds')}
              </label>
              <input
                type="range" min="0.2" max="2" step="0.1" value={duration}
                onChange={e => setDuration(parseFloat(e.target.value))}
                className={`w-full h-4 cursor-pointer ${isDark ? 'accent-pink-500' : 'accent-pink-500'}`}
                disabled={transition === 'none'}
              />
            </div>

            {/* Error inline */}
            {status === 'error' && errorMsg && (
              <span className={`text-[10px] max-w-[160px] truncate ${isDark ? 'text-red-400' : 'text-red-500'}`} title={sanitizeError(errorMsg)}>
                {sanitizeError(errorMsg)}
              </span>
            )}

            {/* Actions */}
            <button
              onClick={handleMerge}
              disabled={videos.length < 2 || status === 'merging'}
              className={`px-4 py-1.5 rounded-full text-xs font-medium text-white transition-colors flex items-center gap-1.5 ${isDark ? 'sf-rainbow-btn disabled:!bg-neutral-700 disabled:!text-neutral-500' : 'lt-btn-primary disabled:bg-gray-300 disabled:text-gray-400'}`}
            >
              {status === 'merging' ? (
                <><Loader2 size={12} className="animate-spin" />{t('videoMerge.merging')}</>
              ) : (
                <><Play size={12} />{t('videoMerge.merge')}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
