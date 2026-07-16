import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Eraser, Download, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import {
  checkSubtitleRemoverHealth,
  startSubtitleRemoval,
  waitForSubtitleRemoval,
  type InpaintMode,
} from '../../services/subtitleRemoverService';

interface SubtitleRemoverModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Status = 'idle' | 'checking' | 'processing' | 'done' | 'error';

interface RemoveResult {
  videoUrl: string;
  filename: string;
  duration: number;
  size: number;
}

const INPAINT_MODES: { value: InpaintMode; labelKey: string }[] = [
  { value: 'sttn-det', labelKey: 'sttnDet' },
  { value: 'lama', labelKey: 'lama' },
  { value: 'sttn-auto', labelKey: 'sttnAuto' },
  { value: 'propainter', labelKey: 'propainter' },
  { value: 'opencv', labelKey: 'opencv' },
];

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

export const SubtitleRemoverModal: React.FC<SubtitleRemoverModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const [status, setStatus] = useState<Status>('idle');
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RemoveResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inpaintMode, setInpaintMode] = useState<InpaintMode>('sttn-det');
  const [subtitleArea, setSubtitleArea] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setError('');
    setResult(null);
    setSelectedFile(null);
    setInpaintMode('sttn-det');
    setSubtitleArea('');
    setShowAdvanced(false);
    setDragOver(false);
  }, []);

  const handleClose = useCallback(() => {
    if (status === 'processing') return;
    reset();
    onClose();
  }, [reset, onClose, status]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setStatus('checking');
    checkSubtitleRemoverHealth()
      .then((health) => {
        if (cancelled) return;
        setServiceAvailable(health.available);
        setStatus('idle');
      })
      .catch(() => {
        if (cancelled) return;
        setServiceAvailable(false);
        setStatus('idle');
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  const processFile = useCallback(async (file: File) => {
    setSelectedFile(file);
    setStatus('processing');
    setProgress(0);
    setError('');
    setResult(null);

    try {
      const jobId = await startSubtitleRemoval(file, {
        inpaintMode,
        subtitleArea: subtitleArea.trim() || undefined,
      });

      const finalStatus = await waitForSubtitleRemoval(jobId, (p, s) => {
        setProgress(p);
        if (s === 'running' || s === 'pending') setStatus('processing');
      });

      setResult({
        videoUrl: finalStatus.videoUrl!,
        filename: finalStatus.filename || 'no_subtitle.mp4',
        duration: finalStatus.duration || 0,
        size: finalStatus.size || 0,
      });
      setProgress(100);
      setStatus('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [inpaintMode, subtitleArea]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      processFile(file);
    }
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFile]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.videoUrl;
    a.download = result.filename;
    a.click();
  }, [result]);

  if (!isOpen) return null;

  const panelBg = isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-white/60' : 'text-gray-500';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <HoverBorderGradient
        containerClassName="relative rounded-2xl w-[560px] max-h-[90vh]"
        className={`rounded-[14px] ${panelBg}`}
        duration={5}
      >
        <div className={`rounded-[14px] ${panelBg} flex flex-col max-h-[85vh]`}>
          <div className={`flex items-center justify-between px-5 py-4 border-b ${borderColor}`}>
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  isDark ? 'sf-rainbow-btn !p-0 text-white' : 'lt-btn !p-0 !shadow-sm'
                }`}
              >
                <Eraser size={20} />
              </div>
              <div>
                <h2 className={`text-lg font-semibold leading-tight ${textPrimary}`}>
                  {t('subtitleRemover.title')}
                </h2>
                <p className={`text-xs mt-0.5 ${textSecondary}`}>{t('subtitleRemover.subtitle')}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={status === 'processing'}
              className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'
              }`}
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-5 flex-1 overflow-y-auto space-y-4">
            {status === 'checking' && (
              <div className={`flex items-center gap-2 text-sm ${textSecondary}`}>
                <Loader2 size={16} className="animate-spin" />
                {t('subtitleRemover.checkingService')}
              </div>
            )}

            {serviceAvailable === false && status !== 'checking' && (
              <div className={`flex gap-3 p-3 rounded-xl border ${isDark ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
                <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className={isDark ? 'text-amber-200' : 'text-amber-800'}>{t('subtitleRemover.serviceOffline')}</p>
                  <p className={`mt-1 text-xs ${textSecondary}`}>{t('subtitleRemover.serviceOfflineHint')}</p>
                </div>
              </div>
            )}

            {status === 'idle' && serviceAvailable !== false && (
              <>
                <div>
                  <label className={`block text-xs font-medium mb-1.5 ${textSecondary}`}>
                    {t('subtitleRemover.inpaintMode')}
                  </label>
                  <select
                    value={inpaintMode}
                    onChange={(e) => setInpaintMode(e.target.value as InpaintMode)}
                    className={`w-full rounded-lg px-3 py-2 text-sm border outline-none ${
                      isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900'
                    }`}
                  >
                    {INPAINT_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {t(`subtitleRemover.modes.${m.labelKey}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className={`text-xs ${isDark ? 'text-white/50 hover:text-white/70' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {showAdvanced ? t('subtitleRemover.hideAdvanced') : t('subtitleRemover.showAdvanced')}
                </button>

                {showAdvanced && (
                  <div>
                    <label className={`block text-xs font-medium mb-1.5 ${textSecondary}`}>
                      {t('subtitleRemover.subtitleArea')}
                    </label>
                    <input
                      type="text"
                      value={subtitleArea}
                      onChange={(e) => setSubtitleArea(e.target.value)}
                      placeholder={t('subtitleRemover.subtitleAreaPlaceholder')}
                      className={`w-full rounded-lg px-3 py-2 text-sm border outline-none ${
                        isDark ? 'bg-white/5 border-white/10 text-white placeholder:text-white/30' : 'bg-white border-gray-200 text-gray-900'
                      }`}
                    />
                    <p className={`text-[11px] mt-1 ${textSecondary}`}>{t('subtitleRemover.subtitleAreaHint')}</p>
                  </div>
                )}

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
                  <p className={`text-sm font-medium ${textPrimary}`}>{t('subtitleRemover.dragOrClick')}</p>
                  <p className={`text-xs ${textSecondary}`}>{t('subtitleRemover.supportedFormats')}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>
              </>
            )}

            {status === 'processing' && (
              <div className="space-y-4">
                <div className={`flex items-center gap-2 text-sm ${textPrimary}`}>
                  <Loader2 size={16} className="animate-spin text-purple-400" />
                  {t('subtitleRemover.processing')}
                </div>
                {selectedFile && (
                  <p className={`text-xs truncate ${textSecondary}`}>{selectedFile.name}</p>
                )}
                <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                    style={{ width: `${Math.max(progress, 2)}%` }}
                  />
                </div>
                <p className={`text-xs text-center ${textSecondary}`}>
                  {progress > 0 ? `${progress}%` : t('subtitleRemover.initializing')}
                </p>
                <p className={`text-[11px] text-center ${textSecondary}`}>{t('subtitleRemover.processingHint')}</p>
              </div>
            )}

            {status === 'done' && result && (
              <div className="space-y-4">
                <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                  <CheckCircle2 size={16} />
                  {t('subtitleRemover.done')}
                </div>
                <video
                  src={result.videoUrl}
                  controls
                  className="w-full rounded-xl bg-black max-h-[280px]"
                />
                <div className={`flex gap-4 text-xs ${textSecondary}`}>
                  <span>{formatDuration(result.duration)}</span>
                  <span>{formatSize(result.size)}</span>
                </div>
                <button
                  onClick={handleDownload}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isDark ? 'sf-rainbow-btn text-white' : 'lt-btn-primary text-white'
                  }`}
                >
                  <Download size={16} />
                  {t('subtitleRemover.download')}
                </button>
                <button
                  onClick={reset}
                  className={`w-full py-2 text-sm ${textSecondary} hover:underline`}
                >
                  {t('subtitleRemover.processAnother')}
                </button>
              </div>
            )}

            {status === 'error' && (
              <div className="space-y-3">
                <div className={`flex gap-2 text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error || t('subtitleRemover.failed')}</span>
                </div>
                <button
                  onClick={reset}
                  className={`w-full py-2.5 rounded-xl text-sm border ${borderColor} ${textPrimary} hover:opacity-80`}
                >
                  {t('subtitleRemover.retry')}
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
