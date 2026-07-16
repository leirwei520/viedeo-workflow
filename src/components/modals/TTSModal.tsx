import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Mic, Download, Loader2, RotateCcw, Play, Pause, ChevronDown, Search, Volume2, Clock, Film, FileDown, Trash2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { authFetch, apiEndpoint } from '../../config/api';
import { HoverBorderGradient } from '../ui/hover-border-gradient';

interface TTSModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToTimeline?: (audio: { url: string; filename: string }, subtitles: SubtitleSegment[] | null) => void;
  initialText?: string;
}

type Status = 'idle' | 'synthesizing' | 'done' | 'error';

interface Voice {
  id: string;
  name: string;
  avatar: string;
  gender: string;
  age: string;
  description: string;
  languages: { lang: string; text: string; flag: string }[];
  emotions: { icon: string; label: string; value: string }[];
  categories: string[];
  labels: string[];
  trialUrl: string;
  emoji: string;
}

interface SubtitleWord {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

interface SubtitleSegment {
  text: string;
  words: SubtitleWord[];
}

interface SynthResult {
  audioUrl: string;
  filename: string;
  format: string;
  size: number;
  usage?: { text_words?: number } | null;
  subtitles?: SubtitleSegment[] | null;
}

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

const WAVE_NUM_BARS = 100;

const PUNCT_RE = /^[.,;:!?。，；：！？、…—–\-''""「」『』（）()【】\[\]《》<>~～·`@#$%^&*_+=|\\\/\s]+|[.,;:!?。，；：！？、…—–\-''""「」『』（）()【】\[\]《》<>~～·`@#$%^&*_+=|\\\/\s]+$/g;

function stripPunctuation(segments: SubtitleSegment[]): SubtitleSegment[] {
  return segments.map(seg => ({
    ...seg,
    words: seg.words.map(w => ({ ...w, word: w.word.replace(PUNCT_RE, '') })).filter(w => w.word.length > 0),
  })).filter(seg => seg.words.length > 0);
}

export const TTSModal: React.FC<TTSModalProps> = ({ isOpen, onClose, onAddToTimeline, initialText }) => {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const model = 'seed-tts-2.0';

  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [emotion, setEmotion] = useState('');
  const [emotionScale, setEmotionScale] = useState(4);
  const [speechRate, setSpeechRate] = useState(0);
  const [volume, setVolume] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [toneHint, setToneHint] = useState('');
  const [allVoices, setAllVoices] = useState<Voice[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<SynthResult | null>(null);
  const [editingWordKey, setEditingWordKey] = useState<string | null>(null);
  const [formatting, setFormatting] = useState(false);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);

  // Waveform player state
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPlayingId, setHistoryPlayingId] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const historyAudioRef = useRef<HTMLAudioElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    if (isOpen && initialText && !text) {
      setText(initialText);
    }
  }, [isOpen, initialText]);

  useEffect(() => {
    previewAudioRef.current = new Audio();
    previewAudioRef.current.addEventListener('ended', () => setPreviewingVoiceId(null));
    previewAudioRef.current.addEventListener('error', () => setPreviewingVoiceId(null));
    historyAudioRef.current = new Audio();
    historyAudioRef.current.addEventListener('ended', () => setHistoryPlayingId(null));
    historyAudioRef.current.addEventListener('error', () => setHistoryPlayingId(null));
    return () => {
      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
      historyAudioRef.current?.pause();
      historyAudioRef.current = null;
    };
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const resp = await authFetch(apiEndpoint('/api/tts/history?limit=50'));
      const data = await resp.json();
      if (resp.ok) setHistory(data.items || []);
    } catch {}
    finally { setHistoryLoading(false); }
  }, []);

  const loadHistoryItem = useCallback((item: any) => {
    setText(item.text || '');
    if (item.speaker) setSpeaker(item.speaker);
    if (item.params) {
      if (item.params.speechRate != null) setSpeechRate(item.params.speechRate);
      if (item.params.loudnessRate != null) setVolume(item.params.loudnessRate);
      if (item.params.emotion != null) setEmotion(item.params.emotion);
      if (item.params.emotionScale != null) setEmotionScale(item.params.emotionScale);
      if (item.params.pitch != null) setPitch(item.params.pitch);
      if (item.params.toneHint != null) setToneHint(item.params.toneHint || '');
    }
    setStatus('idle');
    setResult(null);
  }, []);

  const deleteHistoryItem = useCallback(async (id: number) => {
    try {
      const resp = await authFetch(apiEndpoint(`/api/tts/history/${id}`), { method: 'DELETE' });
      if (resp.ok) setHistory(prev => prev.filter(h => h.id !== id));
    } catch {}
  }, []);

  const exportHistoryItemSRT = useCallback((item: any) => {
    if (!item.subtitles?.length) return;
    const isLatin = (s: string) => /[a-zA-Z]$/.test(s);
    const cues: { start: number; end: number; text: string }[] = [];
    for (const seg of item.subtitles) {
      if (!seg.words?.length) continue;
      let buf = '';
      let bufStart = seg.words[0].startTime;
      let bufEnd = seg.words[0].endTime;
      for (const w of seg.words) {
        if (buf && (w.startTime - bufEnd > 0.6 || buf.length >= 30)) {
          cues.push({ start: bufStart, end: bufEnd, text: buf.trim() });
          buf = w.word;
          bufStart = w.startTime;
          bufEnd = w.endTime;
        } else {
          const needSpace = buf && isLatin(buf) && /^[a-zA-Z]/.test(w.word);
          buf += (needSpace ? ' ' : '') + w.word;
          bufEnd = w.endTime;
        }
      }
      if (buf.trim()) cues.push({ start: bufStart, end: bufEnd, text: buf.trim() });
    }
    if (cues.length === 0) return;
    const fmtTime = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.round((sec % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    const srt = cues.map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.text}`).join('\n\n');
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (item.filename || 'tts').replace(/\.[^.]+$/, '') + '.srt';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const fetchVoices = useCallback(async (m: string) => {
    setLoadingVoices(true);
    try {
      const resp = await authFetch(apiEndpoint(`/api/tts/voices?model=${encodeURIComponent(m)}`));
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      const list: Voice[] = data.speakers || [];
      if (list.length > 0 && !list[0].trialUrl) {
        console.warn('[TTS] Voices missing trialUrl — server may need restart');
      }
      setAllVoices(list);
      if (list.length > 0) { setSpeaker(list[0].id); setEmotion(''); }
      else setSpeaker('');
    } catch {
      setAllVoices([]);
      setSpeaker('');
    } finally {
      setLoadingVoices(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchVoices(model);
  }, [isOpen, model]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setVoiceDropdownOpen(false);
      }
    };
    if (voiceDropdownOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [voiceDropdownOpen]);

  const stopAllAudio = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setIsPlaying(false);
    previewAudioRef.current?.pause();
    if (previewAudioRef.current) previewAudioRef.current.currentTime = 0;
    setPreviewingVoiceId(null);
    historyAudioRef.current?.pause();
    if (historyAudioRef.current) historyAudioRef.current.currentTime = 0;
    setHistoryPlayingId(null);
  }, []);

  const stopPreview = stopAllAudio;

  const handlePreview = useCallback((voice: Voice, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!voice.trialUrl) return;
    const audio = previewAudioRef.current;
    if (!audio) return;

    if (previewingVoiceId === voice.id) {
      stopAllAudio();
    } else {
      stopAllAudio();
      audio.src = voice.trialUrl;
      audio.play().catch(() => setPreviewingVoiceId(null));
      setPreviewingVoiceId(voice.id);
    }
  }, [previewingVoiceId, stopAllAudio]);

  const toggleHistoryPlay = useCallback((item: any) => {
    const audio = historyAudioRef.current;
    if (!audio) return;
    if (historyPlayingId === item.id) {
      stopAllAudio();
    } else {
      stopAllAudio();
      audio.src = item.audioUrl;
      audio.play().catch(() => setHistoryPlayingId(null));
      setHistoryPlayingId(item.id);
    }
  }, [historyPlayingId, stopAllAudio]);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError('');
    setIsPlaying(false);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
  }, []);

  const handleClose = useCallback(() => {
    reset();
    setText('');
    setSpeechRate(0);
    setVolume(0);
    setPitch(0);
    setToneHint('');
    stopPreview();
    onClose();
  }, [reset, stopPreview, onClose]);

  const handleFormatText = useCallback(async () => {
    if (!text.trim() || formatting) return;
    setFormatting(true);
    try {
      // Client-side pre-clean
      let cleaned = text
        .replace(/https?:\/\/\S+/g, '')
        .replace(/#+\s*/g, '')
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}]/gu, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();

      if (!cleaned) { setFormatting(false); return; }

      const resp = await authFetch(apiEndpoint('/api/tts/format-text'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleaned }),
      });
      const data = await resp.json();
      if (resp.ok && data.text) {
        setText(data.text);
      }
    } catch {}
    finally { setFormatting(false); }
  }, [text, formatting]);

  const handleSynthesize = useCallback(async () => {
    if (!text.trim() || !speaker) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setIsPlaying(false);
    setStatus('synthesizing');
    setError('');
    setResult(null);
    stopPreview();

    try {
      const body: Record<string, unknown> = { text: text.trim(), speaker, model };
      if (emotion) {
        body.emotion = emotion;
        if (emotionScale !== 4) body.emotionScale = emotionScale;
      }
      if (speechRate !== 0) body.speechRate = speechRate;
      if (volume !== 0) body.loudnessRate = volume;
      if (pitch !== 0) body.pitch = pitch;
      if (toneHint.trim()) body.contextTexts = [toneHint.trim()];
      const resp = await authFetch(apiEndpoint('/api/tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Synthesis failed');
      if (data.subtitles?.length) data.subtitles = stripPunctuation(data.subtitles);
      setResult(data);
      setStatus('done');
      if (showHistory) fetchHistory();
    } catch (err: any) {
      setError(err.message || t('tts.synthesisFailed'));
      setStatus('error');
    }
  }, [text, speaker, model, emotion, emotionScale, speechRate, volume, pitch, toneHint, stopPreview, t]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.audioUrl;
    a.download = result.filename;
    a.click();
  }, [result]);

  const updateSubtitleWord = useCallback((segIdx: number, wordIdx: number, newText: string) => {
    if (!result?.subtitles) return;
    setResult(prev => {
      if (!prev?.subtitles) return prev;
      const updated = prev.subtitles.map((seg, si) => si !== segIdx ? seg : {
        ...seg,
        words: seg.words.map((w, wi) => wi !== wordIdx ? w : { ...w, word: newText }),
      });
      return { ...prev, subtitles: updated };
    });
  }, [result]);

  const handleExportSRT = useCallback(() => {
    if (!result?.subtitles?.length) return;
    const isLatin = (s: string) => /[a-zA-Z]$/.test(s);
    const cues: { start: number; end: number; text: string }[] = [];
    for (const seg of result.subtitles) {
      if (!seg.words?.length) continue;
      let buf = '';
      let bufStart = seg.words[0].startTime;
      let bufEnd = seg.words[0].endTime;
      for (const w of seg.words) {
        if (buf && (w.startTime - bufEnd > 0.6 || buf.length >= 30)) {
          cues.push({ start: bufStart, end: bufEnd, text: buf.trim() });
          buf = w.word;
          bufStart = w.startTime;
          bufEnd = w.endTime;
        } else {
          const needSpace = buf && isLatin(buf) && /^[a-zA-Z]/.test(w.word);
          buf += (needSpace ? ' ' : '') + w.word;
          bufEnd = w.endTime;
        }
      }
      if (buf.trim()) cues.push({ start: bufStart, end: bufEnd, text: buf.trim() });
    }
    if (cues.length === 0) return;
    const fmtTime = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.round((sec % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    const srt = cues.map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.text}`).join('\n\n');
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (result.filename || 'tts').replace(/\.[^.]+$/, '') + '.srt';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      stopAllAudio();
      audio.play();
      setIsPlaying(true);
    }
  }, [isPlaying, stopAllAudio]);

  // Decode result audio → waveform peaks
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
        const samplesPerBar = Math.max(1, Math.floor(channel.length / WAVE_NUM_BARS));
        const out: number[] = [];
        let max = 0;
        for (let i = 0; i < WAVE_NUM_BARS; i++) {
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
      } catch {
        if (!cancelled) {
          setPeaks(new Array(WAVE_NUM_BARS).fill(0.5));
          setDuration(audioRef.current?.duration || 0);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [result?.audioUrl]);

  // Track playback time via requestAnimationFrame for smooth playhead
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
    const tt = ratio * duration;
    audio.currentTime = tt;
    setPlaybackTime(tt);
  }, [duration]);

  if (!isOpen) return null;

  const filteredVoices = searchQuery
    ? allVoices.filter(v =>
        v.name.includes(searchQuery) ||
        v.id.includes(searchQuery) ||
        v.description.includes(searchQuery) ||
        v.labels.some(l => l.includes(searchQuery))
      )
    : allVoices;

  const selectedVoice = allVoices.find(v => v.id === speaker);

  const panelBg = isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-white/60' : 'text-gray-500';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';
  const inputBg = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-white/30'
    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400';

  const speechRateLabel = `${(1 + speechRate / 100).toFixed(1)}x`;
  const volumeLabel = `${(1 + volume / 100).toFixed(1)}x`;
  const pitchLabel = pitch > 0 ? `+${pitch}` : `${pitch}`;

  const rainbowSliderBg = (percent: number) => {
    const p = Math.max(0, Math.min(100, percent));
    const unfilled = isDark ? 'rgba(255,255,255,0.08)' : 'rgb(229,231,235)';
    if (p <= 0) return unfilled;
    return `linear-gradient(to right, #a855f7 0%, #ec4899 ${p * 0.33}%, #f59e0b ${p * 0.66}%, #34d399 ${p}%, ${unfilled} ${p}%, ${unfilled} 100%)`;
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <HoverBorderGradient
        containerClassName="relative rounded-2xl w-[560px] max-h-[90vh]"
        className={`rounded-[14px] ${panelBg}`}
        duration={5}
      >
        <div className={`rounded-[14px] ${panelBg} flex flex-col max-h-[85vh]`}>
          {/* Header */}
          <div className={`px-5 pt-4 pb-0 border-b ${borderColor}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    isDark ? 'sf-rainbow-btn !p-0 text-white' : 'lt-btn !p-0 !shadow-sm'
                  }`}
                >
                  <Mic size={20} />
                </div>
                <h2 className={`text-lg font-semibold leading-tight ${textPrimary}`}>{t('tts.title')}</h2>
              </div>
              <button
                onClick={handleClose}
                className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-5 flex-1 overflow-y-auto">
            {(status === 'idle' || status === 'done') && (
              <div className="flex flex-col gap-4">

                {/* Voice selector */}
                {(
                <div className="relative" ref={dropdownRef}>
                  <label className={`text-xs font-medium mb-1.5 block ${textSecondary}`}>{t('tts.voice')}</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => !loadingVoices && setVoiceDropdownOpen(!voiceDropdownOpen)}
                      disabled={loadingVoices}
                      className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm border transition-colors ${inputBg}`}
                    >
                      {loadingVoices ? (
                        <>
                          <Loader2 size={16} className="animate-spin shrink-0" />
                          <span className="flex-1 text-left">{t('tts.loadingVoices')}</span>
                        </>
                      ) : selectedVoice ? (
                        <>
                          {selectedVoice.avatar ? (
                            <img src={selectedVoice.avatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                          ) : selectedVoice.emoji ? (
                            <span className="text-base shrink-0">{selectedVoice.emoji}</span>
                          ) : null}
                          <span className="flex-1 text-left truncate">
                            {selectedVoice.name}
                            <span className={`ml-1.5 text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                              {selectedVoice.gender}
                            </span>
                          </span>
                        </>
                      ) : (
                        <span className="flex-1 text-left">{t('tts.selectVoice')}</span>
                      )}
                      <ChevronDown size={14} className={`shrink-0 transition-transform ${voiceDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Preview selected voice */}
                    {selectedVoice?.trialUrl && (
                      <button
                        onClick={(e) => handlePreview(selectedVoice, e)}
                        className={`px-3 rounded-xl border transition-colors shrink-0 flex items-center gap-1.5 ${
                          previewingVoiceId === selectedVoice.id
                            ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white border-transparent'
                            : inputBg
                        }`}
                        title={t('tts.previewVoice')}
                      >
                        {previewingVoiceId === selectedVoice.id ? <Pause size={14} /> : <Volume2 size={14} />}
                        <span className="text-xs">{t('tts.preview')}</span>
                      </button>
                    )}
                  </div>

                  {voiceDropdownOpen && (
                    <div className={`absolute top-full left-0 right-0 mt-1 rounded-xl border z-50 ${isDark ? 'bg-[var(--sf-bg-panel)] border-white/10' : 'bg-white border-gray-200'} shadow-xl overflow-hidden`}>
                      {/* Search */}
                      <div className={`p-2 border-b ${borderColor}`}>
                        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                          <Search size={14} className={isDark ? 'text-white/30' : 'text-gray-400'} />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder={t('tts.searchVoice')}
                            className={`flex-1 bg-transparent text-sm outline-none ${isDark ? 'text-white placeholder-white/30' : 'text-gray-900 placeholder-gray-400'}`}
                            autoFocus
                          />
                        </div>
                      </div>

                      {/* Voice list */}
                      <div className="max-h-[280px] overflow-y-auto">
                        {filteredVoices.map((v) => (
                          <div
                            key={v.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => { setSpeaker(v.id); setEmotion(''); setVoiceDropdownOpen(false); stopPreview(); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { setSpeaker(v.id); setEmotion(''); setVoiceDropdownOpen(false); stopPreview(); } }}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer ${
                              speaker === v.id
                                ? isDark ? 'bg-white/10' : 'bg-purple-50'
                                : isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'
                            }`}
                          >
                            {v.avatar ? (
                              <img src={v.avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                            ) : (
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${isDark ? 'bg-white/10 text-white/50' : 'bg-gray-100 text-gray-400'}`}>
                                {v.emoji || (v.gender === '女' ? '♀' : '♂')}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-sm font-medium truncate ${speaker === v.id ? (isDark ? 'text-white' : 'text-purple-700') : (isDark ? 'text-white/80' : 'text-gray-700')}`}>
                                  {v.name}
                                </span>
                                <span className={`text-xs shrink-0 ${isDark ? 'text-white/30' : 'text-gray-400'}`}>{v.gender}{v.age ? `·${v.age}` : ''}</span>
                                {v.labels.slice(0, 2).map(l => (
                                  <span key={l} className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 shrink-0">{l}</span>
                                ))}
                              </div>
                              {v.description && (
                                <p className={`text-xs truncate mt-0.5 ${isDark ? 'text-white/30' : 'text-gray-400'}`}>{v.description}</p>
                              )}
                            </div>

                            {/* Trial play button */}
                            {v.trialUrl ? (
                              <button
                                onClick={(e) => handlePreview(v, e)}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shrink-0 ${
                                  previewingVoiceId === v.id
                                    ? 'bg-purple-500 text-white scale-110'
                                    : isDark ? 'bg-white/10 text-white/50 hover:bg-purple-500/30 hover:text-purple-300' : 'bg-gray-200 text-gray-500 hover:bg-purple-100 hover:text-purple-600'
                                }`}
                                title={t('tts.previewVoice')}
                              >
                                {previewingVoiceId === v.id ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
                              </button>
                            ) : (
                              <div className="w-7 shrink-0" />
                            )}
                          </div>
                        ))}
                        {filteredVoices.length === 0 && (
                          <p className={`px-3 py-6 text-sm text-center ${textSecondary}`}>
                            {allVoices.length === 0 ? t('tts.noVoices') : t('tts.noSearchResults')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                )}

                {/* Emotion selector */}
                {selectedVoice && selectedVoice.emotions.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className={`text-xs font-medium mb-1.5 block ${textSecondary}`}>{t('tts.emotion')}</label>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => { setEmotion(''); setEmotionScale(4); }}
                          className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                            !emotion
                              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm'
                              : isDark ? 'bg-white/5 text-white/50 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          {t('tts.defaultEmotion')}
                        </button>
                        {selectedVoice.emotions.map(e => (
                          <button
                            key={e.value}
                            onClick={() => setEmotion(e.value)}
                            className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                              emotion === e.value
                                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm'
                                : isDark ? 'bg-white/5 text-white/50 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {e.icon} {e.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Emotion scale (only when an emotion is selected) */}
                    {emotion && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className={`text-xs font-medium ${textSecondary}`}>{t('tts.emotionScale')}</label>
                          <span className={`text-xs font-mono ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{emotionScale}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-[10px] shrink-0 ${textSecondary}`}>1</span>
                          <div className="flex-1 flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map(v => (
                              <button
                                key={v}
                                onClick={() => setEmotionScale(v)}
                                className={`flex-1 h-7 rounded-lg text-xs font-medium transition-all ${
                                  emotionScale === v
                                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm'
                                    : isDark ? 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70' : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                                }`}
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                          <span className={`text-[10px] shrink-0 ${textSecondary}`}>5</span>
                        </div>
                        <p className={`text-[10px] mt-1 ${isDark ? 'text-white/25' : 'text-gray-400'}`}>{t('tts.emotionScaleHint')}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Audio params: speech rate, volume, pitch */}
                <div className="flex flex-col gap-2.5">
                  {/* Speech rate */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className={`text-xs font-medium ${textSecondary}`}>{t('tts.speechRate')}</label>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-mono ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{speechRateLabel}</span>
                        {speechRate !== 0 && <button onClick={() => setSpeechRate(0)} className={`text-[10px] px-1 py-0.5 rounded ${isDark ? 'text-white/30 hover:text-white/60 bg-white/5' : 'text-gray-400 hover:text-gray-600 bg-gray-100'}`}>{t('tts.reset')}</button>}
                      </div>
                    </div>
                    <input type="range" min={-50} max={100} step={5} value={speechRate} onChange={e => setSpeechRate(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-pink-500"
                      style={{ background: rainbowSliderBg(((speechRate + 50) / 150) * 100) }}
                    />
                  </div>
                  {/* Volume */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className={`text-xs font-medium ${textSecondary}`}>{t('tts.volume')}</label>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-mono ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{volumeLabel}</span>
                        {volume !== 0 && <button onClick={() => setVolume(0)} className={`text-[10px] px-1 py-0.5 rounded ${isDark ? 'text-white/30 hover:text-white/60 bg-white/5' : 'text-gray-400 hover:text-gray-600 bg-gray-100'}`}>{t('tts.reset')}</button>}
                      </div>
                    </div>
                    <input type="range" min={-50} max={100} step={5} value={volume} onChange={e => setVolume(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-pink-500"
                      style={{ background: rainbowSliderBg(((volume + 50) / 150) * 100) }}
                    />
                  </div>
                  {/* Pitch */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className={`text-xs font-medium ${textSecondary}`}>{t('tts.pitch')}</label>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-mono ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{pitchLabel}</span>
                        {pitch !== 0 && <button onClick={() => setPitch(0)} className={`text-[10px] px-1 py-0.5 rounded ${isDark ? 'text-white/30 hover:text-white/60 bg-white/5' : 'text-gray-400 hover:text-gray-600 bg-gray-100'}`}>{t('tts.reset')}</button>}
                      </div>
                    </div>
                    <input type="range" min={-12} max={12} step={1} value={pitch} onChange={e => setPitch(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-pink-500"
                      style={{ background: rainbowSliderBg(((pitch + 12) / 24) * 100) }}
                    />
                  </div>
                </div>

                {/* Tone hint (context_texts) */}
                <div>
                  <label className={`text-xs font-medium mb-1.5 block ${textSecondary}`}>{t('tts.tone')}</label>
                  <input
                    type="text"
                    value={toneHint}
                    onChange={e => setToneHint(e.target.value)}
                    placeholder={t('tts.tonePlaceholder')}
                    className={`w-full px-3 py-2 rounded-xl text-sm outline-none transition-colors border ${inputBg}`}
                  />
                </div>

                {/* Text input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={`text-xs font-medium ${textSecondary}`}>{t('tts.inputText')}</label>
                    <button
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
                    placeholder={t('tts.textPlaceholder')}
                    rows={4}
                    className={`w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors resize-none border ${inputBg}`}
                  />
                  <p className={`text-xs mt-1 text-right ${isDark ? 'text-white/30' : 'text-gray-400'}`}>{text.length} {t('tts.chars')}</p>
                </div>

                {/* Previous result */}
                {status === 'done' && result && (
                  <div className="flex flex-col gap-4">
                    <audio
                      ref={audioRef}
                      src={result.audioUrl}
                      preload="auto"
                      className="hidden"
                      onEnded={() => setIsPlaying(false)}
                      onPause={() => setIsPlaying(false)}
                      onPlay={() => setIsPlaying(true)}
                    />

                    {/* Waveform player */}
                    <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                      <div className="px-3">
                        <div
                          ref={waveformRef}
                          className="relative cursor-pointer select-none w-full"
                          style={{ height: 100 }}
                          onClick={handleWaveformClick}
                        >
                          <div className="absolute inset-0 flex items-center gap-[1px]">
                            {(peaks.length ? peaks : new Array(WAVE_NUM_BARS).fill(0.3)).map((peak, i) => {
                              const barTime = (i / WAVE_NUM_BARS) * (duration || 1);
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
                          {result.usage?.text_words ? ` · ${result.usage.text_words} ${t('tts.chars')}` : ''}
                        </div>
                        {/* Inline actions, pushed to the right */}
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
                          {onAddToTimeline && (
                            <button
                              type="button"
                              onClick={() => {
                                onAddToTimeline(
                                  { url: result.audioUrl, filename: result.filename },
                                  result.subtitles || null
                                );
                                onClose();
                              }}
                              className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
                                isDark ? 'text-purple-300/70 hover:text-purple-200 hover:bg-purple-500/10' : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                              }`}
                              title={t('tts.addToTimeline')}
                            >
                              <Film size={11} />
                              <span>{t('tts.addToTimeline')}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Subtitles / timestamps */}
                    {result.subtitles && result.subtitles.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className={`text-[10px] font-medium ${textSecondary}`}>{t('tts.subtitles')}</p>
                          <button
                            onClick={handleExportSRT}
                            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                              isDark ? 'text-purple-400/60 hover:text-purple-300 hover:bg-purple-500/10' : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                            }`}
                            title={t('tts.exportSRT')}
                          >
                            <FileDown size={10} />
                            <span>{t('tts.exportSRT')}</span>
                          </button>
                        </div>
                        <div className={`rounded-lg p-2.5 max-h-[120px] overflow-y-auto text-xs leading-relaxed ${isDark ? 'bg-black/20' : 'bg-white'}`}>
                          {result.subtitles.map((seg, si) => (
                            <div key={si} className="mb-1.5 last:mb-0">
                              <div className="flex flex-wrap gap-x-0.5">
                                {seg.words.map((w, wi) => {
                                  const wKey = `${si}-${wi}`;
                                  const isEditing = editingWordKey === wKey;
                                  return isEditing ? (
                                    <input
                                      key={wi}
                                      autoFocus
                                      defaultValue={w.word}
                                      className={`inline-block px-0.5 py-0 rounded text-xs outline-none border ${
                                        isDark ? 'bg-white/10 border-purple-500/50 text-white' : 'bg-white border-purple-400 text-gray-900'
                                      }`}
                                      style={{ width: Math.max(24, w.word.length * 14 + 8) }}
                                      onBlur={(e) => {
                                        const v = e.target.value.trim();
                                        if (v && v !== w.word) updateSubtitleWord(si, wi, v);
                                        setEditingWordKey(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                        if (e.key === 'Escape') setEditingWordKey(null);
                                      }}
                                    />
                                  ) : (
                                    <span key={wi} className="group relative cursor-pointer" onClick={() => setEditingWordKey(wKey)}>
                                      <span className={`${textPrimary} hover:underline decoration-purple-400/50`}>{w.word}</span>
                                      <span className={`absolute -top-5 left-1/2 -translate-x-1/2 px-1 py-0.5 rounded text-[9px] font-mono whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none ${isDark ? 'bg-white/20 text-white/80' : 'bg-gray-800 text-white'}`}>
                                        {w.startTime.toFixed(2)}s
                                      </span>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Synthesize button */}
                <button
                  onClick={handleSynthesize}
                  disabled={!text.trim() || !speaker}
                  className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
                    text.trim() && speaker
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-500/20'
                      : isDark
                        ? 'bg-white/5 text-white/30 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {status === 'done' ? t('tts.synthesizeAgain') : t('tts.synthesize')}
                </button>

                {/* History section */}
                <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <button
                    onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchHistory(); }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Clock size={13} className={textSecondary} />
                      <span className={`text-xs font-medium ${textSecondary}`}>{t('tts.history')}</span>
                      {history.length > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isDark ? 'bg-white/10 text-white/40' : 'bg-gray-200 text-gray-500'}`}>{history.length}</span>}
                    </div>
                    <ChevronDown size={13} className={`transition-transform ${textSecondary} ${showHistory ? 'rotate-180' : ''}`} />
                  </button>
                  {showHistory && (
                    <>
                      {historyLoading ? (
                        <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-purple-400" /></div>
                      ) : history.length === 0 ? (
                        <p className={`text-xs py-6 text-center ${textSecondary}`}>{t('tts.noHistory')}</p>
                      ) : (
                        <div className="max-h-[240px] overflow-y-auto">
                          {history.map(item => (
                            <div key={item.id}
                              className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}
                            >
                              <button
                                onClick={() => toggleHistoryPlay(item)}
                                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${
                                  historyPlayingId === item.id
                                    ? 'bg-purple-500 text-white scale-110'
                                    : isDark ? 'bg-white/10 text-white/50 hover:bg-purple-500/30' : 'bg-gray-200 text-gray-500 hover:bg-purple-100'
                                }`}
                              >
                                {historyPlayingId === item.id ? <Pause size={11} /> : <Play size={11} className="ml-0.5" />}
                              </button>
                              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadHistoryItem(item)} title={t('tts.loadParams')}>
                                <p className={`text-xs truncate ${textPrimary}`}>{item.text}</p>
                                <p className={`text-[10px] ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
                                  {formatSize(item.size)} · {new Date(item.createdAt).toLocaleString()}
                                </p>
                              </div>
                              <button
                                onClick={() => exportHistoryItemSRT(item)}
                                disabled={!item.subtitles?.length}
                                className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                                  !item.subtitles?.length
                                    ? isDark ? 'text-white/10 cursor-not-allowed' : 'text-gray-200 cursor-not-allowed'
                                    : isDark ? 'text-purple-400/40 hover:text-purple-300 hover:bg-purple-500/10' : 'text-purple-500 hover:text-purple-600 hover:bg-purple-50'
                                }`}
                                title={item.subtitles?.length ? t('tts.exportSRT') : t('tts.noSubtitles')}
                              >
                                <FileDown size={13} />
                              </button>
                              <a href={item.audioUrl} download={item.filename}
                                className={`p-1.5 rounded-lg transition-colors shrink-0 ${isDark ? 'text-white/30 hover:text-white/60 hover:bg-white/5' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                                title={t('tts.download')}
                              >
                                <Download size={13} />
                              </a>
                              <button
                                onClick={() => deleteHistoryItem(item.id)}
                                className={`p-1.5 rounded-lg transition-colors shrink-0 ${isDark ? 'text-white/20 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-300 hover:text-red-500 hover:bg-red-50'}`}
                                title={t('common.delete')}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {status === 'synthesizing' && (
              <div className="flex flex-col items-center gap-4 py-10">
                <Loader2 size={36} className="animate-spin text-purple-400" />
                <p className={`text-sm ${textSecondary}`}>{t('tts.synthesizing')}</p>
              </div>
            )}

            {status === 'error' && (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="p-3 rounded-full bg-red-500/10">
                  <X size={24} className="text-red-400" />
                </div>
                <p className="text-sm text-red-400 text-center max-w-[360px]">{error}</p>
                <button
                  onClick={reset}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600"
                >
                  <RotateCcw size={14} />
                  {t('tts.retry')}
                </button>
              </div>
            )}
          </div>
        </div>
      </HoverBorderGradient>
    </div>,
    document.body
  );
};
