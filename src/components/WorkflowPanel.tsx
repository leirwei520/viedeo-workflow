/**
 * WorkflowPanel.tsx
 * 
 * Panel for browsing and managing saved workflows.
 * Shows list of workflows with options to load, delete, or edit cover.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Trash2, FileText, Loader2, Maximize2, Minimize2, Pencil, Check, CheckSquare, Square, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LazyImage } from './LazyImage';
import { HoverBorderGradient } from './ui/hover-border-gradient';
import { API_URL, API_BASE_URL, authFetch, assetUrl as resolveAssetUrl, ossThumb, ossResize } from '../config/api';
import { useTheme } from '../hooks/useTheme';
import { dataCache, CACHE_KEYS } from '../services/dataCache';

interface WorkflowSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodeCount: number;
    coverUrl?: string;
    description?: string;
    nodeTypes?: Record<string, number>;
}

interface AssetMetadata {
    id: string;
    url: string;
    prompt?: string;
    createdAt: string;
}

interface WorkflowPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onLoadWorkflow: (workflowId: string) => void;
    onTitleChange?: (workflowId: string, newTitle: string) => void;
    currentWorkflowId?: string;
    panelY?: number;
}

export const WorkflowPanel: React.FC<WorkflowPanelProps> = ({
    isOpen,
    onClose,
    onLoadWorkflow,
    onTitleChange,
    currentWorkflowId,
    panelY = 200,
}) => {
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
    const [publicWorkflows, setPublicWorkflows] = useState<WorkflowSummary[]>([]);
    const [activeTab, setActiveTab] = useState<'my' | 'public' | 'templates'>('my');
    const [searchQuery, setSearchQuery] = useState('');

    const WORKFLOW_TEMPLATES = [
        { id: 'tpl-product-ad', name: t('workflowPanel.tplProductAd'), desc: t('workflowPanel.tplProductAdDesc'), icon: '🎬', nodes: { Image: 3, Video: 1, Text: 1 } },
        { id: 'tpl-short-video', name: t('workflowPanel.tplShortVideo'), desc: t('workflowPanel.tplShortVideoDesc'), icon: '📱', nodes: { Text: 1, Image: 2, Video: 3 } },
        { id: 'tpl-social-cover', name: t('workflowPanel.tplSocialCover'), desc: t('workflowPanel.tplSocialCoverDesc'), icon: '🖼️', nodes: { Image: 4, Text: 1 } },
        { id: 'tpl-storyboard', name: t('workflowPanel.tplStoryboard'), desc: t('workflowPanel.tplStoryboardDesc'), icon: '📖', nodes: { Text: 1, Image: 6, Video: 6 } },
        { id: 'tpl-brand-kit', name: t('workflowPanel.tplBrandKit'), desc: t('workflowPanel.tplBrandKitDesc'), icon: '🎨', nodes: { Image: 5, Text: 2 } },
    ];
    const [loading, setLoading] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [batchDeleting, setBatchDeleting] = useState(false);
    const [batchConfirm, setBatchConfirm] = useState(false);

    // Workflow editing state (name + cover)
    const [editingWorkflow, setEditingWorkflow] = useState<{ id: string; title: string } | null>(null);
    const [editingTitle, setEditingTitle] = useState('');
    const [savingTitle, setSavingTitle] = useState(false);
    const [showCoverPicker, setShowCoverPicker] = useState(false);
    const [coverAssets, setCoverAssets] = useState<AssetMetadata[]>([]);
    const [loadingAssets, setLoadingAssets] = useState(false);


    // Pagination state for cover image modal
    const COVERS_PER_PAGE = 9;
    const [visibleCoverCount, setVisibleCoverCount] = useState(COVERS_PER_PAGE);
    const [expanded, setExpanded] = useState(false);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    useEffect(() => { if (!isOpen) setExpanded(false); }, [isOpen]);

    // Theme helper
    // Generate localized description from nodeTypes
    const formatNodeTypes = (workflow: WorkflowSummary): string => {
        if (workflow.description) return workflow.description;
        if (!workflow.nodeTypes || Object.keys(workflow.nodeTypes).length === 0) {
            return t('workflowPanel.publicTemplate');
        }
        const summary = Object.entries(workflow.nodeTypes)
            .map(([type, count]) => `${count} ${t(`workflowPanel.nodeTypeNames.${type}`, { defaultValue: type })}`)
            .join(', ');
        return t('workflowPanel.workflowWith', { summary });
    };

    useEffect(() => {
        if (isOpen) {
            const cachedMy = dataCache.get<WorkflowSummary[]>(CACHE_KEYS.WORKFLOWS);
            const cachedPub = dataCache.get<WorkflowSummary[]>(CACHE_KEYS.PUBLIC_WORKFLOWS);

            if (cachedMy) {
                setWorkflows(cachedMy);
                setLoading(false);
                fetchWorkflows(true);
            } else {
                fetchWorkflows(false);
            }

            if (cachedPub) {
                setPublicWorkflows(cachedPub);
            }
            fetchPublicWorkflows();
        }
    }, [isOpen]);

    const fetchWorkflows = async (background = false) => {
        if (!background) setLoading(true);
        try {
            const response = await authFetch(`${API_URL}/workflows`);
            if (response.ok) {
                const data = await response.json();
                setWorkflows(data);
                dataCache.set(CACHE_KEYS.WORKFLOWS, data);
            }
        } catch (error) {
            console.error('Failed to fetch workflows:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchPublicWorkflows = async () => {
        try {
            const response = await authFetch(`${API_URL}/public-workflows`);
            if (response.ok) {
                const data = await response.json();
                setPublicWorkflows(data);
                dataCache.set(CACHE_KEYS.PUBLIC_WORKFLOWS, data);
            }
        } catch (error) {
            console.error('Failed to fetch public workflows:', error);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            const response = await authFetch(`${API_URL}/workflows/${id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                setWorkflows(prev => prev.filter(w => w.id !== id));
            }
        } catch (error) {
            console.error('Failed to delete workflow:', error);
        }
        setDeleteConfirm(null);
    };

    const allSelected = workflows.length > 0 && workflows.every(w => selectedIds.has(w.id));

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
            setSelectedIds(new Set(workflows.map(w => w.id)));
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
                    const res = await authFetch(`${API_URL}/workflows/${id}`, { method: 'DELETE' });
                    if (res.ok) {
                        setWorkflows(prev => prev.filter(w => w.id !== id));
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

    // Load more covers callback for infinite scroll
    const loadMoreCovers = useCallback(() => {
        setVisibleCoverCount(prev => Math.min(prev + COVERS_PER_PAGE, coverAssets.length));
    }, [coverAssets.length]);

    // Intersection Observer effect for infinite scroll
    useEffect(() => {
        if (!showCoverPicker || loadingAssets) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && visibleCoverCount < coverAssets.length) {
                    loadMoreCovers();
                }
            },
            { threshold: 0.1, rootMargin: '100px' }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [showCoverPicker, loadingAssets, visibleCoverCount, coverAssets.length, loadMoreCovers]);

    const openWorkflowEditor = (workflow: WorkflowSummary, e: React.MouseEvent) => {
        e.stopPropagation();
        const title = workflow.title || '';
        setEditingWorkflow({ id: workflow.id, title });
        setEditingTitle(title);
        setShowCoverPicker(false);
    };

    const closeWorkflowEditor = () => {
        setEditingWorkflow(null);
        setEditingTitle('');
        setShowCoverPicker(false);
    };

    const saveTitle = async () => {
        if (!editingWorkflow) return;
        const trimmed = editingTitle.trim();
        if (trimmed === editingWorkflow.title) return;

        setSavingTitle(true);
        try {
            const response = await authFetch(`${API_URL}/workflows/${editingWorkflow.id}/title`, {
                method: 'PUT',
                body: JSON.stringify({ title: trimmed })
            });

            if (response.ok) {
                setWorkflows(prev => prev.map(w =>
                    w.id === editingWorkflow.id ? { ...w, title: trimmed } : w
                ));
                if (onTitleChange) {
                    onTitleChange(editingWorkflow.id, trimmed);
                }
                closeWorkflowEditor();
            }
        } catch (error) {
            console.error('Failed to update title:', error);
        } finally {
            setSavingTitle(false);
        }
    };

    const openCoverPicker = async () => {
        setShowCoverPicker(true);
        setLoadingAssets(true);
        setVisibleCoverCount(COVERS_PER_PAGE);

        try {
            const response = await authFetch(`${API_URL}/assets/images?limit=36`);
            if (response.ok) {
                const data = await response.json();
                setCoverAssets(Array.isArray(data) ? data : data.assets || []);
            }
        } catch (error) {
            console.error('Failed to fetch assets:', error);
        } finally {
            setLoadingAssets(false);
        }
    };

    const selectCover = async (rawUrl: string) => {
        if (!editingWorkflow) return;
        const resolvedUrl = resolveAssetUrl(rawUrl);

        try {
            const response = await authFetch(`${API_URL}/workflows/${editingWorkflow.id}/cover`, {
                method: 'PUT',
                body: JSON.stringify({ coverUrl: resolvedUrl })
            });

            if (response.ok) {
                setWorkflows(prev => prev.map(w =>
                    w.id === editingWorkflow.id
                        ? { ...w, coverUrl: resolvedUrl }
                        : w
                ));
            }
        } catch (error) {
            console.error('Failed to update cover:', error);
        }

        setShowCoverPicker(false);
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric'
        });
    };

    const query = searchQuery.toLowerCase().trim();
    const filteredWorkflows = query
        ? workflows.filter(w => (w.title || '').toLowerCase().includes(query) || (w.description || '').toLowerCase().includes(query))
        : workflows;
    const filteredPublicWorkflows = query
        ? publicWorkflows.filter(w => (w.title || '').toLowerCase().includes(query) || (w.description || '').toLowerCase().includes(query))
        : publicWorkflows;

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
                {/* Header with Tabs */}
                <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[var(--sf-border)]' : 'border-gray-100'}`}>
                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => { setActiveTab('my'); exitSelectMode(); }}
                            className={`font-medium pb-1 transition-colors ${activeTab === 'my' ? isDark ? 'text-white border-b-2 border-white' : 'sf-rainbow-text border-b-2 border-white/30' : isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-400 hover:sf-rainbow-text'}`}
                        >
                            {t('workflowPanel.myWorkflows')}
                        </button>
                        <button
                            onClick={() => { setActiveTab('public'); exitSelectMode(); }}
                            className={`font-medium pb-1 transition-colors ${activeTab === 'public' ? isDark ? 'text-white border-b-2 border-white' : 'sf-rainbow-text border-b-2 border-white/30' : isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-400 hover:sf-rainbow-text'}`}
                        >
                            {t('workflowPanel.publicWorkflows')}
                        </button>
                        <button
                            onClick={() => { setActiveTab('templates'); exitSelectMode(); }}
                            className={`font-medium pb-1 transition-colors ${activeTab === 'templates' ? isDark ? 'text-white border-b-2 border-white' : 'sf-rainbow-text border-b-2 border-white/30' : isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-400 hover:sf-rainbow-text'}`}
                        >
                            {t('workflowPanel.templates')}
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        {activeTab === 'my' && (
                            <button
                                onClick={() => { if (selectMode) { exitSelectMode(); } else { setSelectMode(true); } }}
                                className={`p-1 rounded transition-colors ${selectMode ? (isDark ? 'text-white bg-neutral-700' : 'text-gray-900 bg-gray-200') : isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
                                title={selectMode ? t('common.cancel') : t('workflowPanel.batchSelect')}
                            >
                                <CheckSquare size={18} />
                            </button>
                        )}
                        <button
                            onClick={() => setExpanded(e => !e)}
                            className={`p-1 rounded transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
                            title={expanded ? 'Minimize' : 'Maximize'}
                        >
                            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                        </button>
                        <button
                            onClick={onClose}
                            className={`p-1 rounded transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
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
                {selectMode && activeTab === 'my' && (() => {
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
                                {allSelected ? t('workflowPanel.deselectAll') : t('workflowPanel.selectAll')}
                            </button>
                            <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                {t('workflowPanel.selectedCount', { count: selectedIds.size })}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {batchConfirm ? (
                                <>
                                    <span className={`text-xs font-medium ${isDark ? 'text-rose-400' : 'text-rose-500'}`}>{t('workflowPanel.confirmBatchDelete', { count: selectedIds.size })}</span>
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
                                        {t('workflowPanel.batchDelete')} ({selectedIds.size})
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
                    className={`flex-1 overflow-y-auto ${expanded ? 'p-8' : 'p-4'}`}
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa'
                    }}
                >
                    {loading && activeTab === 'my' ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="animate-spin text-neutral-500" size={24} />
                        </div>
                    ) : activeTab === 'my' ? (
                        /* My Workflows Tab */
                        filteredWorkflows.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 text-neutral-500 gap-1">
                                <p>{query ? t('common.noSearchResults') : t('workflowPanel.noWorkflowsFound')}</p>
                            </div>
                        ) : (
                            <div className={`grid gap-3 ${expanded ? 'grid-cols-6' : 'grid-cols-4'}`}>
                                {filteredWorkflows.map(workflow => {
                                    const isSelected = selectedIds.has(workflow.id);
                                    return (
                                    <div
                                        key={workflow.id}
                                        onClick={() => {
                                            if (selectMode) {
                                                toggleSelect(workflow.id);
                                            } else {
                                                onLoadWorkflow(workflow.id);
                                            }
                                        }}
                                        className={`relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 group ${
                                            selectMode && isSelected
                                                ? isDark
                                                    ? 'shadow-[0_0_25px_rgba(192,132,252,0.25)] scale-[1.02]'
                                                    : 'lt-card-selected scale-[1.02]'
                                                : workflow.id === currentWorkflowId ? 'ring-2 ring-white/30' : ''
                                        }`}
                                    >
                                        {selectMode && isSelected && (
                                            <div className="absolute inset-0 rounded-xl pointer-events-none ring-2 ring-purple-400/80 ring-inset z-20" />
                                        )}
                                        <div className={`aspect-[4/3] flex items-center justify-center relative overflow-hidden ${isDark ? 'bg-gradient-to-br from-neutral-800 to-neutral-900' : 'bg-gradient-to-br from-gray-100 to-gray-200'}`}>
                                            {selectMode && (
                                                <div className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 ${
                                                    isSelected
                                                        ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-md shadow-purple-500/40 scale-100 opacity-100'
                                                        : 'bg-black/40 backdrop-blur-sm scale-90 opacity-70 group-hover:opacity-100 group-hover:scale-100 border border-white/20'
                                                }`}>
                                                    <Check size={12} className={`text-white transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
                                                </div>
                                            )}
                                            {workflow.coverUrl ? (
                                                <img src={ossResize(workflow.coverUrl, 300)} alt={workflow.title} className="w-full h-full object-cover" loading="lazy" />
                                            ) : (
                                                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-white/10 to-white/10 flex items-center justify-center">
                                                    <FileText size={28} className="text-neutral-500" />
                                                </div>
                                            )}
                                            {!selectMode && (
                                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                    <button onClick={(e) => openWorkflowEditor(workflow, e)} className="p-1.5 rounded-lg transition-all bg-gradient-to-r from-black/50 via-black/50 to-black/50 hover:from-pink-500 hover:via-purple-500 hover:to-blue-500" title={t('workflowPanel.editWorkflow')}>
                                                        <Pencil size={14} className="text-white" />
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(workflow.id); }} className="p-1.5 bg-black/50 hover:bg-red-500 rounded-lg transition-all" title={t('workflowPanel.deleteWorkflow')}>
                                                        <Trash2 size={14} className="text-white" />
                                                    </button>
                                                </div>
                                            )}
                                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 pt-6 pointer-events-none">
                                                <p className="text-white text-xs truncate">{formatNodeTypes(workflow)}</p>
                                            </div>
                                        </div>
                                        <div className={`p-3 ${isDark ? 'bg-neutral-900/50' : 'bg-white/90 backdrop-blur-sm'}`}>
                                            <h3 className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-gray-700'}`}>{workflow.title || t('workflowPanel.untitled')}</h3>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        )
                    ) : activeTab === 'templates' ? (
                        /* Templates Tab */
                        <div className={`grid gap-4 ${expanded ? 'grid-cols-5' : 'grid-cols-3'}`}>
                            {WORKFLOW_TEMPLATES.map(tpl => (
                                <div
                                    key={tpl.id}
                                    onClick={() => onLoadWorkflow(`template:${tpl.id}`)}
                                    className={`rounded-xl overflow-hidden cursor-pointer transition-all group hover:ring-2 ${isDark ? 'hover:ring-white/20' : 'hover:ring-gray-300'}`}
                                >
                                    <div className={`aspect-[4/3] flex items-center justify-center relative overflow-hidden ${isDark ? 'bg-gradient-to-br from-violet-900/30 to-indigo-900/30' : 'bg-gradient-to-br from-violet-50 to-indigo-50'}`}>
                                        <span className="text-5xl">{tpl.icon}</span>
                                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-violet-600/80 rounded text-[10px] font-medium text-white">
                                            {t('workflowPanel.template')}
                                        </div>
                                    </div>
                                    <div className={`p-3 ${isDark ? 'bg-neutral-900/50' : 'bg-white/90 backdrop-blur-sm'}`}>
                                        <h3 className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-gray-700'}`}>{tpl.name}</h3>
                                        <p className={`text-xs mt-0.5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{tpl.desc}</p>
                                        <div className="flex gap-1 mt-2">
                                            {Object.entries(tpl.nodes).map(([type, count]) => (
                                                <span key={type} className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-white/5 text-neutral-400' : 'bg-gray-100 text-gray-500'}`}>
                                                    {count} {type}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* Public Workflows Tab */
                        filteredPublicWorkflows.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 text-neutral-500 gap-2">
                                <FileText size={32} className="opacity-50" />
                                <p>{query ? t('common.noSearchResults') : t('workflowPanel.noPublicWorkflows')}</p>
                                {!query && <p className="text-xs text-neutral-600">{t('workflowPanel.addWorkflowsHint')}</p>}
                            </div>
                        ) : (
                            <div className={`grid gap-4 ${expanded ? 'grid-cols-5' : 'grid-cols-3'}`}>
                                {filteredPublicWorkflows.map(workflow => (
                                    <div
                                        key={workflow.id}
                                        onClick={() => onLoadWorkflow(`public:${workflow.id}`)}
                                        className="rounded-xl overflow-hidden cursor-pointer transition-all group"
                                    >
                                        {/* Thumbnail */}
                                        <div className="aspect-[4/3] bg-gradient-to-br from-green-800/30 to-emerald-900/30 flex items-center justify-center relative overflow-hidden">
                                            {workflow.coverUrl ? (
                                                <img
                                                    src={workflow.coverUrl}
                                                    alt={workflow.title}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-600/20 flex items-center justify-center">
                                                    <FileText size={28} className="text-neutral-500" />
                                                </div>
                                            )}
                                            {/* Public badge */}
                                            <div className="absolute top-2 left-2 px-2 py-0.5 bg-green-600/80 rounded text-[10px] font-medium text-white">
                                                {t('workflowPanel.public')}
                                            </div>
                                        </div>
                                        {/* Info */}
                                        <div className={`p-3 ${isDark ? 'bg-neutral-900/50' : 'bg-white/90 backdrop-blur-sm'}`}>
                                            <h3 className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-gray-700'}`}>{workflow.title || t('workflowPanel.untitled')}</h3>
                                            <p className={`text-xs mt-0.5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                                                {formatNodeTypes(workflow)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
                </div>
            </HoverBorderGradient>

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className={`fixed inset-0 ${isDark ? 'bg-black/80' : 'bg-black/40'} backdrop-blur-sm flex items-center justify-center z-50`}>
                    <HoverBorderGradient containerClassName="rounded-xl w-[340px]" className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`} fillClassName={isDark ? undefined : 'bg-white'} duration={4}>
                    <div className="p-6">
                        <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('workflowPanel.deleteWorkflow')}</h3>
                        <p className={`text-sm mb-6 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                            {t('workflowPanel.deleteWorkflowConfirm')}
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className={`px-4 py-2 rounded-lg text-sm transition-colors ${isDark ? 'bg-neutral-800 hover:bg-neutral-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                            >
                                {t('common.cancel')}
                            </button>
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

            {/* Edit Workflow Modal (name + cover) */}
            {editingWorkflow && (
                <div className={`fixed inset-0 ${isDark ? 'bg-black/80' : 'bg-black/40'} backdrop-blur-sm flex items-center justify-center z-50`}>
                    <HoverBorderGradient containerClassName="rounded-xl w-[500px] max-h-[600px]" className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`} fillClassName={isDark ? undefined : 'bg-white'} duration={4}>
                    <div className="p-6 flex flex-col min-h-0 max-h-[600px] overflow-hidden">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                {showCoverPicker ? t('workflowPanel.selectCoverImage') : t('workflowPanel.editWorkflow')}
                            </h3>
                            <button
                                onClick={showCoverPicker ? () => setShowCoverPicker(false) : closeWorkflowEditor}
                                className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {showCoverPicker ? (
                            /* Cover picker sub-view */
                            <>
                                {loadingAssets ? (
                                    <div className="flex items-center justify-center h-40">
                                        <Loader2 className="animate-spin text-neutral-500" size={24} />
                                    </div>
                                ) : coverAssets.length === 0 ? (
                                    <div className="flex items-center justify-center h-40 text-neutral-500">
                                        {t('workflowPanel.noImagesAvailable')}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-3 overflow-y-auto flex-1">
                                        {coverAssets.slice(0, visibleCoverCount).map(asset => (
                                            <button
                                                key={asset.id}
                                                onClick={() => selectCover(asset.url)}
                                                className="h-32 w-full rounded-lg overflow-hidden hover:ring-2 hover:ring-white/30 transition-all relative group bg-neutral-900"
                                            >
                                                <LazyImage
                                                    src={ossThumb(resolveAssetUrl(asset.url), 128)}
                                                    alt="Cover option"
                                                    className="w-full h-full"
                                                    placeholderClassName="rounded-lg"
                                                    rootMargin="100px"
                                                />
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                                    <Check size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                                </div>
                                            </button>
                                        ))}

                                        {visibleCoverCount < coverAssets.length && (
                                            <div
                                                ref={loadMoreRef}
                                                className="col-span-3 flex items-center justify-center py-4"
                                            >
                                                <Loader2 className="animate-spin text-neutral-500" size={20} />
                                                <span className="ml-2 text-neutral-500 text-sm">{t('workflowPanel.loadingMore')}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            /* Main edit view: name + cover preview */
                            <div className="flex flex-col gap-5">
                                {/* Name field */}
                                <div>
                                    <label className="block text-sm font-medium text-neutral-400 mb-2">
                                        {t('workflowPanel.workflowName')}
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={editingTitle}
                                            onChange={(e) => setEditingTitle(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); }}
                                            placeholder={t('workflowPanel.untitled')}
                                            className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-white/30 transition-colors"
                                            autoFocus
                                        />
                                        <button
                                            onClick={saveTitle}
                                            disabled={savingTitle || editingTitle.trim() === editingWorkflow.title}
                                            className="px-4 py-2 rounded-lg sf-rainbow-btn disabled:bg-neutral-700 disabled:text-neutral-500 text-sm font-medium transition-colors"
                                        >
                                            {savingTitle ? <Loader2 size={14} className="animate-spin" /> : t('workflowPanel.save')}
                                        </button>
                                    </div>
                                </div>

                                {/* Cover preview + change */}
                                <div>
                                    <label className="block text-sm font-medium text-neutral-400 mb-2">
                                        {t('workflowPanel.cover')}
                                    </label>
                                    <div
                                        onClick={openCoverPicker}
                                        className="aspect-video w-full max-w-[240px] rounded-lg overflow-hidden bg-neutral-900 border border-neutral-700 hover:border-white/30 cursor-pointer transition-colors relative group"
                                    >
                                        {(() => {
                                            const wf = workflows.find(w => w.id === editingWorkflow.id);
                                            return wf?.coverUrl ? (
                                                <img src={wf.coverUrl} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <FileText size={32} className="text-neutral-600" />
                                                </div>
                                            );
                                        })()}
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                                            <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                                                {t('workflowPanel.changeCover')}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    </HoverBorderGradient>
                </div>
            )}
        </>
    );
};
