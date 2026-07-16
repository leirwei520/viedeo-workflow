/**
 * useVideoEditor.ts
 * 
 * Custom hook for managing video editor modal state and handlers.
 * Handles opening/closing the editor and exporting trimmed videos to library.
 */

import { useState, useCallback } from 'react';
import { NodeData, NodeStatus } from '../types';
import { authFetch, apiEndpoint } from '../config/api';

// ============================================================================
// TYPES
// ============================================================================

interface VideoEditorModalState {
    isOpen: boolean;
    nodeId: string | null;
    videoUrl?: string;
}

interface UseVideoEditorOptions {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

// ============================================================================
// HOOK
// ============================================================================

export const useVideoEditor = ({ nodes, updateNode }: UseVideoEditorOptions) => {
    const [videoEditorModal, setVideoEditorModal] = useState<VideoEditorModalState>({
        isOpen: false,
        nodeId: null
    });

    /**
     * Open the video editor for a specific node
     * Gets video from connected parent Video node
     */
    const handleOpenVideoEditor = useCallback((nodeId: string) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Get video from parent node if connected
        let videoUrl: string | undefined;

        if (node.parentIds && node.parentIds.length > 0) {
            const parentNode = nodes.find(n => n.id === node.parentIds![0]);
            if (parentNode?.resultUrl) {
                videoUrl = parentNode.resultUrl;
            }
        }

        // Also check if the node itself has a resultUrl (from previous export)
        if (!videoUrl && node.resultUrl) {
            videoUrl = node.resultUrl;
        }

        setVideoEditorModal({
            isOpen: true,
            nodeId,
            videoUrl
        });
    }, [nodes]);

    /**
     * Close the video editor
     */
    const handleCloseVideoEditor = useCallback(() => {
        setVideoEditorModal({
            isOpen: false,
            nodeId: null
        });
    }, []);

    /**
     * Export trimmed video to library and update node
     * @param nodeId - The video editor node ID
     * @param trimStart - Trim start time in seconds
     * @param trimEnd - Trim end time in seconds
     * @param videoUrl - Original video URL
     */
    const handleExportTrimmedVideo = useCallback(async (
        nodeId: string,
        trimStart: number,
        trimEnd: number,
        videoUrl: string
    ) => {
        try {
            // Update node to loading state
            updateNode(nodeId, {
                status: NodeStatus.LOADING,
                trimStart,
                trimEnd,
                errorMessage: undefined
            });

            // Call server endpoint to trim video
            const response = await authFetch(apiEndpoint('/api/trim-video'), {
                method: 'POST',
                body: JSON.stringify({
                    videoUrl,
                    startTime: trimStart,
                    endTime: trimEnd,
                    nodeId
                })
            });

            if (!response.ok) {
                throw new Error('Failed to trim video');
            }

            const result = await response.json();

            // Update node with trimmed video URL
            updateNode(nodeId, {
                status: NodeStatus.SUCCESS,
                resultUrl: result.url,
                trimStart,
                trimEnd
            });

            // Close the editor
            handleCloseVideoEditor();

        } catch (error: any) {
            console.error('Error exporting trimmed video:', error);
            updateNode(nodeId, {
                status: NodeStatus.ERROR,
                errorMessage: error.message || 'Failed to export video'
            });
        }
    }, [updateNode, handleCloseVideoEditor]);

    return {
        videoEditorModal,
        handleOpenVideoEditor,
        handleCloseVideoEditor,
        handleExportTrimmedVideo
    };
};
