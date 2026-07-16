/**
 * HistoryPanel.tsx
 * 
 * Panel for browsing generated image and video history.
 * Assets are grouped by date and displayed in a grid.
 * Clicking an asset applies it to the selected node.
 * 
 * Uses infinite scroll with pagination for performance.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Trash2, Maximize2, Minimize2, Image as ImageIcon, Video, Download, X, Columns, Check, CheckSquare, Square, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API_URL, API_BASE_URL, authFetch, assetUrl, ossResize, ossVideoPoster } from '../config/api';
import { useTheme } from '../hooks/useTheme';
import { HoverBorderGradient } from './ui/hover-border-gradient';
import { dataCache, CACHE_KEYS } from '../services/dataCache';

// ============================================================================
// CONSTANTS
// ============================================================================

const PAGE_SIZE = 18; // 6 columns × 3 rows

// ============================================================================
// TYPES
// ============================================================================

interface AssetMetadata {
    id: string;
    filename: string;
    prompt: string;
    createdAt: string;
    type: string;
    url: string;
    model?: string;
}

interface HistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectAsset: (type: 'images' | 'videos', url: string, prompt: string, model?: string) => void;
    panelY?: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
    isOpen,
    onClose,
    onSelectAsset,
    panelY = 200,
}) => {
    const { t } = useTranslation();
    const { isDark } = useTheme();
    // --- State ---
    const [activeTab, setActiveTab] = useState<'images' | 'videos'>('images');
    const [assets, setAssets] = useState<AssetMetadata[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [imageTotalCount, setImageTotalCount] = useState<number>(0);
    const [videoTotalCount, setVideoTotalCount] = useState<number>(0);
    const [expanded, setExpanded] = useState(false);
    const [compareMode, setCompareMode] = useState(false);
    const [compareSelection, setCompareSelection] = useState<AssetMetadata[]>([]);
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [batchDeleting, setBatchDeleting] = useState(false);
    const [batchConfirm, setBatchConfirm] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // --- Refs ---
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

    useEffect(() => { if (!isOpen) setExpanded(false); }, [isOpen]);

    // --- Fetch initial page and counts when panel opens ---
    useEffect(() => {
        if (isOpen) {
            const cacheKey = activeTab === 'images' ? CACHE_KEYS.HISTORY_IMAGES : CACHE_KEYS.HISTORY_VIDEOS;
            const cachedPage = dataCache.get<{ assets: AssetMetadata[]; hasMore: boolean; total: number }>(cacheKey);
            const cachedCounts = dataCache.get<{ images: number; videos: number }>(CACHE_KEYS.HISTORY_COUNTS);

            if (cachedPage) {
                setAssets(cachedPage.assets);
                setHasMore(cachedPage.hasMore);
                setOffset(cachedPage.assets.length);
                if (activeTab === 'images') setImageTotalCount(cachedPage.total);
                else setVideoTotalCount(cachedPage.total);
                setLoading(false);
                fetchAssets(0, true, true);
            } else {
                setAssets([]);
                setOffset(0);
                setHasMore(true);
                fetchAssets(0, true, false);
            }

            if (cachedCounts) {
                setImageTotalCount(cachedCounts.images);
                setVideoTotalCount(cachedCounts.videos);
            }
            fetchCounts(true);
        }
    }, [isOpen, activeTab]);

    /**
     * Fetch total counts for both images and videos
     */
    const fetchCounts = async (background = false) => {
        try {
            const [imgRes, vidRes] = await Promise.all([
                authFetch(`${API_URL}/assets/images?limit=1`),
                authFetch(`${API_URL}/assets/videos?limit=1`)
            ]);

            const counts: { images: number; videos: number } = { images: 0, videos: 0 };

            if (imgRes.ok) {
                const imgData = await imgRes.json();
                counts.images = imgData.total;
                setImageTotalCount(imgData.total);
            }

            if (vidRes.ok) {
                const vidData = await vidRes.json();
                counts.videos = vidData.total;
                setVideoTotalCount(vidData.total);
            }

            dataCache.set(CACHE_KEYS.HISTORY_COUNTS, counts);
        } catch (error) {
            console.error('Failed to fetch asset counts:', error);
        }
    };

    // --- Intersection Observer for infinite scroll ---
    useEffect(() => {
        if (!loadMoreTriggerRef.current || loading) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const target = entries[0];
                if (target.isIntersecting && hasMore && !loadingMore && !loading) {
                    loadMoreAssets();
                }
            },
            { threshold: 0.1, root: scrollContainerRef.current }
        );

        observer.observe(loadMoreTriggerRef.current);
        return () => observer.disconnect();
    }, [hasMore, loadingMore, loading, offset]);

    const fetchAssets = async (pageOffset: number, isInitial: boolean = false, background = false) => {
        if (!background) {
            if (isInitial) setLoading(true);
            else setLoadingMore(true);
        }

        try {
            const response = await authFetch(
                `${API_URL}/assets/${activeTab}?limit=${PAGE_SIZE}&offset=${pageOffset}`
            );
            if (response.ok) {
                const data = await response.json();

                if (isInitial) {
                    setAssets(data.assets);
                    const cacheKey = activeTab === 'images' ? CACHE_KEYS.HISTORY_IMAGES : CACHE_KEYS.HISTORY_VIDEOS;
                    dataCache.set(cacheKey, data);
                } else {
                    setAssets(prev => [...prev, ...data.assets]);
                }

                setHasMore(data.hasMore);
                setOffset(pageOffset + data.assets.length);

                if (activeTab === 'images') {
                    setImageTotalCount(data.total);
                } else {
                    setVideoTotalCount(data.total);
                }
            }
        } catch (error) {
            console.error('Failed to fetch assets:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    /**
     * Load more assets when scrolling
     */
    const loadMoreAssets = useCallback(() => {
        if (!loadingMore && hasMore) {
            fetchAssets(offset, false);
        }
    }, [offset, loadingMore, hasMore, activeTab]);

    const handleDelete = async (id: string) => {
        try {
            const response = await authFetch(`${API_URL}/assets/${activeTab}/${id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                setAssets(prev => prev.filter(a => a.id !== id));
                // Update counts
                if (activeTab === 'images') {
                    setImageTotalCount(prev => prev - 1);
                } else {
                    setVideoTotalCount(prev => prev - 1);
                }
            }
        } catch (error) {
            console.error('Failed to delete asset:', error);
        }
        setDeleteConfirm(null);
    };

    const handleDownload = async (asset: AssetMetadata, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const fullUrl = assetUrl(asset.url);
            const response = await fetch(fullUrl);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = asset.filename || `${asset.id}.${activeTab === 'images' ? 'png' : 'mp4'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error('Download failed:', error);
        }
    };

    const handleSelectAsset = (asset: AssetMetadata) => {
        onSelectAsset(activeTab, assetUrl(asset.url), asset.prompt || '', asset.model);
    };

    const allSelected = assets.length > 0 && assets.every(a => selectedIds.has(a.id));

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (allSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(assets.map(a => a.id)));
        }
    };

    const exitSelectMode = () => {
        setSelectMode(false);
        setSelectedIds(new Set());
        setBatchConfirm(false);
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        setBatchDeleting(true);
        try {
            const ids = [...selectedIds];
            for (const id of ids) {
                try {
                    const res = await authFetch(`${API_URL}/assets/${activeTab}/${id}`, { method: 'DELETE' });
                    if (res.ok) {
                        setAssets(prev => prev.filter(a => a.id !== id));
                        if (activeTab === 'images') setImageTotalCount(prev => prev - 1);
                        else setVideoTotalCount(prev => prev - 1);
                    }
                } catch (err) {
                    console.error('Batch delete error for', id, err);
                }
            }
            exitSelectMode();
        } finally {
            setBatchDeleting(false);
        }
    };

    const searchLower = searchQuery.toLowerCase().trim();
    const filteredAssets = searchLower
        ? assets.filter(a => (a.prompt || '').toLowerCase().includes(searchLower) || (a.model || '').toLowerCase().includes(searchLower) || (a.filename || '').toLowerCase().includes(searchLower))
        : assets;

    const groupedAssets = filteredAssets.reduce((groups, asset) => {
        const date = new Date(asset.createdAt).toLocaleDateString('en-CA'); // YYYY-MM-DD format
        if (!groups[date]) {
            groups[date] = [];
        }
        groups[date].push(asset);
        return groups;
    }, {} as Record<string, AssetMetadata[]>);

    const sortedDates = Object.keys(groupedAssets).sort((a, b) =>
        new Date(b).getTime() - new Date(a).getTime()
    );

    if (!isOpen) return null;

    return (
        <>
            {/* Main Panel */}
            <HoverBorderGradient
                containerClassName={`fixed ${expanded ? 'z-[60] inset-0' : 'z-40 left-20 rounded-xl'}`}
                className={`${expanded ? '' : 'rounded-[10px]'} ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
                fillClassName={isDark ? undefined : 'bg-white'}
                duration={4}
                style={{
                    top: expanded ? 0 : panelY,
                    width: expanded ? '100vw' : '700px',
                    height: expanded ? '100vh' : undefined,
                    maxHeight: expanded ? '100vh' : '500px',
                    transition: expanded ? 'none' : 'all 0.3s ease',
                    borderRadius: expanded ? 0 : undefined,
                }}
            >
                <div
                    className={`backdrop-blur-xl w-full min-h-0 flex flex-col overflow-hidden ${expanded ? '' : 'rounded-[10px]'} ${isDark ? '' : 'lt-panel'}`}
                    style={{
                        maxHeight: expanded ? '100vh' : '500px',
                        height: expanded ? '100vh' : undefined,
                    }}
                >
                {/* Header */}
                <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[var(--sf-border)]' : 'border-gray-100'}`}>
                    <div className="flex items-center gap-6">
                        <button
                            className={`text-sm font-medium transition-colors pb-1 flex items-center gap-2 ${activeTab === 'images'
                                ? isDark ? 'text-white border-b-2 border-white' : 'sf-rainbow-text border-b-2 border-white/30'
                                : isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:sf-rainbow-text'
                                }`}
                            onClick={() => setActiveTab('images')}
                        >
                            <ImageIcon size={16} />
                            {t('historyPanel.imageHistory')} ({imageTotalCount})
                        </button>
                        <button
                            className={`text-sm font-medium transition-colors pb-1 flex items-center gap-2 ${activeTab === 'videos'
                                ? isDark ? 'text-white border-b-2 border-white' : 'sf-rainbow-text border-b-2 border-white/30'
                                : isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:sf-rainbow-text'
                                }`}
                            onClick={() => setActiveTab('videos')}
                        >
                            <Video size={16} />
                            {t('historyPanel.videoHistory')} ({videoTotalCount})
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { if (selectMode) { exitSelectMode(); } else { setSelectMode(true); setCompareMode(false); setCompareSelection([]); } }}
                            className={`p-1 rounded transition-colors ${selectMode ? (isDark ? 'text-white bg-neutral-700' : 'text-gray-900 bg-gray-200') : isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
                            title={selectMode ? t('common.cancel') : t('historyPanel.batchSelect')}
                        >
                            <CheckSquare size={18} />
                        </button>
                        <button
                            onClick={() => {
                                setCompareMode(m => !m);
                                setCompareSelection([]);
                                setSelectMode(false); setSelectedIds(new Set());
                            }}
                            className={`p-1 rounded transition-colors ${compareMode
                                ? 'text-white bg-violet-600'
                                : isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'
                            }`}
                            title={t('historyPanel.compareMode')}
                        >
                            <Columns size={18} />
                        </button>
                        <button
                            onClick={() => setExpanded(e => !e)}
                            className={`transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
                            title={expanded ? 'Minimize' : 'Maximize'}
                        >
                            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                        </button>
                        <button
                            onClick={onClose}
                            className={`transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Search bar */}
                <div className={`px-4 py-2.5 border-b ${isDark ? 'border-[var(--sf-border)]' : 'border-gray-100'}`}>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isDark ? 'bg-neutral-800/80' : 'bg-gray-100'}`}>
                        <Search size={14} className={isDark ? 'text-neutral-500' : 'text-gray-400'} />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder={t('common.searchPlaceholder')}
                            className={`flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-500 ${isDark ? 'text-white' : 'text-gray-700'}`}
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className={`transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}>
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Batch action bar */}
                {selectMode && (() => {
                    const dangerBtn = isDark
                        ? 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all bg-rose-500/[0.12] hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/25 hover:border-rose-400/50 disabled:bg-white/[0.04] disabled:text-white/25 disabled:border-white/10 disabled:cursor-not-allowed'
                        : 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 border border-rose-200/80 hover:border-rose-300 shadow-sm shadow-rose-500/5 disabled:bg-gray-50 disabled:text-gray-400 disabled:border-gray-200 disabled:shadow-none disabled:cursor-not-allowed';
                    const ghostBtn = `inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isDark ? 'text-neutral-400 hover:text-white hover:bg-white/[0.06]' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`;
                    return (
                    <div className={`flex items-center justify-between px-5 py-2.5 border-b ${isDark ? 'border-[var(--sf-border)] bg-neutral-900/80' : 'border-gray-100 bg-gray-50'}`}>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={toggleSelectAll}
                                className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${isDark ? 'text-neutral-300 hover:text-white' : 'text-neutral-600 hover:text-neutral-900'}`}
                            >
                                {allSelected ? <CheckSquare size={14} className="text-purple-500" /> : <Square size={14} />}
                                {allSelected ? t('historyPanel.deselectAll') : t('historyPanel.selectAll')}
                            </button>
                            <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                {t('historyPanel.selectedCount', { count: selectedIds.size })}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {batchConfirm ? (
                                <>
                                    <span className={`text-xs font-medium ${isDark ? 'text-rose-400' : 'text-rose-500'}`}>{t('historyPanel.confirmBatchDelete', { count: selectedIds.size })}</span>
                                    <button
                                        onClick={handleBatchDelete}
                                        disabled={batchDeleting}
                                        className={dangerBtn}
                                    >
                                        {batchDeleting ? <Loader2 size={12} className="animate-spin" /> : t('common.delete')}
                                    </button>
                                    <button
                                        onClick={() => setBatchConfirm(false)}
                                        className={ghostBtn}
                                    >
                                        {t('common.cancel')}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setBatchConfirm(true)}
                                        disabled={selectedIds.size === 0}
                                        className={dangerBtn}
                                    >
                                        <Trash2 size={12} />
                                        {t('historyPanel.batchDelete')} ({selectedIds.size})
                                    </button>
                                    <button
                                        onClick={exitSelectMode}
                                        className={ghostBtn}
                                    >
                                        {t('common.cancel')}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    );
                })()}

                {/* Content */}
                <div
                    ref={scrollContainerRef}
                    className={`flex-1 overflow-y-auto ${expanded ? 'p-8' : 'p-4'}`}
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa'
                    }}
                >
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="animate-spin text-neutral-500" size={24} />
                        </div>
                    ) : filteredAssets.length === 0 ? (
                        <div className={`flex flex-col items-center justify-center h-40 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                            {searchLower ? (
                                <p>{t('common.noSearchResults')}</p>
                            ) : (
                                <>
                                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-3 ${isDark ? 'bg-neutral-800' : 'bg-neutral-100'}`}>
                                        {activeTab === 'images' ? <ImageIcon size={24} /> : <Video size={24} />}
                                    </div>
                                    <p>{activeTab === 'images' ? t('historyPanel.noImagesFound') : t('historyPanel.noVideosFound')}</p>
                                    <p className="text-xs mt-1">{activeTab === 'images' ? t('historyPanel.generatedImagesWillAppear') : t('historyPanel.generatedVideosWillAppear')}</p>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {sortedDates.map(date => (
                                <div key={date}>
                                    <h3 className={`text-sm mb-3 ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>{new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</h3>
                                    <div className={`grid ${expanded ? 'grid-cols-6 gap-4' : 'grid-cols-4 gap-3'}`}>
                                        {groupedAssets[date].map(asset => {
                                            const isInCompare = compareSelection.some(a => a.id === asset.id);
                                            const isSelected = selectedIds.has(asset.id);
                                            return (
                                            <div
                                                key={asset.id}
                                                onClick={() => {
                                                    if (selectMode) {
                                                        toggleSelect(asset.id);
                                                    } else if (compareMode) {
                                                        setCompareSelection(prev => {
                                                            if (isInCompare) return prev.filter(a => a.id !== asset.id);
                                                            if (prev.length >= 4) return prev;
                                                            return [...prev, asset];
                                                        });
                                                    } else {
                                                        handleSelectAsset(asset);
                                                    }
                                                }}
                                                className={`aspect-[4/3] rounded-xl overflow-hidden cursor-pointer transition-all duration-300 group relative ${
                                                    selectMode && isSelected
                                                        ? isDark
                                                            ? 'shadow-[0_0_25px_rgba(192,132,252,0.25)] scale-[1.02]'
                                                            : 'lt-card-selected scale-[1.02]'
                                                        : isInCompare ? 'ring-2 ring-violet-500' : ''
                                                } ${isDark ? 'bg-neutral-900 border border-neutral-800' : 'bg-gray-50 border border-gray-100'}`}
                                            >
                                                {selectMode && isSelected && (
                                                    <div className="absolute inset-0 rounded-xl pointer-events-none ring-2 ring-purple-400/80 ring-inset z-20" />
                                                )}
                                                {selectMode && (
                                                    <div className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 ${
                                                        isSelected
                                                            ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-md shadow-purple-500/40 scale-100 opacity-100'
                                                            : 'bg-black/40 backdrop-blur-sm scale-90 opacity-70 group-hover:opacity-100 group-hover:scale-100 border border-white/20'
                                                    }`}>
                                                        <Check size={12} className={`text-white transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
                                                    </div>
                                                )}
                                                {activeTab === 'images' ? (
                                                    <img
                                                        src={ossResize(assetUrl(asset.url), 300)}
                                                        alt=""
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <video
                                                        src={assetUrl(asset.url)}
                                                        poster={ossVideoPoster(assetUrl(asset.url), 300) || undefined}
                                                        className="w-full h-full object-cover"
                                                        muted
                                                        preload="metadata"
                                                        onMouseEnter={(e) => e.currentTarget.play()}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.pause();
                                                            e.currentTarget.currentTime = 0;
                                                        }}
                                                    />
                                                )}
                                                {!selectMode && compareMode && isInCompare && (
                                                    <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center z-10">
                                                        <Check size={14} className="text-white" />
                                                    </div>
                                                )}
                                                {!selectMode && (
                                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                        <button
                                                            onClick={(e) => handleDownload(asset, e)}
                                                            className="p-1.5 rounded-lg transition-colors bg-gradient-to-r from-black/50 via-black/50 to-black/50 hover:from-pink-500 hover:via-purple-500 hover:to-blue-500"
                                                            title={t('common.saveToComputer')}
                                                        >
                                                            <Download size={14} className="text-white" />
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setDeleteConfirm(asset.id);
                                                            }}
                                                            className="p-1.5 bg-black/50 hover:bg-red-500 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 size={14} className="text-white" />
                                                        </button>
                                                    </div>
                                                )}
                                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 pt-6 pointer-events-none">
                                                    <p className="text-white text-xs truncate">{asset.prompt || asset.model || ''}</p>
                                                </div>
                                            </div>
                                        );})}
                                    </div>
                                </div>
                            ))}

                            {/* Load more trigger for infinite scroll */}
                            {hasMore && (
                                <div
                                    ref={loadMoreTriggerRef}
                                    className="flex items-center justify-center py-4"
                                >
                                    {loadingMore && (
                                        <Loader2 className="animate-spin text-neutral-500" size={20} />
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Compare bar - fixed at bottom of panel */}
                {compareMode && compareSelection.length > 0 && (
                    <div className={`shrink-0 px-4 py-3 border-t flex items-center justify-between ${isDark ? 'border-[var(--sf-border)] bg-neutral-900/80' : 'border-gray-100 bg-gray-50'}`}>
                        <span className={`text-sm ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                            {t('historyPanel.selectedForCompare', { count: compareSelection.length })}
                        </span>
                        <div className="flex gap-2">
                            <button onClick={() => setCompareSelection([])} className={`text-xs px-3 py-1.5 rounded-lg transition ${isDark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>
                                {t('common.cancel')}
                            </button>
                        </div>
                    </div>
                )}

                {/* Compare side-by-side view - fixed at bottom of panel */}
                {compareMode && compareSelection.length >= 2 && (
                    <div className={`shrink-0 px-4 py-3 border-t ${isDark ? 'border-[var(--sf-border)]' : 'border-gray-100'}`}>
                        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(compareSelection.length, 4)}, 1fr)` }}>
                            {compareSelection.map(asset => (
                                <div key={asset.id} className="flex flex-col items-center gap-1">
                                    <div className={`aspect-square w-full rounded-lg overflow-hidden ${isDark ? 'bg-neutral-800' : 'bg-gray-100'}`}>
                                        {activeTab === 'images' ? (
                                            <img src={ossResize(assetUrl(asset.url), 200)} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <video src={assetUrl(asset.url)} poster={ossVideoPoster(assetUrl(asset.url), 200) || undefined} className="w-full h-full object-cover" muted controls />
                                        )}
                                    </div>
                                    <span className={`text-[10px] truncate w-full text-center ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                                        {asset.prompt?.slice(0, 40) || asset.model || 'N/A'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                </div>
            </HoverBorderGradient>

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className={`fixed inset-0 ${isDark ? 'bg-black/80' : 'bg-black/40'} backdrop-blur-sm flex items-center justify-center z-50`}>
                    <HoverBorderGradient
                        containerClassName="rounded-xl w-[340px]"
                        className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
                        fillClassName={isDark ? undefined : 'bg-white'}
                        duration={4}
                    >
                    <div className={`p-6 rounded-[10px] ${isDark ? '' : 'lt-panel-solid'}`}>
                        <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-800'}`}>{t('historyPanel.deleteAsset')}</h3>
                        <p className={`text-sm mb-6 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                            {activeTab === 'images' ? t('historyPanel.deleteImageConfirm') : t('historyPanel.deleteVideoConfirm')}
                        </p>
                        <div className="flex gap-3 justify-end">
                            {isDark ? (
                                <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="px-4 py-2 rounded-lg text-sm transition-colors bg-neutral-800 hover:bg-neutral-700 text-white"
                                >
                                    {t('common.cancel')}
                                </button>
                            ) : (
                                <HoverBorderGradient
                                    as="button"
                                    containerClassName="rounded-lg"
                                    className="rounded-[10px] bg-white px-4 py-2 text-sm transition-colors lt-btn"
                                    fillClassName="bg-white"
                                    duration={4}
                                    onClick={() => setDeleteConfirm(null)}
                                >
                                    {t('common.cancel')}
                                </HoverBorderGradient>
                            )}
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors"
                            >
                                {t('common.delete')}
                            </button>
                        </div>
                    </div>
                    </HoverBorderGradient>
                </div>
            )}
        </>
    );
};
