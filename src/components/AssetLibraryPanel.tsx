import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Trash2, CheckSquare, Square, Check, Maximize2, Minimize2, Search, Upload, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API_URL, authFetch, ossResize } from '../config/api';
import { useTheme } from '../hooks/useTheme';
import { HoverBorderGradient } from './ui/hover-border-gradient';
import { dataCache, CACHE_KEYS } from '../services/dataCache';

interface LibraryAsset {
    id: string;
    name: string;
    category: string;
    url: string;
    type: 'image' | 'video';
}

interface AssetLibraryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectAsset: (url: string, type: 'image' | 'video') => void;
    panelY?: number;
    variant?: 'panel' | 'modal';
    refreshTrigger?: number;
}

const CATEGORY_KEYS = [
    { key: 'All', i18nKey: 'assetLibrary.all' },
    { key: 'Character', i18nKey: 'assetLibrary.character' },
    { key: 'Scene', i18nKey: 'assetLibrary.scene' },
    { key: 'Item', i18nKey: 'assetLibrary.item' },
    { key: 'Style', i18nKey: 'assetLibrary.style' },
    { key: 'Sound Effect', i18nKey: 'assetLibrary.soundEffect' },
    { key: 'Others', i18nKey: 'assetLibrary.others' }
];

const BROKEN_IMG_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzMzMiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIiByeT0iMiI+PC9yZWN0PjxjaXJjbGUgY3g9IjguNSIgY3k9IjguNSIgcj0iMS41Ij48L2NpcmNsZT48cG9seWxpbmUgcG9pbnRzPSIyMSAxNSAxNiAxMCA1IDIxIj48L3BvbHlsaW5lPjwvc3ZnPg==';

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({
    isOpen,
    onClose,
    onSelectAsset,
    panelY = 100,
    variant = 'panel',
    refreshTrigger = 0
}) => {
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [assets, setAssets] = useState<LibraryAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const cached = dataCache.get<LibraryAsset[]>(CACHE_KEYS.LIBRARY);
            if (cached) {
                setAssets(cached);
                setLoading(false);
                fetchLibrary(true);
            } else {
                fetchLibrary(false);
            }
        }
    }, [isOpen, refreshTrigger]);

    const fetchLibrary = async (background = false) => {
        if (!background) setLoading(true);
        try {
            const res = await authFetch(`${API_URL}/library`);
            if (res.ok) {
                const data = await res.json();
                setAssets(data);
                dataCache.set(CACHE_KEYS.LIBRARY, data);
            }
        } catch (error) {
            console.error("Failed to load library:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAsset = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();

        try {
            const res = await authFetch(`${API_URL}/library/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                setAssets(prev => {
                    const next = prev.filter(a => a.id !== id);
                    dataCache.set(CACHE_KEYS.LIBRARY, next);
                    return next;
                });
            } else {
                console.error("Failed to delete asset");
            }
        } catch (error) {
            console.error("Delete error:", error);
        }
    };

    const handleUploadAsset = useCallback(async (file: File): Promise<boolean> => {
        const MAX_MB = 50;
        if (file.size > MAX_MB * 1024 * 1024) return false;

        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const base64 = reader.result as string;
                    const name = file.name.replace(/\.[^.]+$/, '');
                    const isVideo = file.type.startsWith('video/');
                    const category = 'Others';
                    const res = await authFetch(`${API_URL}/library`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sourceUrl: base64, name, category, meta: {} }),
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.asset) {
                            setAssets(prev => {
                                const next = [data.asset, ...prev];
                                dataCache.set(CACHE_KEYS.LIBRARY, next);
                                return next;
                            });
                        }
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                } catch {
                    resolve(false);
                }
            };
            reader.onerror = () => resolve(false);
            reader.readAsDataURL(file);
        });
    }, []);

    const handleBatchDelete = async (ids: string[]) => {
        let deleted = 0;
        for (const id of ids) {
            try {
                const res = await authFetch(`${API_URL}/library/${id}`, { method: 'DELETE' });
                if (res.ok) deleted++;
            } catch (err) {
                console.error('Batch delete error for', id, err);
            }
        }
        setAssets(prev => prev.filter(a => !ids.includes(a.id)));
        return deleted;
    };

    if (!isOpen) return null;

    if (variant === 'modal') {
        const modalInner = (
            <>
                <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-neutral-800' : 'border-gray-100'}`}>
                    <h2 className={`text-lg font-medium pl-2 ${isDark ? 'text-white' : 'text-neutral-900'}`}>{t('assetLibrary.title')}</h2>
                    <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900'}`}>
                        <X size={20} />
                    </button>
                </div>
                <AssetLibraryContent
                    selectedCategory={selectedCategory}
                    setSelectedCategory={setSelectedCategory}
                    assets={assets}
                    loading={loading}
                    onSelectAsset={onSelectAsset}
                    onDeleteAsset={handleDeleteAsset}
                    onBatchDelete={handleBatchDelete}
                    onUploadAsset={handleUploadAsset}
                    variant={variant}
                    expanded={false}
                />
            </>
        );

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <HoverBorderGradient
                    containerClassName="rounded-xl w-[800px] h-[600px]"
                    className={
                        isDark
                            ? 'rounded-[10px] bg-[var(--sf-bg-panel)] flex flex-col h-full overflow-hidden'
                            : 'rounded-[10px] bg-white flex flex-col h-full overflow-hidden'
                    }
                    fillClassName={isDark ? undefined : 'bg-white'}
                    duration={4}
                >
                    <div
                        className="flex flex-col w-full h-full rounded-xl overflow-hidden transition-colors duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {modalInner}
                    </div>
                </HoverBorderGradient>
                <div className="absolute inset-0 -z-10" onClick={onClose} />
            </div>
        );
    }

    return (
        <HoverBorderGradient
            containerClassName={`fixed backdrop-blur-xl animate-in slide-in-from-left-4 duration-200 ${expanded ? 'z-[60] inset-0' : 'z-40 left-20 rounded-xl'}`}
            className={
                isDark
                    ? `${expanded ? '' : 'rounded-[10px]'} bg-[var(--sf-bg-panel)] flex flex-col overflow-hidden`
                    : `${expanded ? '' : 'rounded-[10px]'} bg-white flex flex-col overflow-hidden`
            }
            fillClassName={isDark ? undefined : 'bg-white'}
            style={{
                top: expanded ? 0 : Math.min(window.innerHeight - 510, Math.max(20, panelY)),
                width: expanded ? '100vw' : '700px',
                height: expanded ? '100vh' : undefined,
                maxHeight: expanded ? '100vh' : '500px',
                transition: expanded ? 'none' : 'all 0.3s ease',
                borderRadius: expanded ? 0 : undefined,
            }}
            duration={4}
        >
            <div
                className={`flex flex-col w-full overflow-hidden ${expanded ? '' : 'rounded-xl'}`}
                style={{
                    maxHeight: expanded ? '100vh' : '500px',
                    height: expanded ? '100vh' : undefined,
                }}
            >
                <AssetLibraryContent
                    selectedCategory={selectedCategory}
                    setSelectedCategory={setSelectedCategory}
                    assets={assets}
                    loading={loading}
                    onSelectAsset={onSelectAsset}
                    onDeleteAsset={handleDeleteAsset}
                    onBatchDelete={handleBatchDelete}
                    onUploadAsset={handleUploadAsset}
                    variant={variant}
                    expanded={expanded}
                />
            </div>
        </HoverBorderGradient>
    );
};

