/**
 * SelectionBoundingBox.tsx
 * 
 * Renders a bounding box around selected nodes with resize handles.
 * Shows "Group" button for multi-selection and group toolbar when grouped.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Settings2 } from 'lucide-react';
import { NodeData, NodeGroup, NodeType, NodeStatus } from '../../types';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { useTheme } from '../../hooks/useTheme';

interface SelectionBoundingBoxProps {
    selectedNodes: NodeData[];
    group?: NodeGroup;
    viewport: { x: number; y: number; zoom: number };
    onGroup: () => void;
    onUngroup: () => void;
    onBoundingBoxPointerDown: (e: React.PointerEvent) => void;
    onRenameGroup?: (groupId: string, newLabel: string) => void;
    onSortNodes?: (direction: 'horizontal' | 'vertical' | 'grid') => void;
    onCreateVideo?: () => void;
    onEditStoryboard?: (groupId: string) => void;
    onBatchSave?: (nodes: NodeData[]) => Promise<{ success: number; failed: number }>;
    onBatchDownload?: (nodes: NodeData[]) => Promise<void>;
    onBatchRetry?: (nodeIds: string[]) => void;
    onBatchRegenerate?: (nodeIds: string[]) => void;
    onBatchUpdateModel?: (nodeIds: string[], model: string) => void;
    showToolbar?: boolean;
    onGroupSelect?: () => void;
    onDuplicateNodes?: () => void;
    onGroupConnectorDown?: (e: React.PointerEvent, groupNodeIds: string[], side: 'left' | 'right', bboxEdge: { x: number; y: number }) => void;
    isDraggingConnection?: boolean;
    onContextMenu?: (e: React.MouseEvent) => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the width of a node based on its type
 * @param node - The node to calculate width for
 * @param allNodes - All nodes in the selection (to find parent for Editor nodes)
 */
const getNodeWidth = (node: NodeData, allNodes?: NodeData[]): number => {
    // Image Editor with input from parent: width depends on parent's aspect ratio
    if (node.type === NodeType.IMAGE_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId && allNodes?.find(n => n.id === parentId);
        if (parentNode?.resultUrl && parentNode?.resultAspectRatio) {
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait images: height=500px, width=500*aspectRatio
                // For landscape images: width is capped at 500px
                if (aspectRatio < 1) {
                    return 500 * aspectRatio;
                } else {
                    return 500;
                }
            }
        }
        // Empty: width 340px
        return 340;
    }

    // Video Editor with input: uses 16:9 aspect ratio with maxWidth 500px
    if (node.type === NodeType.VIDEO_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId && allNodes?.find(n => n.id === parentId);
        if (parentNode?.resultUrl) {
            return 500;
        }
        // Empty: width 340px
        return 340;
    }

    if (node.type === NodeType.VIDEO) return 385;
    return 365;
};

/**
 * Estimate the height of a node based on its type and aspect ratio.
 * This accounts for the content area + any controls/padding.
 * @param node - The node to calculate height for
 * @param allNodes - All nodes in the selection (to find parent for Editor nodes)
 */
const getNodeHeight = (node: NodeData, allNodes?: NodeData[]): number => {
    const baseWidth = getNodeWidth(node, allNodes);

    // Handle Image Editor nodes
    if (node.type === NodeType.IMAGE_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId && allNodes?.find(n => n.id === parentId);
        if (parentNode?.resultUrl && parentNode?.resultAspectRatio) {
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait: height = 500px
                // For landscape: height = 500 / aspectRatio
                if (aspectRatio < 1) {
                    return 500;
                } else {
                    return 500 / aspectRatio;
                }
            }
        }
        // Empty: minHeight 380px
        return 380;
    }

    // Handle Video Editor nodes
    if (node.type === NodeType.VIDEO_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId && allNodes?.find(n => n.id === parentId);
        if (parentNode?.resultUrl) {
            // Video editor shows 16:9 when has content
            return 500 / (16 / 9);
        }
        // Empty: minHeight 380px
        return 380;
    }

    // Parse aspect ratio to calculate content height for Image/Video nodes
    let aspectRatio = 4 / 3; // Default matches placeholder

    if (node.resultUrl && node.resultAspectRatio) {
        // Has generated result with known dimensions
        const parts = node.resultAspectRatio.split('/');
        if (parts.length === 2) {
            aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
        }
    } else if (node.resultUrl) {
        // Has result but no aspect ratio metadata
        aspectRatio = node.type === NodeType.VIDEO ? 16 / 9 : 1;
    } else {
        // No result (idle / loading / placeholder) — NodeContent renders aspect-[4/3]
        aspectRatio = 4 / 3;
    }

    // Calculate content height from aspect ratio
    return baseWidth / aspectRatio;
};

