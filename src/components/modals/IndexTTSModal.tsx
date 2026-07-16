import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Fingerprint, Upload, Loader2, Download, Play, Pause, Film, Sparkles, FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { authFetch, apiEndpoint } from '../../config/api';
import { HoverBorderGradient } from '../ui/hover-border-gradient';

/** Same shape as TTSModal / `handleTTSAddToTimeline` word-level cues build. */
interface SubtitleSegmentForTimeline {
  text: string;
  words: Array<{ word: string; startTime: number; endTime: number; confidence: number }>;
}

interface IndexTTSModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToTimeline?: (
    audio: { url: string; filename: string },
    subtitles: SubtitleSegmentForTimeline[] | null
  ) => void;
}

type Status = 'idle' | 'uploading' | 'synthesizing' | 'done' | 'error';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const NUM_BARS = 100;

/** faster-whisper `segments[]` → word-level cues that `handleTTSAddToTimeline` can fold into cues. */
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

export const IndexTTSModal: React.FC<IndexTTSModalProps> = ({ isOpen, onClose, onAddToTimeline }) => {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const [text, setText] = useState('');
  const [seed, setSeed] = useState<string>('');
  const [audioPaths, setAudioPaths] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [formatting, setFormatting] = useState(false);
  const [result, setResult] = useState<{ audioUrl: string; filename: string; size: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [exportingSrt, setExportingSrt] = useState(false);
  const [addingToTimeline, setAddingToTimeline] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  /** Reuse Whisper transcription between “导出字幕” and “添加到时间轴”. */
  const whisperCacheRef = useRef<{ url: string; segments: { start: number; end: number; text: string }[] } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
  }, [isOpen]);

  useEffect(() => {
    whisperCacheRef.current = null;
  }, [result?.audioUrl]);

  const handleClose = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    onClose();
  }, [onClose]);

  // Decode audio → waveform peaks (mirrors AudioExtractorModal)
  useEffect(() => {
    if (!result?.audioUrl) {
      setPeaks([]);
      setDuration(0);
      setPlaybackTime(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(result.audioUrl);
        const buf = await resp.arrayBuffer();
        const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        const ctx = new Ctor();
        const audio = await ctx.decodeAudioData(buf);
        if (cancelled) { ctx.close(); return; }

        const channel = audio.getChannelData(0);
        const samplesPerBar = Math.max(1, Math.floor(channel.length / NUM_BARS));
        const out: number[] = [];
        let max = 0;
        for (let i = 0; i < NUM_BARS; i++) {
          const start = i * samplesPerBar;
          const end = Math.min(start + samplesPerBar, channel.length);
          let peak = 0;
          for (let j = start; j < end; j++) {
            const v = Math.abs(channel[j]);
            if (v > peak) peak = v;
          }
          out.push(peak);
          if (peak > max) max = peak;
        }
        const normalized = max > 0 ? out.map(v => v / max) : out;
        setPeaks(normalized);
        setDuration(audio.duration);
        ctx.close();
      } catch (e) {
        if (!cancelled) {
          setPeaks(new Array(NUM_BARS).fill(0.5));
          setDuration(audioRef.current?.duration || 0);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [result?.audioUrl]);

  // requestAnimationFrame loop to track playback time
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying) return;
    const tick = () => {
      setPlaybackTime(audio.currentTime);
      if (audio.currentTime >= (duration || audio.duration)) {
        audio.pause();
        audio.currentTime = 0;
        setPlaybackTime(0);
        setIsPlaying(false);
        return;
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, duration]);

  const handleWaveformClick = useCallback((e: React.MouseEvent) => {
    const el = waveformRef.current;
    const audio = audioRef.current;
    if (!el || !audio || !duration) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = ratio * duration;
    audio.currentTime = t;
    setPlaybackTime(t);
  }, [duration]);

  const parseApiError = useCallback(async (resp: Response): Promise<string> => {
    const raw = await resp.text();
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        const data = JSON.parse(trimmed) as { error?: string; message?: string };
        if (data?.error) return String(data.error);
        if (data?.message) return String(data.message);
      } catch {
        /* fall through */
      }
    }
    if (resp.status === 404) {
      return t('indexTts.error404');
    }
    const snippet = trimmed.replace(/\s+/g, ' ').slice(0, 160);
    return snippet || `HTTP ${resp.status}`;
  }, [t]);

  const handleUpload = useCallback(async (file: File) => {
    setError('');
    setResult(null);
    setStatus('uploading');
    const fd = new FormData();
    fd.append('audio', file);
    try {
      const resp = await authFetch(apiEndpoint('/api/index-tts/reference'), {
        method: 'POST',
        body: fd,
      });
      if (!resp.ok) {
        setError(await parseApiError(resp));
        setStatus('error');
        return;
      }
      const data = await resp.json();
      const paths: string[] = Array.isArray(data.audioPaths) ? data.audioPaths : [];
      if (paths.length === 0) {
        setError(t('indexTts.uploadBadResponse'));
        setStatus('error');
        return;
      }
      setAudioPaths(paths);
      setFileName(file.name);
      setStatus('idle');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [t, parseApiError]);

  const handleFormatText = useCallback(async () => {
    if (!text.trim() || formatting) return;
    setFormatting(true);
    try {
      const resp = await authFetch(apiEndpoint('/api/tts/format-text'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await resp.json();
      if (resp.ok && typeof data?.text === 'string' && data.text.trim()) {
        setText(data.text);
      }
    } catch (err) {
      console.warn('[IndexTTS Format] failed:', err);
    } finally {
      setFormatting(false);
    }
  }, [text, formatting]);

  const handleSynthesize = useCallback(async () => {
    if (!text.trim() || audioPaths.length === 0) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setStatus('synthesizing');
    setError('');
    setResult(null);
    try {
      const body: { text: string; audio_paths: string[]; seed?: number } = {
        text: text.trim(),
        audio_paths: audioPaths,
      };
      if (seed.trim() !== '' && Number.isFinite(Number(seed))) {
        body.seed = Math.floor(Number(seed));
      }
      const resp = await authFetch(apiEndpoint('/api/index-tts/synthesize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let data: { audioUrl?: string; filename?: string; size?: number; error?: string } = {};
      try {
        data = await resp.json();
      } catch {
        throw new Error(t('indexTts.synthesisFailed'));
      }
      if (!resp.ok) throw new Error(data.error || t('indexTts.synthesisFailed'));
      setResult({
        audioUrl: data.audioUrl,
        filename: data.filename || 'voice-clone.wav',
        size: data.size || 0,
      });
      setStatus('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [text, audioPaths, seed, t]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.audioUrl;
    a.download = result.filename;
    a.click();
  }, [result]);

  /** Detect if the synthesized text contains Chinese characters → pick the zh-specific Whisper model. */
  const detectLanguage = useCallback((s: string): 'zh' | undefined => {
    return /[\u4e00-\u9fff]/.test(s) ? 'zh' : undefined;
  }, []);

  const ensureWhisperSegments = useCallback(async (): Promise<{ start: number; end: number; text: string }[]> => {
    if (!result?.audioUrl) throw new Error('no audio');
    const hit = whisperCacheRef.current;
    if (hit?.url === result.audioUrl && hit.segments.length > 0) return hit.segments;
    const language = detectLanguage(text);
    const resp = await authFetch(apiEndpoint('/api/whisper/transcribe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUrl: result.audioUrl, language }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || `transcription failed (${resp.status})`);
    const segments: { start: number; end: number; text: string }[] = Array.isArray(data?.segments) ? data.segments : [];
    if (segments.length === 0) throw new Error('no segments returned');
    whisperCacheRef.current = { url: result.audioUrl, segments };
    return segments;
  }, [result, text, detectLanguage]);

  /** Build SRT from `[{ start, end, text }]` segments. Times in seconds. */
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
    setError('');
    try {
      const segments = await ensureWhisperSegments();
      const srt = segmentsToSrt(segments);
      const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (result.filename || 'voice-clone').replace(/\.[^.]+$/, '') + '.srt';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportingSrt(false);
    }
  }, [result, exportingSrt, addingToTimeline, ensureWhisperSegments, segmentsToSrt]);

  const handleAddToTimeline = useCallback(async () => {
    if (!result || !onAddToTimeline || exportingSrt || addingToTimeline) return;
    setAddingToTimeline(true);
    setError('');
    try {
      const segments = await ensureWhisperSegments();
      const subtitles = whisperSegmentsToTimelineSegments(segments);
      onAddToTimeline({ url: result.audioUrl, filename: result.filename }, subtitles);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingToTimeline(false);
    }
  }, [result, onAddToTimeline, exportingSrt, addingToTimeline, ensureWhisperSegments, onClose]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !result) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      el.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }, [isPlaying, result]);

  if (!isOpen) return null;

  const whisperBusy = exportingSrt || addingToTimeline;

  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-white/50' : 'text-gray-500';
  const panelBg = isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';
  const inputBg = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/30'
    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400';

  /** 文案/参考音未就绪或正在上传参考音 → 灰色不可点样式；合成中时仍为主按钮样式（仅禁用防连点） */
  const synthFormBlocked = !text.trim() || audioPaths.length === 0 || status === 'uploading';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <HoverBorderGradient
        containerClassName="relative rounded-2xl w-full max-w-[520px] max-h-[90vh]"
        className={`rounded-[14px] ${panelBg}`}
        duration={5}
      >
        <div className={`rounded-[14px] ${panelBg} flex flex-col max-h-[85vh]`}>
          <div className={`px-5 pt-4 pb-0 border-b ${borderColor}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    isDark ? 'sf-rainbow-btn !p-0 text-white' : 'lt-btn !p-0 !shadow-sm'
                  }`}
                >
                  <Fingerprint size={20} />
                </div>
                <h2 className={`text-lg font-semibold leading-tight ${textPrimary}`}>{t('indexTts.title')}</h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="p-5 flex-1 overflow-y-auto flex flex-col gap-4">
            <div>
              <label className={`text-xs font-medium mb-1.5 block ${textSecondary}`}>{t('indexTts.reference')}</label>
              <input ref={fileInputRef} type="file" accept=".wav,audio/wav" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = '';
              }} />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={status === 'uploading'}
                  onClick={() => fileInputRef.current?.click()}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-colors ${inputBg} ${status === 'uploading' ? 'opacity-60' : ''}`}
                >
                  {status === 'uploading' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {status === 'uploading' ? t('indexTts.uploading') : t('indexTts.uploadBtn')}
                </button>
                {fileName && (
                  <span className={`text-xs truncate max-w-[220px] ${textSecondary}`} title={fileName}>
                    {fileName}
                  </span>
                )}
              </div>
              {audioPaths.length > 0 && (
                <p className={`text-[10px] mt-1.5 font-mono break-all ${isDark ? 'text-white/35' : 'text-gray-400'}`}>
                  {audioPaths.join(', ')}
                </p>
              )}
            </div>

            <div>
              <label className={`text-xs font-medium mb-1.5 block ${textSecondary}`}>{t('indexTts.seedOptional')}</label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder={t('indexTts.seedPlaceholder')}
                className={`w-full px-3 py-2 rounded-xl text-sm border outline-none ${inputBg} ${isDark ? '[color-scheme:dark]' : '[color-scheme:light]'} [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`text-xs font-medium ${textSecondary}`}>{t('indexTts.text')}</label>
                <button
                  type="button"
                  onClick={handleFormatText}
                  disabled={!text.trim() || formatting}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                    !text.trim() || formatting
                      ? isDark ? 'text-white/15 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed'
                      : isDark ? 'text-purple-400/60 hover:text-purple-300 hover:bg-purple-500/10' : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                  }`}
                  title={t('tts.formatText')}
                >
                  {formatting ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                  <span>{formatting ? t('tts.formatting') : t('tts.formatText')}</span>
                </button>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder={t('indexTts.textPlaceholder')}
                className={`w-full px-3 py-2.5 rounded-xl text-sm border outline-none resize-y min-h-[100px] ${inputBg}`}
              />
              <p className={`text-xs mt-1 text-right ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
                {text.length} {t('tts.chars')}
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            {result && (
              <div className="flex flex-col gap-4">
                <audio
                  ref={audioRef}
                  src={result.audioUrl}
                  preload="auto"
                  className="hidden"
                  onEnded={() => setIsPlaying(false)}
                />

                {/* Waveform player (mirrors AudioExtractor) */}
                <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className="px-3">
                    <div
                      ref={waveformRef}
                      className="relative cursor-pointer select-none w-full"
                      style={{ height: 100 }}
                      onClick={handleWaveformClick}
                    >
                      <div className="absolute inset-0 flex items-center gap-[1px]">
                        {(peaks.length ? peaks : new Array(NUM_BARS).fill(0.3)).map((peak, i) => {
                          const barTime = (i / NUM_BARS) * (duration || 1);
                          const isPast = barTime <= playbackTime;
                          const color = isPast && isPlaying
                            ? 'bg-purple-400'
                            : isDark ? 'bg-purple-500/60' : 'bg-purple-400/50';
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
                      {duration > 0 && (
                        <div
                          className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(255,255,255,0.5)] pointer-events-none z-30"
                          style={{ left: `${(playbackTime / duration) * 100}%`, transition: 'none' }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Controls bar — playback + meta + inline actions */}
                  <div className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-t ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                    <button
                      type="button"
                      onClick={togglePlay}
                      className={`p-1.5 rounded-lg transition-colors shrink-0 ${isDark ? 'hover:bg-white/10 text-white/70 hover:text-white' : 'hover:bg-gray-200 text-gray-600 hover:text-gray-900'}`}
                    >
                      {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <div className={`text-[11px] font-mono ${textSecondary}`}>
                      {formatDuration(playbackTime)} / {formatDuration(duration)}
                    </div>
                    <div className={`text-[10px] ${textSecondary}`}>
                      {formatSize(result.size)}
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleDownload}
                        className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
                          isDark ? 'text-purple-300/70 hover:text-purple-200 hover:bg-purple-500/10' : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                        }`}
                        title={t('tts.download')}
                      >
                        <Download size={11} />
                        <span>{t('tts.download')}</span>
                      </button>
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
                          onClick={() => void handleAddToTimeline()}
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
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            className={`px-5 py-3 border-t flex justify-end gap-4 items-center ${
              isDark ? 'border-neutral-800 bg-[#1a1a1a]' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <button
              type="button"
              onClick={handleClose}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors ${
                isDark ? 'sf-rainbow-btn' : 'lt-btn-primary'
              }`}
            >
              {t('common.close')}
            </button>
            <button
              type="button"
              disabled={synthFormBlocked || status === 'synthesizing'}
              onClick={() => void handleSynthesize()}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                isDark
                  ? 'text-white sf-rainbow-btn disabled:!bg-neutral-700 disabled:!text-neutral-500'
                  : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {status === 'synthesizing' ? (
                <>
                  <Loader2 size={14} className="animate-spin shrink-0" />
                  <span>{t('indexTts.synthesize')}</span>
                </>
              ) : (
                <span>{status === 'done' && result ? t('tts.synthesizeAgain') : t('indexTts.synthesize')}</span>
              )}
            </button>
          </div>
        </div>
      </HoverBorderGradient>
    </div>,
    document.body
  );
};
