import React, { useState, useEffect } from 'react';
import { X, HardDrive, Check, Loader2, Image as ImageIcon, Film, FileText, MessageSquare, Globe, Grid3X3, Circle, Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API_URL, isElectron, getServerUrl, setServerUrl, authFetch } from '../../config/api';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { useTheme } from '../../hooks/useTheme';
import { useCanvasBackground, CanvasBgPattern } from '../../hooks/useCanvasBackground';

interface StorageStats {
    libraryDir: string;
    images: { count: number; size: number };
    videos: { count: number; size: number };
    workflows: { count: number; size: number };
    chats: { count: number; size: number };
    totalSize: number;
}

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const languages = [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'zh', name: '中文', flag: '🇨🇳' }
];

const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

const ServerUrlSection: React.FC<{ isDark: boolean }> = ({ isDark }) => {
    const { t } = useTranslation();
    const [url, setUrl] = useState(getServerUrl);
    const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

    const handleTest = async () => {
        if (!url.trim()) return;
        setStatus('testing');
        try {
            const res = await fetch(`${url.replace(/\/+$/, '')}/api/settings`, { signal: AbortSignal.timeout(5000) });
            setStatus(res.ok ? 'ok' : 'fail');
        } catch {
            setStatus('fail');
        }
    };

    const handleSave = () => {
        if (!url.trim()) return;
        setServerUrl(url.trim());
    };

    return (
        <div>
            <h3 className={`text-sm font-medium mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('settings.serverUrl')}</h3>
            <p className={`text-xs mb-3 ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('settings.serverUrlDesc')}</p>
            <div className="flex gap-2 mb-2">
                <div className="relative flex-1">
                    <Globe size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`} />
                    <input
                        type="text"
                        value={url}
                        onChange={(e) => { setUrl(e.target.value); setStatus('idle'); }}
                        placeholder="https://your-server.com"
                        className={`w-full rounded-lg pl-9 pr-3 py-2.5 text-sm font-mono focus:outline-none ${isDark ? 'bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:border-white/30' : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400'}`}
                    />
                </div>
                <button
                    onClick={handleTest}
                    disabled={!url.trim() || status === 'testing'}
                    className={`px-3 py-2.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50 ${isDark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                    {status === 'testing' ? <Loader2 size={14} className="animate-spin" /> : t('settings.testConnection')}
                </button>
            </div>
            <div className="flex items-center gap-3">
                {isDark ? (
                    <HoverBorderGradient as="button" containerClassName="rounded-lg" className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--sf-bg-deep)] text-white disabled:opacity-50 disabled:cursor-not-allowed" duration={2} onClick={handleSave} disabled={!url.trim()}>
                        <Check size={14} />
                        {t('settings.saveAndRestart')}
                    </HoverBorderGradient>
                ) : (
                    <button onClick={handleSave} disabled={!url.trim()} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg lt-btn-primary text-white disabled:opacity-50 disabled:cursor-not-allowed">
                        <Check size={14} />
                        {t('settings.saveAndRestart')}
                    </button>
                )}
                {status === 'ok' && <span className="text-xs text-green-400">{t('settings.connectionOk')}</span>}
                {status === 'fail' && <span className="text-xs text-red-400">{t('settings.connectionFail')}</span>}
            </div>
            <p className={`text-[11px] mt-2 ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>{t('settings.serverUrlHint')}</p>
        </div>
    );
};

const patternOptions: { value: CanvasBgPattern; icon: React.ReactNode; labelKey: string }[] = [
    { value: 'none', icon: <X size={16} />, labelKey: 'settings.bgNone' },
    { value: 'grid', icon: <Grid3X3 size={16} />, labelKey: 'settings.bgGrid' },
    { value: 'dots', icon: <Circle size={16} />, labelKey: 'settings.bgDots' },
    { value: 'dashed', icon: <Minus size={16} />, labelKey: 'settings.bgDashed' },
    { value: 'cross', icon: <Plus size={16} />, labelKey: 'settings.bgCross' },
];

const BgPreview: React.FC<{ pattern: CanvasBgPattern; size: number; opacity: number; isDark: boolean }> = ({ pattern, size, opacity, isDark }) => {
    const color = isDark ? '%23ffffff' : '%23000000';
    const s = size;
    const o = opacity;

    let bgImage = '';
    switch (pattern) {
        case 'grid':
            bgImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'%3E%3Cpath d='M ${s} 0 L 0 0 0 ${s}' fill='none' stroke='${color}' stroke-opacity='${o}' stroke-width='1'/%3E%3C/svg%3E")`;
            break;
        case 'dots':
            bgImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'%3E%3Ccircle cx='${s / 2}' cy='${s / 2}' r='1.2' fill='${color}' fill-opacity='${o}'/%3E%3C/svg%3E")`;
            break;
        case 'dashed': {
            const d = Math.round(s * 0.25);
            bgImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'%3E%3Cpath d='M ${s} 0 L 0 0 0 ${s}' fill='none' stroke='${color}' stroke-opacity='${o}' stroke-width='1' stroke-dasharray='${d} ${d}'/%3E%3C/svg%3E")`;
            break;
        }
        case 'cross': {
            const half = s / 2;
            const arm = 3;
            bgImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'%3E%3Cline x1='${half - arm}' y1='${half}' x2='${half + arm}' y2='${half}' stroke='${color}' stroke-opacity='${o}' stroke-width='1'/%3E%3Cline x1='${half}' y1='${half - arm}' x2='${half}' y2='${half + arm}' stroke='${color}' stroke-opacity='${o}' stroke-width='1'/%3E%3C/svg%3E")`;
            break;
        }
        default:
            break;
    }

    return (
        <div
            className={`w-full h-16 rounded-lg border ${isDark ? 'border-neutral-700 bg-[#050505]' : 'border-gray-200 bg-white'}`}
            style={bgImage ? { backgroundImage: bgImage, backgroundSize: `${s}px ${s}px` } : undefined}
        />
    );
};

const CanvasBackgroundSection: React.FC<{ isDark: boolean }> = ({ isDark }) => {
    const { t } = useTranslation();
    const { pattern, setPattern, bgOpacity, setBgOpacity, bgSize, setBgSize } = useCanvasBackground();

    return (
        <div>
            <h3 className={`text-sm font-medium mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('settings.canvasBackground')}</h3>
            <p className={`text-xs mb-3 ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('settings.canvasBackgroundDesc')}</p>

            {/* Pattern Selector */}
            <div className="flex gap-2 mb-3">
                {patternOptions.map(opt => {
                    const isActive = pattern === opt.value;
                    const content = (
                        <div className="flex items-center gap-1.5">
                            {opt.icon}
                            <span className="text-xs">{t(opt.labelKey)}</span>
                        </div>
                    );
                    if (isDark && isActive) {
                        return (
                            <HoverBorderGradient key={opt.value} as="button" containerClassName="rounded-lg" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--sf-bg-deep)] text-white" duration={2} onClick={() => setPattern(opt.value)}>
                                {content}
                            </HoverBorderGradient>
                        );
                    }
                    return (
                        <button key={opt.value} onClick={() => setPattern(opt.value)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${isActive ? 'lt-btn-primary text-white' : isDark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            {content}
                        </button>
                    );
                })}
            </div>

            {/* Preview */}
            <BgPreview pattern={pattern} size={bgSize} opacity={bgOpacity} isDark={isDark} />

            {/* Sliders */}
            {pattern !== 'none' && (
                <div className="mt-3 space-y-3">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('settings.bgOpacity')}</span>
                            <span className={`text-xs font-mono ${isDark ? 'text-neutral-300' : 'text-gray-700'}`}>{Math.round(bgOpacity * 100)}%</span>
                        </div>
                        <input type="range" min="0.02" max="0.5" step="0.01" value={bgOpacity} onChange={e => setBgOpacity(parseFloat(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{ background: isDark ? 'linear-gradient(to right, #374151, #c084fc)' : 'linear-gradient(to right, #d1d5db, #7c3aed)' }} />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('settings.bgSize')}</span>
                            <span className={`text-xs font-mono ${isDark ? 'text-neutral-300' : 'text-gray-700'}`}>{bgSize}px</span>
                        </div>
                        <input type="range" min="10" max="80" step="2" value={bgSize} onChange={e => setBgSize(parseInt(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{ background: isDark ? 'linear-gradient(to right, #374151, #c084fc)' : 'linear-gradient(to right, #d1d5db, #7c3aed)' }} />
                    </div>
                </div>
            )}
        </div>
    );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const { isDark } = useTheme();
    const { t, i18n } = useTranslation();
    const [stats, setStats] = useState<StorageStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);

        authFetch(`${API_URL}/settings/storage-stats`).then(r => r.json()).then(statsData => {
            setStats(statsData);
        }).catch(err => {
            console.error('[Settings] Failed to load:', err);
        }).finally(() => {
            setLoading(false);
        });
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            className={`fixed inset-0 z-[9999] backdrop-blur-sm flex items-center justify-center p-4 ${isDark ? 'bg-black/80' : 'bg-black/40'}`}
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <HoverBorderGradient containerClassName="rounded-xl w-[560px]" className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`} fillClassName={isDark ? undefined : 'bg-white'} duration={4}>
            <div className="max-h-[80vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-neutral-800' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-white/10 border border-white/20' : 'bg-gradient-to-br from-pink-500 via-purple-500 to-blue-600'}`}>
                            <HardDrive size={18} className="text-white" />
                        </div>
                        <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('settings.title')}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={24} className="animate-spin text-neutral-500" />
                        </div>
                    ) : (
                        <>
                            {/* Language Section */}
                            <div>
                                <h3 className={`text-sm font-medium mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('settings.language')}</h3>
                                <p className={`text-xs mb-3 ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('settings.languageDesc')}</p>
                                <div className="flex gap-2">
                                    {languages.map(lang => {
                                        const isActive = i18n.language === lang.code;
                                        const content = (<><span>{lang.flag}</span><span>{lang.name}</span>{isActive && <Check size={14} />}</>);
                                        if (isDark && isActive) {
                                            return (
                                                <HoverBorderGradient key={lang.code} as="button" containerClassName="rounded-xl" className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-[var(--sf-bg-deep)] text-white" duration={2} onClick={() => i18n.changeLanguage(lang.code)}>
                                                    {content}
                                                </HoverBorderGradient>
                                            );
                                        }
                                        return (
                                            <button key={lang.code} onClick={() => i18n.changeLanguage(lang.code)} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive ? 'lt-btn-primary text-white' : isDark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                                {content}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Canvas Background Section */}
                            <CanvasBackgroundSection isDark={isDark} />

                            {/* Server URL Section — Electron only */}
                            {isElectron && (
                                <ServerUrlSection isDark={isDark} />
                            )}

                            {/* Storage Stats */}
                            {stats && (
                                <div>
                                    <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('settings.storageStats')}</h3>
                                    <div className="grid grid-cols-4 gap-3">
                                        {[
                                            { icon: <ImageIcon size={14} />, label: t('settings.images'), count: stats.images?.count ?? 0, size: stats.images?.size ?? 0 },
                                            { icon: <Film size={14} />, label: t('settings.videos'), count: stats.videos?.count ?? 0, size: stats.videos?.size ?? 0 },
                                            { icon: <FileText size={14} />, label: t('settings.workflows'), count: stats.workflows?.count ?? 0, size: stats.workflows?.size ?? 0 },
                                            { icon: <MessageSquare size={14} />, label: t('settings.chats'), count: stats.chats?.count ?? 0, size: stats.chats?.size ?? 0 },
                                        ].map((item, i) => (
                                            <div key={i} className={`p-3 rounded-xl border ${isDark ? 'bg-neutral-900 border-neutral-800' : 'bg-gray-50 border-gray-200'}`}>
                                                <div className={`flex items-center gap-2 mb-2 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                                                    {item.icon}
                                                    <span className="text-xs">{item.label}</span>
                                                </div>
                                                <p className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{item.count}</p>
                                                <p className={`text-[10px] ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{formatSize(item.size)}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className={`mt-3 p-2 rounded-lg text-center ${isDark ? 'bg-neutral-900/50' : 'bg-gray-50'}`}>
                                        <span className={`text-xs ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('settings.totalSize')}: </span>
                                        <span className={`text-xs font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{formatSize(stats.totalSize ?? 0)}</span>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
            </HoverBorderGradient>
        </div>
    );
};