export const SelectionBoundingBox: React.FC<SelectionBoundingBoxProps> = ({
    selectedNodes,
    group,
    viewport,
    onGroup,
    onUngroup,
    onBoundingBoxPointerDown,
    onRenameGroup,
    onSortNodes,
    onCreateVideo,
    onEditStoryboard,
    onBatchSave,
    onBatchDownload,
    onBatchRetry,
    onBatchRegenerate,
    onBatchUpdateModel,
    showToolbar = true,
    onGroupSelect,
    onDuplicateNodes,
    onGroupConnectorDown,
    isDraggingConnection = false,
    onContextMenu: onContextMenuProp,
}) => {
    const { t } = useTranslation();
    const { isDark } = useTheme();
    // ============================================================================
    // STATE
    // ============================================================================

    const [isEditingLabel, setIsEditingLabel] = useState(false);
    const [editedLabel, setEditedLabel] = useState('');
    const [showSortDropdown, setShowSortDropdown] = useState(false);
    const [isBatchSaving, setIsBatchSaving] = useState(false);
    const [isBatchDownloading, setIsBatchDownloading] = useState(false);
    const [batchSaveResult, setBatchSaveResult] = useState<string | null>(null);
    const [batchDownloadResult, setBatchDownloadResult] = useState<string | null>(null);
    // ============================================================================
    // CALCULATIONS
    // ============================================================================

    // Don't render for 0 nodes or single nodes (unless it's a group)
    if (selectedNodes.length === 0) return null;
    if (selectedNodes.length === 1 && !group) return null;

    // Calculate bounding box from all selected nodes with proper dimensions
    const PADDING_X = 50; // Horizontal padding (accounts for + connectors on sides)
    const PADDING_TOP = 30; // Top padding for node titles
    const PADDING_BOTTOM = 50; // Bottom padding for controls

    let rawMinX = Infinity, rawMinY = Infinity, rawMaxX = -Infinity, rawMaxY = -Infinity;
    for (const n of selectedNodes) {
        const r = n.x + getNodeWidth(n, selectedNodes);
        const b = n.y + getNodeHeight(n, selectedNodes);
        if (n.x < rawMinX) rawMinX = n.x;
        if (n.y < rawMinY) rawMinY = n.y;
        if (r > rawMaxX) rawMaxX = r;
        if (b > rawMaxY) rawMaxY = b;
    }
    const minX = rawMinX - PADDING_X;
    const minY = rawMinY - PADDING_TOP;
    const maxX = rawMaxX + PADDING_X;
    const maxY = rawMaxY + PADDING_BOTTOM;

    const width = maxX - minX;
    const height = maxY - minY;

    const isGrouped = !!group;
    const showGroupButton = selectedNodes.length > 1 && !isGrouped;

    // Calculate scale factor for UI elements - clamp to prevent elements from getting too large
    // At zoom 1.0: scale = 1.0 (normal size)
    // At zoom 0.5: scale = 1.5 (max clamped, instead of 2.0)
    // At zoom 2.0: scale = 0.5 (smaller)
    const uiScale = Math.min(1 / viewport.zoom, 1.5);

    // ============================================================================
    // RENDER
    // ============================================================================

    const hasGroupInteraction = isGrouped && !!onGroupSelect;

    return (
        <div
            className={`absolute selection-bbox bbox-interactive cursor-move group/bbox ${isDraggingConnection ? 'pointer-events-none' : 'pointer-events-auto'}`}
            style={{
                left: minX,
                top: minY,
                width,
                height,
                borderRadius: '8px',
                backgroundColor: 'transparent',
                boxShadow: isGrouped ? '0 0 15px rgba(96, 165, 250, 0.08)' : 'none',
                zIndex: 5
            }}
            onClick={hasGroupInteraction ? (e) => {
                e.stopPropagation();
                onGroupSelect!();
            } : undefined}
            onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button === 0 || e.button === 2) {
                    if (hasGroupInteraction && e.button !== 0) {
                        onGroupSelect!();
                    }
                    onBoundingBoxPointerDown(e);
                }
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenuProp?.(e);
            }}
        >
            {/* Gradient border — hollow (transparent interior, only border visible) */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '8px',
                    padding: isGrouped ? 2 : 1.5,
                    background: 'linear-gradient(135deg, #ff6b9d, #c084fc, #60a5fa, #34d399)',
                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    WebkitMaskComposite: 'xor',
                    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    maskComposite: 'exclude',
                    pointerEvents: 'none',
                } as React.CSSProperties}
            />

            {/* Edge strips for border-drag (extends beyond bbox bounds) */}
            {[
                { top: -6, left: -6, right: -6, height: 12 },
                { bottom: -6, left: -6, right: -6, height: 12 },
                { top: -6, left: -6, bottom: -6, width: 12 },
                { top: -6, right: -6, bottom: -6, width: 12 },
            ].map((s, i) => (
                <div
                    key={i}
                    className="absolute pointer-events-auto cursor-move bbox-interactive"
                    style={s as any}
                    onPointerDown={onBoundingBoxPointerDown}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                />
            ))}
            {/* Resize Handles */}
            {[
                { pos: 'top-left', cursor: 'nw-resize', top: -4, left: -4 },
                { pos: 'top', cursor: 'n-resize', top: -4, left: '50%', transform: 'translateX(-50%)' },
                { pos: 'top-right', cursor: 'ne-resize', top: -4, right: -4 },
                { pos: 'right', cursor: 'e-resize', top: '50%', right: -4, transform: 'translateY(-50%)' },
                { pos: 'bottom-right', cursor: 'se-resize', bottom: -4, right: -4 },
                { pos: 'bottom', cursor: 's-resize', bottom: -4, left: '50%', transform: 'translateX(-50%)' },
                { pos: 'bottom-left', cursor: 'sw-resize', bottom: -4, left: -4 },
                { pos: 'left', cursor: 'w-resize', top: '50%', left: -4, transform: 'translateY(-50%)' }
            ].map(handle => (
                <div
                    key={handle.pos}
                    className="absolute w-2 h-2 bg-white border border-blue-400 rounded-sm pointer-events-auto"
                    style={{
                        top: handle.top,
                        left: handle.left,
                        right: handle.right,
                        bottom: handle.bottom,
                        transform: handle.transform,
                        cursor: handle.cursor
                    }}
                />
            ))}

            {/* Group Label (when grouped) - Positioned on left side */}
            {isGrouped && group && (
                isEditingLabel ? (
                    <input
                        type="text"
                        value={editedLabel}
                        onChange={(e) => setEditedLabel(e.target.value)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onBlur={() => {
                            if (editedLabel.trim() && onRenameGroup) {
                                onRenameGroup(group.id, editedLabel.trim());
                            }
                            setIsEditingLabel(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (editedLabel.trim() && onRenameGroup) {
                                    onRenameGroup(group.id, editedLabel.trim());
                                }
                                setIsEditingLabel(false);
                            } else if (e.key === 'Escape') {
                                setIsEditingLabel(false);
                            }
                        }}
                        autoFocus
                        className="absolute text-sm font-medium text-white bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 px-3 py-1 rounded pointer-events-auto outline-none whitespace-nowrap"
                        style={{
                            top: 8,
                            right: 'calc(100% + 8px)',
                            transform: `scale(${uiScale})`,
                            transformOrigin: 'top right'
                        }}
                    />
                ) : (
                    <div
                        className="absolute text-sm font-medium text-white bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 px-3 py-1 rounded pointer-events-auto cursor-text whitespace-nowrap"
                        style={{
                            top: 8,
                            right: 'calc(100% + 8px)',
                            transform: `scale(${uiScale})`,
                            transformOrigin: 'top right'
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onDoubleClick={() => {
                            setEditedLabel(group.label);
                            setIsEditingLabel(true);
                        }}
                    >
                        {group.label === 'New Group' ? t('selection.newGroup') : group.label}
                    </div>
                )
            )}

            {/* Toolbar (multi-select or group) */}
            {showToolbar && (showGroupButton || isGrouped) && (() => {
                const nodesWithResults = selectedNodes.filter(
                    n => (n.type === NodeType.IMAGE || n.type === NodeType.VIDEO || n.type === NodeType.CAMERA_ANGLE) &&
                        n.status === NodeStatus.SUCCESS && n.resultUrl
                );
                const hasResults = nodesWithResults.length > 0;
                const btnCls = "h-7 w-7 flex items-center justify-center rounded-md transition-colors";
                const iconCls = isDark
                    ? "text-neutral-400 hover:text-white hover:bg-white/10"
                    : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100";

                return (
                    <div
                        className={`absolute flex items-center h-9 px-1 gap-px rounded-full pointer-events-auto border ${isDark
                            ? "bg-neutral-900 border-neutral-700/60 shadow-2xl"
                            : "bg-white border-gray-200 shadow-md"}`}
                        style={{
                            top: -12,
                            left: '50%',
                            transform: `translateX(-50%) scale(${uiScale}) translateY(-100%)`,
                            transformOrigin: 'bottom center'
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        {/* Group-only: Sort */}
                        {isGrouped && (
                            <div className="relative">
                                <button
                                    onClick={() => setShowSortDropdown(!showSortDropdown)}
                                    title={t('selection.sort')}
                                    className={`${btnCls} ${iconCls}`}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/></svg>
                                </button>
                                {showSortDropdown && (
                                    <div className={`absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 w-32 rounded-lg overflow-hidden z-50 border ${isDark
                                        ? "bg-neutral-900 border-neutral-700/60 shadow-2xl"
                                        : "bg-white border-gray-200 shadow-md"}`}
                                    >
                                        {([
                                            { dir: 'horizontal' as const, label: t('selection.horizontal'), icon: <><line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/></> },
                                            { dir: 'vertical' as const, label: t('selection.vertical'), icon: <><line x1="12" y1="4" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/></> },
                                            { dir: 'grid' as const, label: t('selection.grid'), icon: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></> },
                                        ]).map(item => (
                                            <button
                                                key={item.dir}
                                                onClick={() => { onSortNodes?.(item.dir); setShowSortDropdown(false); }}
                                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors ${isDark
                                                    ? "text-neutral-300 hover:text-white hover:bg-white/10"
                                                    : "text-gray-600 hover:text-neutral-900 hover:bg-neutral-100"}`}
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{item.icon}</svg>
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Group-only: Ungroup */}
                        {isGrouped && (
                            <button onClick={onUngroup} title={t('selection.ungroup')} className={`${btnCls} ${iconCls}`}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
                            </button>
                        )}

                        {/* Batch save/download */}
                        {hasResults && onBatchSave && (
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    setIsBatchSaving(true); setBatchSaveResult(null);
                                    try {
                                        const result = await onBatchSave(nodesWithResults);
                                        const msg = result.failed > 0 ? `✓${result.success}/✗${result.failed}` : `✓${result.success}`;
                                        setBatchSaveResult(msg); setTimeout(() => setBatchSaveResult(null), 3000);
                                    } catch { setBatchSaveResult('✗'); setTimeout(() => setBatchSaveResult(null), 3000); }
                                    finally { setIsBatchSaving(false); }
                                }}
                                disabled={isBatchSaving}
                                title={`${t('batch.saveToLibrary')} (${nodesWithResults.length})`}
                                className={`${btnCls} ${batchSaveResult ? 'text-green-400' : iconCls} disabled:opacity-40`}
                            >
                                {batchSaveResult
                                    ? <span className="text-[10px] font-bold">{batchSaveResult}</span>
                                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                                }
                            </button>
                        )}
                        {hasResults && onBatchDownload && (
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    setIsBatchDownloading(true); setBatchDownloadResult(null);
                                    try {
                                        await onBatchDownload(nodesWithResults);
                                        setBatchDownloadResult(`✓${nodesWithResults.length}`); setTimeout(() => setBatchDownloadResult(null), 3000);
                                    } catch { setBatchDownloadResult('✗'); setTimeout(() => setBatchDownloadResult(null), 3000); }
                                    finally { setIsBatchDownloading(false); }
                                }}
                                disabled={isBatchDownloading}
                                title={`${t('batch.download')} (${nodesWithResults.length})`}
                                className={`${btnCls} ${batchDownloadResult ? 'text-green-400' : iconCls} disabled:opacity-40`}
                            >
                                {batchDownloadResult
                                    ? <span className="text-[10px] font-bold">{batchDownloadResult}</span>
                                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                }
                            </button>
                        )}

                        {/* Batch retry for error nodes */}
                        {onBatchRetry && (() => {
                            const errorNodes = selectedNodes.filter(n => n.status === NodeStatus.ERROR);
                            if (errorNodes.length === 0) return null;
                            return (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onBatchRetry(errorNodes.map(n => n.id)); }}
                                    title={`${t('batch.retryFailed')} (${errorNodes.length})`}
                                    className={`${btnCls} ${iconCls}`}
                                >
                                    <RefreshCw size={14} />
                                </button>
                            );
                        })()}

                        {/* Batch regenerate for all generatable nodes */}
                        {onBatchRegenerate && (() => {
                            const generatableTypes = [NodeType.IMAGE, NodeType.VIDEO, NodeType.LOCAL_IMAGE_MODEL, NodeType.CAMERA_ANGLE, NodeType.IMAGE_EDITOR, NodeType.VIDEO_EDITOR];
                            const generatableNodes = selectedNodes.filter(n =>
                                generatableTypes.includes(n.type) && n.status !== NodeStatus.LOADING
                            );
                            if (generatableNodes.length === 0) return null;
                            return (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onBatchRegenerate(generatableNodes.map(n => n.id)); }}
                                    title={`${t('batch.regenerate')} (${generatableNodes.length})`}
                                    className={`h-7 flex items-center gap-1 px-2 rounded-md text-[11px] font-medium transition-colors ${isDark
                                        ? "text-neutral-400 hover:text-white hover:bg-white/10"
                                        : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"}`}
                                >
                                    <RefreshCw size={13} />
                                    <span>{generatableNodes.length}</span>
                                </button>
                            );
                        })()}

                        {(hasResults || isGrouped) && (
                            <div className={`w-px h-4 ${isDark ? "bg-neutral-700/50" : "bg-gray-200"}`} />
                        )}

                        {/* Duplicate */}
                        {onDuplicateNodes && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onDuplicateNodes(); }}
                                title={t('selection.duplicate')}
                                className={`${btnCls} ${iconCls}`}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            </button>
                        )}

                        {/* Multi-select only: Group */}
                        {showGroupButton && (
                            <button
                                onClick={onGroup}
                                title={t('selection.group')}
                                className={`h-7 flex items-center gap-1 px-2 rounded-md text-[11px] font-medium transition-colors ${isDark
                                    ? "text-white hover:bg-white/10"
                                    : "text-neutral-800 hover:bg-neutral-100"}`}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                                {t('selection.group')}
                            </button>
                        )}

                        {/* Group-only: Storyboard actions */}
                        {isGrouped && group.storyContext && (
                            <>
                                <div className={`w-px h-4 ${isDark ? "bg-neutral-700/50" : "bg-gray-200"}`} />
                                <button
                                    onClick={(e) => { e.stopPropagation(); if (onEditStoryboard) onEditStoryboard(group.id); }}
                                    title={t('selection.editStoryboard')}
                                    className={`${btnCls} ${iconCls}`}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); if (onCreateVideo) onCreateVideo(); }}
                                    className="h-7 flex items-center gap-1 px-2.5 rounded-full text-[11px] font-medium transition-all sf-rainbow-btn"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                    {t('selection.createVideos')}
                                </button>
                            </>
                        )}
                    </div>
                );
            })()}

            {/* Group Connector Buttons (left & right) — for multi-select or grouped boxes */}
            {selectedNodes.length > 1 && onGroupConnectorDown && (() => {
                const groupNodeIds = selectedNodes.map(n => n.id);
                const btnCls = isDark ? 'bg-[var(--sf-bg-card)]' : 'bg-white text-gray-600';
                const visibilityCls = isDraggingConnection
                    ? 'opacity-70'
                    : 'opacity-0 group-hover/bbox:opacity-100';
                return (
                    <>
                        <HoverBorderGradient
                            as="button"
                            containerClassName={`absolute ${visibilityCls} z-10 rounded-lg transition-opacity pointer-events-auto`}
                            className={`w-10 h-10 rounded-lg flex items-center justify-center cursor-crosshair transition-all hover:scale-110 ${btnCls}`}
                            fillClassName={isDark ? undefined : 'bg-white'}
                            duration={2}
                            style={{
                                left: -52,
                                top: height / 2 - 20,
                                transform: `scale(${uiScale})`,
                                transformOrigin: 'center right'
                            }}
                            onPointerDown={(e: React.PointerEvent) => {
                                e.stopPropagation();
                                onGroupConnectorDown(e, groupNodeIds, 'left', { x: minX, y: minY + height / 2 });
                            }}
                        >
                            <Plus size={18} />
                        </HoverBorderGradient>
                        <HoverBorderGradient
                            as="button"
                            containerClassName={`absolute ${visibilityCls} z-10 rounded-lg transition-opacity pointer-events-auto`}
                            className={`w-10 h-10 rounded-lg flex items-center justify-center cursor-crosshair transition-all hover:scale-110 ${btnCls}`}
                            fillClassName={isDark ? undefined : 'bg-white'}
                            duration={2}
                            style={{
                                right: -52,
                                top: height / 2 - 20,
                                transform: `scale(${uiScale})`,
                                transformOrigin: 'center left'
                            }}
                            onPointerDown={(e: React.PointerEvent) => {
                                e.stopPropagation();
                                onGroupConnectorDown(e, groupNodeIds, 'right', { x: maxX, y: minY + height / 2 });
                            }}
                        >
                            <Plus size={18} />
                        </HoverBorderGradient>
                    </>
                );
            })()}
        </div>
    );
};
