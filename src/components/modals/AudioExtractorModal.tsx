import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Link, AudioLines, Download, Loader2, RotateCcw, Scissors, Play, Pause, FileDown, Film } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { authFetch, apiEndpoint } from '../../config/api';
import { HoverBorderGradient } from '../ui/hover-border-gradient';

interface SubtitleSegmentForTimeline {
  text: string;
  words: Array<{ word: string; startTime: number; endTime: number; confidence: number }>;
}

interface AudioExtractorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToTimeline?: (
    audio: { url: string; filename: string },
    subtitles: SubtitleSegmentForTimeline[] | null
  ) => void;
}

function whisperSegmentsToTimelineSegments(
  segments: { start: number; end: number; text: string }[]
): SubtitleSegmentForTimeline[] {
  return segments
    .filter(s => (s.text || '').trim())
    .map(s => {
      const txt = s.text.trim();
      return {
        text: txt,
        words: [{ word: txt, startTime: s.start, endTime: s.end, confidence: 1 }],
      };
    });
}

type Tab = 'upload' | 'url';
type Status = 'idle' | 'extracting' | 'done' | 'error';

interface ExtractResult {
  audioUrl: string;
  filename: string;
  duration: number;
  size: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTimeInput(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

function parseTimeInput(val: string): number | null {
  const match = val.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const m = parseInt(match[1], 10);
  const s = parseInt(match[2], 10);
  const frac = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) / 1000 : 0;
  if (s >= 60) return null;
  return m * 60 + s + frac;
}

function extractPeaks(audioBuffer: AudioBuffer, numBars: number): number[] {
  const channel = audioBuffer.getChannelData(0);
  const step = Math.floor(channel.length / numBars);
  const peaks: number[] = [];
  for (let i = 0; i < numBars; i++) {
    let max = 0;
    const start = i * step;
    const end = Math.min(start + step, channel.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channel[j]);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }
  const globalMax = Math.max(...peaks, 0.01);
  return peaks.map(p => p / globalMax);
}

export const AudioExtractorModal: React.FC<AudioExtractorModalProps> = ({ isOpen, onClose, onAddToTimeline }) => {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [tab, setTab] = useState<Tab>('upload');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimStartInput, setTrimStartInput] = useState('0:00.0');
  const [trimEndInput, setTrimEndInput] = useState('0:00.0');
  const [trimming, setTrimming] = useState(false);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);

  const [peaks, setPeaks] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const animFrameRef = useRef<number>(0);
  /** Trim UI (handles, range inputs, waveform dim) only after user clicks “crop/trim”. */
  const [trimModeOpen, setTrimModeOpen] = useState(false);

  const [exportingSrt, setExportingSrt] = useState(false);
  const [addingToTimeline, setAddingToTimeline] = useState(false);
  /** Whisper / 字幕与时间轴的错误（与抽取错误分开） */
  const [subtitleErr, setSubtitleErr] = useState('');
  /** Reuse Whisper between “导出字幕” and “添加到时间轴”（与 IndexTTSModal 一致）. */
  const whisperCacheRef = useRef<{ url: string; segments: { start: number; end: number; text: string }[] } | null>(null);

  const NUM_BARS = 100;
  const trimDuration = useMemo(() => result ? result.duration : 0, [result]);

  // Decode audio to waveform peaks
  useEffect(() => {
    if (!result) { setPeaks([]); return; }
    let cancelled = false;
    const ac = new AudioContext();
    fetch(result.audioUrl)
      .then(r => r.arrayBuffer())
      .then(buf => ac.decodeAudioData(buf))
      .then(decoded => {
        if (!cancelled) setPeaks(extractPeaks(decoded, NUM_BARS));
      })
      .catch(() => {
        if (!cancelled) setPeaks(new Array(NUM_BARS).fill(0.1));
      })
      .finally(() => ac.close());
    return () => { cancelled = true; };
  }, [result]);

  useEffect(() => {
    if (result) {
      setTrimStart(0);
      setTrimEnd(result.duration);
      setTrimStartInput(formatTimeInput(0));
      setTrimEndInput(formatTimeInput(result.duration));
      setPlaybackTime(0);
      setIsPlaying(false);
      setTrimModeOpen(false);
      setSubtitleErr('');
      whisperCacheRef.current = null;
    }
  }, [result]);

  // Playback tracking
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [result]);

  const playStart = trimModeOpen ? trimStart : 0;
  const playEnd = trimModeOpen ? trimEnd : trimDuration;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying) return;
    const tick = () => {
      setPlaybackTime(audio.currentTime);
      if (audio.currentTime >= playEnd) {
        audio.pause();
        audio.currentTime = playStart;
        setPlaybackTime(playStart);
        setIsPlaying(false);
        return;
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, playEnd, playStart]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      if (audio.currentTime < playStart || audio.currentTime >= playEnd) {
        audio.currentTime = playStart;
      }
      audio.play();
    }
  }, [isPlaying, playStart, playEnd]);

  const updateTrimStart = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(v, trimEnd - 0.1));
    setTrimStart(clamped);
    setTrimStartInput(formatTimeInput(clamped));
  }, [trimEnd]);

  const updateTrimEnd = useCallback((v: number) => {
    const clamped = Math.min(trimDuration, Math.max(v, trimStart + 0.1));
    setTrimEnd(clamped);
    setTrimEndInput(formatTimeInput(clamped));
  }, [trimDuration, trimStart]);

  const handleRangeMouseDown = useCallback((handle: 'start' | 'end', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingHandle(handle);
  }, []);

  useEffect(() => {
    if (!draggingHandle || !waveformRef.current) return;
    const bar = waveformRef.current;
    const onMove = (e: MouseEvent) => {
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = ratio * trimDuration;
      if (draggingHandle === 'start') updateTrimStart(time);
      else updateTrimEnd(time);
    };
    const onUp = () => setDraggingHandle(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingHandle, trimDuration, updateTrimStart, updateTrimEnd]);

  const handleWaveformClick = useCallback((e: React.MouseEvent) => {
    if (!waveformRef.current || !audioRef.current || draggingHandle) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = ratio * trimDuration;
    const clampedTime = trimModeOpen
      ? Math.max(trimStart, Math.min(trimEnd, time))
      : Math.max(0, Math.min(trimDuration, time));
    audioRef.current.currentTime = clampedTime;
    setPlaybackTime(clampedTime);
  }, [trimDuration, trimStart, trimEnd, draggingHandle, trimModeOpen]);

  const handleTrimStartBlur = useCallback(() => {
    const v = parseTimeInput(trimStartInput);
    if (v !== null) updateTrimStart(v);
    else setTrimStartInput(formatTimeInput(trimStart));
  }, [trimStartInput, trimStart, updateTrimStart]);

  const handleTrimEndBlur = useCallback(() => {
    const v = parseTimeInput(trimEndInput);
    if (v !== null) updateTrimEnd(v);
    else setTrimEndInput(formatTimeInput(trimEnd));
  }, [trimEndInput, trimEnd, updateTrimEnd]);

  const isTrimmed = useMemo(() => {
    if (!result) return false;
    return trimStart > 0.05 || trimEnd < result.duration - 0.05;
  }, [trimStart, trimEnd, result]);

  const handleTrim = useCallback(async () => {
    if (!result || !isTrimmed) return;
    setTrimming(true);
    try {
      const resp = await authFetch(apiEndpoint('/api/trim-audio'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: result.audioUrl, start: trimStart, end: trimEnd }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Trim failed');
      setResult(data);
      const a = document.createElement('a');
      a.href = data.audioUrl;
      a.download = data.filename;
      a.click();
    } catch (err: any) {
      setError(err.message || 'Trim failed');
    } finally {
      setTrimming(false);
      setTrimModeOpen(false);
    }
  }, [result, trimStart, trimEnd, isTrimmed]);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError('');
    setUrl('');
    setTrimStart(0);
    setTrimEnd(0);
    setTrimStartInput('0:00.0');
    setTrimEndInput('0:00.0');
    setPeaks([]);
    setIsPlaying(false);
    setPlaybackTime(0);
    setTrimModeOpen(false);
    setSubtitleErr('');
    setExportingSrt(false);
    setAddingToTimeline(false);
    whisperCacheRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const extractFromFile = useCallback(async (file: File) => {
    setStatus('extracting');
    setError('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const resp = await authFetch(apiEndpoint('/api/extract-audio'), {
        method: 'POST',
        body: formData,
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Extraction failed');

      setResult(data);
      setStatus('done');
    } catch (err: any) {
      setError(err.message || t('audioExtractor.extractionFailed'));
      setStatus('error');
    }
  }, [t]);

  const extractFromUrl = useCallback(async () => {
    if (!url.trim()) return;
    setStatus('extracting');
    setError('');
    setResult(null);

    try {
      const resp = await authFetch(apiEndpoint('/api/extract-audio'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Extraction failed');

      setResult(data);
      setStatus('done');
    } catch (err: any) {
      setError(err.message || t('audioExtractor.extractionFailed'));
      setStatus('error');
    }
  }, [url, t]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      extractFromFile(file);
    }
  }, [extractFromFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) extractFromFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [extractFromFile]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.audioUrl;
    a.download = result.filename;
    a.click();
  }, [result]);

  const ensureWhisperSegments = useCallback(async (): Promise<{ start: number; end: number; text: string }[]> => {
    if (!result?.audioUrl) throw new Error('no audio');
    const hit = whisperCacheRef.current;
    if (hit?.url === result.audioUrl && hit.segments.length > 0) return hit.segments;
    const resp = await authFetch(apiEndpoint('/api/whisper/transcribe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUrl: result.audioUrl }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || `transcription failed (${resp.status})`);
    const segments: { start: number; end: number; text: string }[] = Array.isArray(data?.segments) ? data.segments : [];
    if (segments.length === 0) throw new Error('no segments returned');
    whisperCacheRef.current = { url: result.audioUrl, segments };
    return segments;
  }, [result]);

  const segmentsToSrt = useCallback((segments: { start: number; end: number; text: string }[]) => {
    const fmt = (sec: number) => {
      const total = Math.max(0, sec);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = Math.floor(total % 60);
      const ms = Math.round((total % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    return segments
      .filter(seg => (seg.text || '').trim())
      .map((seg, i) => `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text.trim()}`)
      .join('\n\n');
  }, []);

  const handleExportSrt = useCallback(async () => {
    if (!result || exportingSrt || addingToTimeline) return;
    setExportingSrt(true);
    setSubtitleErr('');
    try {
      const segments = await ensureWhisperSegments();
      const srt = segmentsToSrt(segments);
      const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = (result.filename || 'audio').replace(/\.[^.]+$/, '') + '.srt';
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e: unknown) {
      setSubtitleErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExportingSrt(false);
    }
  }, [result, exportingSrt, addingToTimeline, ensureWhisperSegments, segmentsToSrt]);

  const handleAddExtractedAudioToTimeline = useCallback(async () => {
    if (!result || !onAddToTimeline || exportingSrt || addingToTimeline) return;
    setAddingToTimeline(true);
    setSubtitleErr('');
    try {
      const segments = await ensureWhisperSegments();
      const subtitles = whisperSegmentsToTimelineSegments(segments);
      onAddToTimeline({ url: result.audioUrl, filename: result.filename }, subtitles);
      onClose();
    } catch (e: unknown) {
      setSubtitleErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingToTimeline(false);
    }
  }, [result, onAddToTimeline, exportingSrt, addingToTimeline, ensureWhisperSegments, onClose]);

  if (!isOpen) return null;

  const whisperBusy = exportingSrt || addingToTimeline;

  const panelBg = isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-white/60' : 'text-gray-500';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <HoverBorderGradient
        containerClassName="relative rounded-2xl w-[520px] max-h-[90vh]"
        className={`rounded-[14px] ${panelBg}`}
        duration={5}
      >
        <div className={`rounded-[14px] ${panelBg} flex flex-col max-h-[85vh]`}>
          {/* Header */}
          <div className={`flex items-center justify-between px-5 py-4 border-b ${borderColor}`}>
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  isDark ? 'sf-rainbow-btn !p-0 text-white' : 'lt-btn !p-0 !shadow-sm'
                }`}
              >
                <AudioLines size={20} />
              </div>
              <h2 className={`text-lg font-semibold leading-tight ${textPrimary}`}>{t('audioExtractor.title')}</h2>
            </div>
            <button
              onClick={handleClose}
              className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
            >
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          {status === 'idle' && (
            <div className={`flex gap-1 mx-5 mt-4 p-1 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
              {(['upload', 'url'] as Tab[]).map((t2) => (
                <button
                  key={t2}
                  onClick={() => setTab(t2)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                    tab === t2
                      ? isDark
                        ? 'bg-white/10 text-white shadow-sm'
                        : 'bg-white text-gray-900 shadow-sm'
                      : isDark
                        ? 'text-white/40 hover:text-white/60'
                        : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {t2 === 'upload' ? <Upload size={14} /> : <Link size={14} />}
                  {t2 === 'upload' ? t('audioExtractor.uploadVideo') : t('audioExtractor.extractFromUrl')}
                </button>
              ))}
            </div>
          )}

          {/* Content */}
          <div className="p-5 flex-1 overflow-y-auto">
            {status === 'idle' && tab === 'upload' && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-all ${
                  dragOver
                    ? 'border-purple-400 bg-purple-500/10'
                    : isDark
                      ? `${borderColor} hover:border-white/30 hover:bg-white/5`
                      : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <Upload size={32} className={isDark ? 'text-white/30' : 'text-gray-300'} />
                <p className={`text-sm text-center ${textSecondary}`}>{t('audioExtractor.dragOrClick')}</p>
                <p className={`text-xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>{t('audioExtractor.supportedFormats')}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            )}

            {status === 'idle' && tab === 'url' && (
              <div className="flex flex-col gap-4">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && extractFromUrl()}
                  placeholder={t('audioExtractor.urlPlaceholder')}
                  className={`w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors ${
                    isDark
                      ? 'bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-white/30'
                      : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400'
                  }`}
                />
                <button
                  onClick={extractFromUrl}
                  disabled={!url.trim()}
                  className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
                    url.trim()
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-500/20'
                      : isDark
                        ? 'bg-white/5 text-white/30 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {t('audioExtractor.extract')}
                </button>
              </div>
            )}

            {status === 'extracting' && (
              <div className="flex flex-col items-center gap-4 py-10">
                <Loader2 size={36} className="animate-spin text-purple-400" />
                <p className={`text-sm ${textSecondary}`}>{t('audioExtractor.extracting')}</p>
              </div>
            )}

            {status === 'error' && (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="p-3 rounded-full bg-red-500/10">
                  <X size={24} className="text-red-400" />
                </div>
                <p className="text-sm text-red-400 text-center">{error}</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { reset(); setTab('upload'); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600"
                  >
                    <Upload size={14} />
                    {t('audioExtractor.switchToUpload')}
                  </button>
                  <button
                    onClick={reset}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                      isDark ? 'bg-white/5 text-white/70 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <RotateCcw size={14} />
                    {t('audioExtractor.extractAnother')}
                  </button>
                </div>
              </div>
            )}

            {status === 'done' && result && (
              <div className="flex flex-col gap-4">
                <audio ref={audioRef} src={result.audioUrl} preload="auto" className="hidden" />

                {/* Waveform player + trim */}
                <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  {/* px-3 wrapper: padding here so waveformRef Rect matches bar/track math (percent + click mapping) */}
                  <div className="px-3">
                  <div
                    ref={waveformRef}
                    className="relative cursor-pointer select-none w-full"
                    style={{ height: 100 }}
                    onClick={handleWaveformClick}
                  >
                    {/* Waveform bars — same inset as playhead/overlays (no inner px-*; avoids misaligned %).
                        Renders gentle placeholder bars while audio is still decoding so the area
                        is never blank right after extraction completes. */}
                    <div className="absolute inset-0 flex items-center gap-[1px]">
                      {(peaks.length > 0
                        ? peaks
                        // Pseudo-random pattern so placeholder doesn't look like a flat line
                        : Array.from({ length: NUM_BARS }, (_, i) => 0.25 + 0.35 * Math.abs(Math.sin(i * 0.7)))
                      ).map((peak, i) => {
                        const isLoading = peaks.length === 0;
                        const barTime = (i / NUM_BARS) * trimDuration;
                        const inRegion = trimModeOpen ? (barTime >= trimStart && barTime <= trimEnd) : true;
                        const isPast = !isLoading && barTime <= playbackTime;
                        let color: string;
                        if (isLoading) {
                          color = isDark ? 'bg-purple-500/25 motion-safe:animate-pulse' : 'bg-purple-300/40 motion-safe:animate-pulse';
                        } else if (!inRegion) {
                          color = isDark ? 'bg-white/10' : 'bg-gray-200';
                        } else if (isPast && isPlaying) {
                          color = 'bg-purple-400';
                        } else {
                          color = isDark ? 'bg-purple-500/60' : 'bg-purple-400/50';
                        }
                        const h = Math.max(4, peak * 80);
                        return (
                          <div
                            key={i}
                            className={`flex-1 rounded-full transition-colors duration-75 ${color}`}
                            style={{ height: h, minWidth: 2 }}
                          />
                        );
                      })}
                    </div>

                    {/* Dimmed overlay + trim handles — only in trim mode */}
                    {trimModeOpen && trimStart > 0 && (
                      <div
                        className={`absolute top-0 bottom-0 left-0 ${isDark ? 'bg-black/40' : 'bg-white/50'} pointer-events-none`}
                        style={{ width: `${(trimStart / trimDuration) * 100}%` }}
                      />
                    )}
                    {trimModeOpen && trimEnd < trimDuration && (
                      <div
                        className={`absolute top-0 bottom-0 right-0 ${isDark ? 'bg-black/40' : 'bg-white/50'} pointer-events-none`}
                        style={{ width: `${100 - (trimEnd / trimDuration) * 100}%` }}
                      />
                    )}

                    {trimModeOpen && (
                      <>
                        <div
                          className="absolute top-0 bottom-0 z-20 cursor-ew-resize group"
                          style={{ left: `${(trimStart / trimDuration) * 100}%`, width: 12, transform: 'translateX(-6px)' }}
                          onMouseDown={(e) => handleRangeMouseDown('start', e)}
                        >
                          <div className={`absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[3px] rounded-full transition-colors ${
                            draggingHandle === 'start' ? 'bg-purple-400' : isDark ? 'bg-purple-500/80 group-hover:bg-purple-400' : 'bg-purple-500 group-hover:bg-purple-400'
                          }`} />
                          <div className={`absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-3 h-6 rounded-sm transition-colors ${
                            draggingHandle === 'start' ? 'bg-purple-400' : isDark ? 'bg-purple-500/90 group-hover:bg-purple-400' : 'bg-purple-500 group-hover:bg-purple-400'
                          }`}>
                            <div className="absolute inset-x-[4px] top-[8px] h-[1px] bg-white/70 rounded" />
                            <div className="absolute inset-x-[4px] top-[13px] h-[1px] bg-white/70 rounded" />
                          </div>
                        </div>

                        <div
                          className="absolute top-0 bottom-0 z-20 cursor-ew-resize group"
                          style={{ left: `${(trimEnd / trimDuration) * 100}%`, width: 12, transform: 'translateX(-6px)' }}
                          onMouseDown={(e) => handleRangeMouseDown('end', e)}
                        >
                          <div className={`absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[3px] rounded-full transition-colors ${
                            draggingHandle === 'end' ? 'bg-pink-400' : isDark ? 'bg-pink-500/80 group-hover:bg-pink-400' : 'bg-pink-500 group-hover:bg-pink-400'
                          }`} />
                          <div className={`absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-3 h-6 rounded-sm transition-colors ${
                            draggingHandle === 'end' ? 'bg-pink-400' : isDark ? 'bg-pink-500/90 group-hover:bg-pink-400' : 'bg-pink-500 group-hover:bg-pink-400'
                          }`}>
                            <div className="absolute inset-x-[4px] top-[8px] h-[1px] bg-white/70 rounded" />
                            <div className="absolute inset-x-[4px] top-[13px] h-[1px] bg-white/70 rounded" />
                          </div>
                        </div>
                      </>
                    )}

                    {/* Playback cursor — no CSS transition so seeks stay in sync with bar colors */}
                    {trimDuration > 0 && (
                      <div
                        className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(255,255,255,0.5)] pointer-events-none z-30"
                        style={{
                          left: `${(playbackTime / trimDuration) * 100}%`,
                          transition: 'none',
                        }}
                      />
                    )}
                  </div>
                  </div>

                  {/* Controls bar */}
                  <div className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-t ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                    <button
                      onClick={togglePlay}
                      className={`p-1.5 rounded-lg transition-colors shrink-0 ${isDark ? 'hover:bg-white/10 text-white/70 hover:text-white' : 'hover:bg-gray-200 text-gray-600 hover:text-gray-900'}`}
                    >
                      {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                    </button>

                    {trimModeOpen ? (
                      <>
                        <div className="flex items-center gap-1.5 min-w-0 text-xs">
                          <input
                            type="text"
                            value={trimStartInput}
                            onChange={(e) => setTrimStartInput(e.target.value)}
                            onBlur={handleTrimStartBlur}
                            onKeyDown={(e) => e.key === 'Enter' && handleTrimStartBlur()}
                            className={`w-14 px-1.5 py-0.5 rounded text-center text-[11px] font-mono outline-none transition-colors ${
                              isDark
                                ? 'bg-white/5 text-purple-300 border border-white/10 focus:border-purple-500/50'
                                : 'bg-gray-100 text-purple-600 border border-gray-200 focus:border-purple-400'
                            }`}
                          />
                          <span className={`text-[10px] ${textSecondary}`}>–</span>
                          <input
                            type="text"
                            value={trimEndInput}
                            onChange={(e) => setTrimEndInput(e.target.value)}
                            onBlur={handleTrimEndBlur}
                            onKeyDown={(e) => e.key === 'Enter' && handleTrimEndBlur()}
                            className={`w-14 px-1.5 py-0.5 rounded text-center text-[11px] font-mono outline-none transition-colors ${
                              isDark
                                ? 'bg-white/5 text-pink-300 border border-white/10 focus:border-pink-500/50'
                                : 'bg-gray-100 text-pink-600 border border-gray-200 focus:border-pink-400'
                            }`}
                          />
                        </div>
                        <div className={`text-[11px] font-mono shrink-0 ${textSecondary}`}>
                          {formatDuration(trimEnd - trimStart)} / {formatDuration(trimDuration)}
                        </div>
                        <div className={`text-[10px] ${textSecondary}`}>
                          {formatSize(result.size)}
                        </div>
                        <div className="ml-auto flex items-center gap-1 shrink-0 flex-wrap justify-end">
                          <button
                            type="button"
                            onClick={() => void handleExportSrt()}
                            disabled={whisperBusy}
                            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
                              whisperBusy
                                ? isDark ? 'text-white/30 cursor-not-allowed' : 'text-gray-400 cursor-not-allowed'
                                : isDark ? 'text-purple-300/70 hover:text-purple-200 hover:bg-purple-500/10' : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                            }`}
                            title={t('indexTts.exportSrt')}
                          >
                            {exportingSrt ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />}
                            <span>{exportingSrt ? t('indexTts.exportingSrt') : t('indexTts.exportSrt')}</span>
                          </button>
                          {onAddToTimeline && (
                            <button
                              type="button"
                              onClick={() => void handleAddExtractedAudioToTimeline()}
                              disabled={whisperBusy}
                              className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
                                whisperBusy
                                  ? isDark ? 'text-white/30 cursor-not-allowed' : 'text-gray-400 cursor-not-allowed'
                                  : isDark ? 'text-purple-300/70 hover:text-purple-200 hover:bg-purple-500/10' : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                              }`}
                              title={t('tts.addToTimeline')}
                            >
                              {addingToTimeline ? <Loader2 size={11} className="animate-spin" /> : <Film size={11} />}
                              <span>{addingToTimeline ? t('indexTts.exportingSrt') : t('tts.addToTimeline')}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setTrimModeOpen(false)}
                            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
                              isDark ? 'text-white/50 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                            }`}
                          >
                            {t('audioExtractor.exitTrimMode')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={`text-[11px] font-mono ${textSecondary}`}>
                          {formatDuration(playbackTime)} / {formatDuration(trimDuration)}
                        </div>
                        <div className={`text-[10px] ${textSecondary}`}>
                          {formatSize(result.size)}
                        </div>
                        <div className="ml-auto flex items-center gap-1 flex-wrap justify-end">
                          <button
                            type="button"
                            onClick={() => void handleExportSrt()}
                            disabled={whisperBusy}
                            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
                              whisperBusy
                                ? isDark ? 'text-white/30 cursor-not-allowed' : 'text-gray-400 cursor-not-allowed'
                                : isDark ? 'text-purple-300/70 hover:text-purple-200 hover:bg-purple-500/10' : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                            }`}
                            title={t('indexTts.exportSrt')}
                          >
                            {exportingSrt ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />}
                            <span>{exportingSrt ? t('indexTts.exportingSrt') : t('indexTts.exportSrt')}</span>
                          </button>
                          {onAddToTimeline && (
                            <button
                              type="button"
                              onClick={() => void handleAddExtractedAudioToTimeline()}
                              disabled={whisperBusy}
                              className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
                                whisperBusy
                                  ? isDark ? 'text-white/30 cursor-not-allowed' : 'text-gray-400 cursor-not-allowed'
                                  : isDark ? 'text-purple-300/70 hover:text-purple-200 hover:bg-purple-500/10' : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                              }`}
                              title={t('tts.addToTimeline')}
                            >
                              {addingToTimeline ? <Loader2 size={11} className="animate-spin" /> : <Film size={11} />}
                              <span>{addingToTimeline ? t('indexTts.exportingSrt') : t('tts.addToTimeline')}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setTrimModeOpen(true)}
                            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
                              isDark
                                ? 'text-purple-300/70 hover:text-purple-200 hover:bg-purple-500/10'
                                : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                            }`}
                          >
                            <Scissors size={11} />
                            {t('audioExtractor.trim')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {subtitleErr && (
                  <p className="text-xs text-red-400">{subtitleErr}</p>
                )}

                <div className="flex gap-3">
                  {trimModeOpen && isTrimmed && (
                    <button
                      onClick={handleTrim}
                      disabled={trimming}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-500/20 transition-all disabled:opacity-50"
                    >
                      {trimming ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}
                      {trimming ? t('audioExtractor.trimming') : t('audioExtractor.trimAndDownload')}
                    </button>
                  )}
                  {(!trimModeOpen || !isTrimmed) && (
                    <button
                      onClick={handleDownload}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-500/20 transition-all"
                    >
                      <Download size={16} />
                      {t('audioExtractor.download')}
                    </button>
                  )}
                  <button
                    onClick={reset}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-500/20 transition-all"
                  >
                    <RotateCcw size={14} />
                    {t('audioExtractor.extractAnother')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </HoverBorderGradient>
    </div>,
    document.body
  );
};
