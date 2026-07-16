/**
 * useVideoFrameExtraction.ts
 * 
 * Custom hook that automatically extracts lastFrame for video nodes
 * that have a resultUrl but no lastFrame set.
 * This ensures video thumbnails are available for motion control UI.
 */

import { useEffect, useRef } from 'react';
import { NodeData, NodeType, NodeStatus } from '../types';
import { extractVideoLastFrame } from '../utils/videoHelpers';

interface UseVideoFrameExtractionOptions {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

export const useVideoFrameExtraction = ({
    nodes,
    updateNode
}: UseVideoFrameExtractionOptions) => {
    // Track which nodes we've attempted extraction for (to avoid infinite loops)
    const extractedNodesRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        // Find video nodes with resultUrl but no lastFrame
        const videosNeedingExtraction = nodes.filter(node =>
            node.type === NodeType.VIDEO &&
            node.status === NodeStatus.SUCCESS &&
            node.resultUrl &&
            !node.lastFrame &&
            !extractedNodesRef.current.has(node.id)
        );

        if (videosNeedingExtraction.length === 0) return;

        console.log(`[VideoFrameExtraction] Found ${videosNeedingExtraction.length} video(s) needing lastFrame extraction`);

        // Extract lastFrame for each video
        videosNeedingExtraction.forEach(async (node) => {
            // Mark as being processed to avoid duplicate attempts
            extractedNodesRef.current.add(node.id);

            try {
                console.log(`[VideoFrameExtraction] Extracting lastFrame for video node ${node.id}...`);
                const lastFrame = await extractVideoLastFrame(node.resultUrl!);
                updateNode(node.id, { lastFrame });
                console.log(`[VideoFrameExtraction] Successfully extracted lastFrame for node ${node.id}`);
            } catch (error) {
                console.error(`[VideoFrameExtraction] Failed to extract lastFrame for node ${node.id}:`, error);
                // Don't remove from extractedNodesRef so we don't retry infinitely on failure
            }
        });
    }, [nodes, updateNode]);

    // Reset tracked nodes when nodes array changes drastically (new workflow loaded)
    useEffect(() => {
        const currentNodeIds = new Set(nodes.map(n => n.id));
        const trackedIds: string[] = Array.from(extractedNodesRef.current);

        // Remove tracked IDs that no longer exist in nodes
        trackedIds.forEach(id => {
            if (!currentNodeIds.has(id)) {
                extractedNodesRef.current.delete(id);
            }
        });
    }, [nodes]);
};