// Extracted Internal Component for reuse
const AssetLibraryContent = ({
    selectedCategory, setSelectedCategory,
    assets, loading, onSelectAsset, onDeleteAsset, onBatchDelete, onUploadAsset, variant, expanded = false
}: any) => {
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [batchDeleting, setBatchDeleting] = useState(false);
    const [batchConfirm, setBatchConfirm] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const searchLower = searchQuery.toLowerCase().trim();
    const filteredAssets = assets.filter((asset: any) => {
        const matchesCategory = selectedCategory === 'All' || asset.category === selectedCategory;
        const matchesSearch = !searchLower || (asset.name || '').toLowerCase().includes(searchLower) || (asset.category || '').toLowerCase().includes(searchLower);
        return matchesCategory && matchesSearch;
    });

    const filteredIds = new Set(filteredAssets.map((a: any) => a.id));
    const selectedInView = [...selectedIds].filter(id => filteredIds.has(id));
    const allSelected = filteredAssets.length > 0 && filteredAssets.every((a: any) => selectedIds.has(a.id));

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (allSelected) {
            setSelectedIds(prev => {
                const next = new Set(prev);
                filteredAssets.forEach((a: any) => next.delete(a.id));
                return next;
            });
        } else {
            setSelectedIds(prev => {
                const next = new Set(prev);
                filteredAssets.forEach((a: any) => next.add(a.id));
                return next;
            });
        }
    };

    const exitSelectMode = () => {
        setSelectMode(false);
        setSelectedIds(new Set());
        setBatchConfirm(false);
    };

    const handleBatchDeleteConfirm = async () => {
        if (selectedInView.length === 0) return;
        setBatchDeleting(true);
        try {
            await onBatchDelete(selectedInView);
            setSelectedIds(prev => {
                const next = new Set(prev);
                selectedInView.forEach(id => next.delete(id));
                return next;
            });
            setBatchConfirm(false);
            if (selectedIds.size === selectedInView.length) {
                exitSelectMode();
            }
        } finally {
            setBatchDeleting(false);
        }
    };

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDeleteConfirmId(id);
    };

    const handleConfirmDelete = (e: React.MouseEvent, id: string) => {
        onDeleteAsset(id, e);
        setDeleteConfirmId(null);
    };

    const handleCancelDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        setDeleteConfirmId(null);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onUploadAsset) return;
        e.target.value = '';

        const MAX_MB = 50;
        if (file.size > MAX_MB * 1024 * 1024) {
            alert(t('assetLibrary.fileTooLarge', { max: MAX_MB }));
            return;
        }

        setUploading(true);
        try {
            const ok = await onUploadAsset(file);
            if (!ok) alert(t('assetLibrary.uploadFailed'));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="p-4 flex flex-col gap-4 h-full overflow-hidden">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
            />

            {/* Filters + Actions row */}
            <div className="flex items-center gap-2 shrink-0">
                <div className="flex gap-2 overflow-x-auto scrollbar-hide flex-1">
                    {CATEGORY_KEYS.map(cat => (
                        <button
                            key={cat.key}
                            onClick={() => setSelectedCategory(cat.key)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${selectedCategory === cat.key
                                ? isDark ? 'bg-neutral-100 text-black border-white' : 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white border-white/30'
                                : isDark ? 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:border-neutral-600' : 'bg-white text-gray-500 border-gray-200 hover:border-white/40 hover:sf-rainbow-text'
                                }`}
                        >
                            {t(cat.i18nKey)}
                        </button>
                    ))}
                </div>

                {/* Upload button */}
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className={`p-1 rounded transition-colors shrink-0 ${uploading ? 'opacity-50 cursor-not-allowed' : ''} ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
                    title={uploading ? t('assetLibrary.uploading') : t('assetLibrary.upload')}
                >
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                </button>

                {/* Select mode toggle */}
                {filteredAssets.length > 0 && (
                    <button
                        onClick={() => { if (selectMode) { exitSelectMode(); } else { setSelectMode(true); } }}
                        className={`p-1 rounded transition-colors shrink-0 ${selectMode ? (isDark ? 'text-white bg-neutral-700' : 'text-gray-900 bg-gray-200') : isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
                        title={selectMode ? t('common.cancel') : t('assetLibrary.batchSelect')}
                    >
                        <CheckSquare size={18} />
                    </button>
                )}
            </div>

            {/* Search bar */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg shrink-0 ${isDark ? 'bg-neutral-800/80' : 'bg-gray-100'}`}>
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

            {/* Batch action bar */}
            {selectMode && (() => {
                const dangerBtn = isDark
                    ? 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all bg-rose-500/[0.12] hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/25 hover:border-rose-400/50 disabled:bg-white/[0.04] disabled:text-white/25 disabled:border-white/10 disabled:cursor-not-allowed'
                    : 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 border border-rose-200/80 hover:border-rose-300 shadow-sm shadow-rose-500/5 disabled:bg-gray-50 disabled:text-gray-400 disabled:border-gray-200 disabled:shadow-none disabled:cursor-not-allowed';
                const ghostBtn = `inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isDark ? 'text-neutral-400 hover:text-white hover:bg-white/[0.06]' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`;
                return (
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg shrink-0 ${isDark ? 'bg-neutral-800/80' : 'bg-neutral-100'}`}>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleSelectAll}
                            className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${isDark ? 'text-neutral-300 hover:text-white' : 'text-neutral-600 hover:text-neutral-900'}`}
                        >
                            {allSelected
                                ? <CheckSquare size={14} className="text-purple-500" />
                                : <Square size={14} />
                            }
                            {allSelected ? t('assetLibrary.deselectAll') : t('assetLibrary.selectAll')}
                        </button>
                        <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                            {t('assetLibrary.selectedCount', { count: selectedInView.length })}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {batchConfirm ? (
                            <>
                                <span className={`text-xs font-medium ${isDark ? 'text-rose-400' : 'text-rose-500'}`}>{t('assetLibrary.confirmBatchDelete', { count: selectedInView.length })}</span>
                                <button
                                    onClick={handleBatchDeleteConfirm}
                                    disabled={batchDeleting}
                                    className={dangerBtn}
                                >
                                    {batchDeleting ? t('common.deleting') : t('assetLibrary.yes')}
                                </button>
                                <button
                                    onClick={() => setBatchConfirm(false)}
                                    className={ghostBtn}
                                >
                                    {t('assetLibrary.no')}
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => setBatchConfirm(true)}
                                    disabled={selectedInView.length === 0}
                                    className={dangerBtn}
                                >
                                    <Trash2 size={12} />
                                    {t('assetLibrary.batchDelete')} ({selectedInView.length})
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
                className={`flex-1 overflow-y-auto pr-2 grid gap-3 pb-4 content-start ${expanded ? 'grid-cols-6' : 'grid-cols-4'}`}
                style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa'
                }}
            >
                {loading ? (
                    <div className="col-span-full text-center py-10 text-neutral-500">{t('common.loading')}</div>
                ) : filteredAssets.length === 0 ? (
                    <div className="col-span-full text-center py-10 text-neutral-500 text-sm">
                        {searchLower ? t('common.noSearchResults') : t('assetLibrary.noAssetsInCategory')}
                    </div>
                ) : (
                    filteredAssets.map((asset: any) => {
                        const isSelected = selectedIds.has(asset.id);
                        return (
                            <div
                                key={asset.id}
                                className={`group relative aspect-[4/3] rounded-xl overflow-hidden border cursor-pointer transition-all duration-300 ${
                                    selectMode && isSelected
                                        ? isDark
                                            ? 'bg-neutral-900 border-purple-400/60 shadow-[0_0_25px_rgba(192,132,252,0.25)] scale-[1.02]'
                                            : 'bg-gray-100 lt-card-selected scale-[1.02]'
                                        : isDark
                                            ? 'bg-neutral-900 border-neutral-800 hover:border-neutral-600'
                                            : 'bg-gray-100 border-gray-200 hover:border-gray-300'
                                }`}
                                onClick={() => {
                                    if (selectMode) {
                                        toggleSelect(asset.id);
                                    } else {
                                        onSelectAsset(asset.url, asset.type);
                                    }
                                }}
                            >
                                <img
                                    src={ossResize(asset.url, 300)}
                                    alt={asset.name}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.onerror = null;
                                        target.src = BROKEN_IMG_PLACEHOLDER;
                                        target.classList.add('p-8', 'opacity-50');
                                    }}
                                />

                                {/* Selected ring overlay */}
                                {selectMode && isSelected && (
                                    <div className="absolute inset-0 rounded-xl pointer-events-none ring-2 ring-purple-400/80 ring-inset z-20" />
                                )}

                                {/* Selection checkbox overlay */}
                                {selectMode && (
                                    <div className={`absolute top-1.5 left-1.5 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 ${
                                        isSelected
                                            ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-md shadow-purple-500/40 scale-100 opacity-100'
                                            : 'bg-black/40 backdrop-blur-sm scale-90 opacity-70 group-hover:opacity-100 group-hover:scale-100 border border-white/20'
                                    }`}>
                                        <Check size={12} className={`text-white transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
                                    </div>
                                )}

                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 pt-6 pointer-events-none">
                                    <span className="text-white text-xs font-medium truncate block">{asset.name}</span>
                                </div>

                                {/* Single delete — only in normal mode */}
                                {!selectMode && (
                                    deleteConfirmId === asset.id ? (
                                        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2 z-20 animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                                            <span className="text-white text-xs font-medium">{t('assetLibrary.confirmDelete')}</span>
                                            <div className="flex gap-2">
                                                <button
                                                    className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-colors"
                                                    onClick={(e) => handleConfirmDelete(e, asset.id)}
                                                >
                                                    {t('assetLibrary.yes')}
                                                </button>
                                                <button
                                                    className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-white text-xs rounded transition-colors"
                                                    onClick={handleCancelDelete}
                                                >
                                                    {t('assetLibrary.no')}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 z-10"
                                            onClick={(e) => handleDeleteClick(e, asset.id)}
                                            title={t('assetLibrary.deleteAsset')}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
