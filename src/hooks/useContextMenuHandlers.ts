/**
 * useContextMenuHandlers.ts
 * 
 * Handles context menu operations: double-click, right-click,
 * node context menu, toolbar add button.
 */

import React, { useCallback } from 'react';
import { NodeData, NodeType, ContextMenuState, Viewport } from '../types';

interface UseContextMenuHandlersOptions {
    nodes: NodeData[];
    viewport: Viewport;
    contextMenu: ContextMenuState;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    handleOpenCreateAsset: (nodeId: string) => void;
    handleSelectTypeFromMenu: (
        type: NodeType | 'DELETE',
        contextMenu: ContextMenuState,
        viewport: Viewport,
        closeMenu: () => void
    ) => void;
    onMenuClose?: () => void;
}

export const useContextMenuHandlers = ({
    nodes,
    viewport,
    contextMenu,
    setContextMenu,
    handleOpenCreateAsset,
    handleSelectTypeFromMenu,
    onMenuClose
}: UseContextMenuHandlersOptions) => {
    // ============================================================================
    // DOUBLE-CLICK & RIGHT-CLICK
    // ============================================================================

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const isCanvasArea = target.id === 'canvas-background' || target.closest('#canvas-background');
        const isInsideBbox = target.classList.contains('bbox-interactive') ||
            target.closest('.bbox-interactive') ||
            document.elementsFromPoint(e.clientX, e.clientY).some(
                el => el.classList.contains('bbox-interactive')
            );
        if (isCanvasArea && !target.closest('.canvas-node') && !isInsideBbox) {
            setContextMenu({
                isOpen: true,
                x: e.clientX,
                y: e.clientY,
                type: 'add-nodes'
            });
        }
    }, [setContextMenu]);

    const handleGlobalContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const target = e.target as HTMLElement;
        const isCanvasArea = target.id === 'canvas-background' || target.closest('#canvas-background');
        const isInsideBbox = target.classList.contains('bbox-interactive') ||
            target.closest('.bbox-interactive') ||
            document.elementsFromPoint(e.clientX, e.clientY).some(
                el => el.classList.contains('bbox-interactive')
            );
        if (isCanvasArea && !target.closest('.canvas-node') && !isInsideBbox) {
            setContextMenu({
                isOpen: true,
                x: e.clientX,
                y: e.clientY,
                type: 'global'
            });
        }
    }, [setContextMenu]);

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    const handleAddNext = useCallback((nodeId: string, _direction: 'left' | 'right', x?: number, y?: number) => {
        const sourceNode = nodes.find(n => n.id === nodeId);
        if (!sourceNode) return;

        setContextMenu({
            isOpen: true,
            x: x ?? window.innerWidth / 2,
            y: y ?? window.innerHeight / 2,
            type: 'node-connector',
            sourceNodeId: nodeId,
            connectorSide: _direction
        });
    }, [nodes, setContextMenu]);

    const handleGroupAddNext = useCallback((groupNodeIds: string[], direction: 'left' | 'right', x?: number, y?: number) => {
        if (groupNodeIds.length === 0) return;
        setContextMenu({
            isOpen: true,
            x: x ?? window.innerWidth / 2,
            y: y ?? window.innerHeight / 2,
            type: 'group-connector',
            sourceGroupNodeIds: groupNodeIds,
            connectorSide: direction
        });
    }, [setContextMenu]);

    const handleNodeContextMenu = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        const node = nodes.find(n => n.id === id);
        if (!node) return;

        setContextMenu({
            isOpen: true,
            x: e.clientX,
            y: e.clientY,
            type: 'node-options',
            sourceNodeId: id
        });
    }, [nodes, setContextMenu]);

    // ============================================================================
    // CONTEXT MENU ACTIONS
    // ============================================================================

    const handleContextMenuCreateAsset = useCallback(() => {
        if (contextMenu.sourceNodeId) {
            handleOpenCreateAsset(contextMenu.sourceNodeId);
        }
    }, [contextMenu.sourceNodeId, handleOpenCreateAsset]);

    const handleContextMenuSelect = useCallback((type: NodeType | 'DELETE') => {
        handleSelectTypeFromMenu(
            type,
            contextMenu,
            viewport,
            () => {
                setContextMenu(prev => ({ ...prev, isOpen: false }));
                onMenuClose?.();
            }
        );
    }, [handleSelectTypeFromMenu, contextMenu, viewport, setContextMenu, onMenuClose]);

    const handleToolbarAdd = useCallback((e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setContextMenu({
            isOpen: true,
            x: rect.right + 10,
            y: rect.top,
            type: 'global',
            placeAtCenter: true
        });
    }, [setContextMenu]);

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleDoubleClick,
        handleGlobalContextMenu,
        handleAddNext,
        handleGroupAddNext,
        handleNodeContextMenu,
        handleContextMenuCreateAsset,
        handleContextMenuSelect,
        handleToolbarAdd
    };
};
