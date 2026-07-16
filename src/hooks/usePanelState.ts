/**
 * usePanelState.ts
 * 
 * Manages state and handlers for various UI panels.
 * Self-contained - no external dependencies on other close functions.
 */

import React, { useState, useCallback } from 'react';

export const usePanelState = () => {
    // ============================================================================
    // HISTORY PANEL
    // ============================================================================

    const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
    const [historyPanelY, setHistoryPanelY] = useState(0);

    const closeHistoryPanel = useCallback(() => setIsHistoryPanelOpen(false), []);

    // ============================================================================
    // FULLSCREEN IMAGE PREVIEW
    // ============================================================================

    const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);

    const handleExpandImage = useCallback((imageUrl: string) => setExpandedImageUrl(imageUrl), []);
    const handleCloseExpand = useCallback(() => setExpandedImageUrl(null), []);

    // ============================================================================
    // CHAT PANEL
    // ============================================================================

    const [isChatOpen, setIsChatOpen] = useState(false);

    const toggleChat = useCallback(() => setIsChatOpen(prev => !prev), []);
    const closeChat = useCallback(() => setIsChatOpen(false), []);

    // ============================================================================
    // ASSET LIBRARY PANEL
    // ============================================================================

    const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
    const [assetLibraryY, setAssetLibraryY] = useState(0);
    const [assetLibraryVariant, setAssetLibraryVariant] = useState<'panel' | 'modal'>('panel');

    const closeAssetLibrary = useCallback(() => setIsAssetLibraryOpen(false), []);

    // ============================================================================
    // NODE DRAG STATE (for chat highlight)
    // ============================================================================

    const [isDraggingNodeToChat, setIsDraggingNodeToChat] = useState(false);

    const handleNodeDragStart = useCallback((_nodeId: string, hasContent: boolean) => {
        if (hasContent) {
            setIsDraggingNodeToChat(true);
        }
    }, []);

    const handleNodeDragEnd = useCallback(() => {
        setIsDraggingNodeToChat(false);
    }, []);

    // ============================================================================
    // COMBINED HANDLERS (use these in App.tsx to handle mutual exclusivity)
    // ============================================================================

    /**
     * Opens history panel and closes others
     */
    const handleHistoryClick = useCallback((e: React.MouseEvent, closeWorkflowPanel: () => void) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setHistoryPanelY(rect.top);
        setIsHistoryPanelOpen(prev => !prev);
        closeWorkflowPanel();
        setIsAssetLibraryOpen(false);
        setIsChatOpen(false);
    }, []);

    /**
     * Opens asset library panel and closes others
     */
    const handleAssetsClick = useCallback((e: React.MouseEvent, closeWorkflowPanel: () => void) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setAssetLibraryY(rect.top);
        setAssetLibraryVariant('panel');
        setIsAssetLibraryOpen(prev => !prev);
        setIsHistoryPanelOpen(false);
        closeWorkflowPanel();
        setIsChatOpen(false);
    }, []);

    /**
     * Opens asset library as modal (from context menu)
     */
    const openAssetLibraryModal = useCallback((y: number, closeWorkflowPanel: () => void) => {
        setAssetLibraryY(y);
        setAssetLibraryVariant('modal');
        setIsAssetLibraryOpen(true);
        setIsHistoryPanelOpen(false);
        closeWorkflowPanel();
        setIsChatOpen(false);
    }, []);

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        // History panel
        isHistoryPanelOpen,
        historyPanelY,
        handleHistoryClick,
        closeHistoryPanel,

        // Fullscreen image
        expandedImageUrl,
        handleExpandImage,
        handleCloseExpand,

        // Chat
        isChatOpen,
        toggleChat,
        closeChat,

        // Asset library
        isAssetLibraryOpen,
        assetLibraryY,
        assetLibraryVariant,
        handleAssetsClick,
        closeAssetLibrary,
        openAssetLibraryModal,

        // Node drag
        isDraggingNodeToChat,
        handleNodeDragStart,
        handleNodeDragEnd
    };
};
