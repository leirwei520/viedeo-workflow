/**
 * useGenerationRecovery.ts
 * 
 * Custom hook that checks for nodes in 'loading' status and polls
 * the backend to see if their generation has finished.
 */

import { useEffect, useCallback, useRef } from 'react';
import { NodeData, NodeStatus } from '../types';
import { extractVideoLastFrame } from '../utils/videoHelpers';
import { apiEndpoint, authFetch } from '../config/api';

interface UseGenerationRecoveryOptions {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

export const useGenerationRecovery = ({
    nodes,
    updateNode
}: UseGenerationRecoveryOptions) => {
    // Use a ref to access current nodes without causing re-renders
    const nodesRef = useRef<NodeData[]>(nodes);
    nodesRef.current = nodes;

    const checkStatus = useCallback(async (nodeId: string) => {
        try {
            const response = await authFetch(apiEndpoint(`/generation-status/${nodeId}`));
            if (response.ok) {
                const data = await response.json();

                // Task still in queue or being processed — keep polling
                if (data.status === 'queued' || data.status === 'processing') {
                    return;
                }

                // Task failed in the worker
                if (data.status === 'failed') {
                    const node = nodesRef.current.find(n => n.id === nodeId);

                    // Guard: if a new generation just started (< 15s), this failure
                    // is almost certainly from the previous attempt — skip it.
                    if (node?.status === NodeStatus.LOADING
                        && node.generationStartTime
                        && Date.now() - node.generationStartTime < 5_000) {
                        return;
                    }

                    // Guard: skip stale failures from a previous generation
                    if (node?.generationStartTime && data.createdAt) {
                        const failedAt = typeof data.createdAt === 'number'
                            ? data.createdAt
                            : new Date(data.createdAt).getTime();
                        if (failedAt < node.generationStartTime) {
                            return;
                        }
                    }
                    updateNode(nodeId, {
                        status: NodeStatus.ERROR,
                        errorMessage: data.error || 'Generation failed',
                        generationStartTime: undefined,
                    });
                    return;
                }

                if (data.status === 'success' && data.resultUrl) {
                    const node = nodesRef.current.find(n => n.id === nodeId);

                    const MAX_GENERATION_MS = 10 * 60 * 1000;
                    const stuckTooLong = node?.generationStartTime && (Date.now() - node.generationStartTime > MAX_GENERATION_MS);

                    if (!stuckTooLong && node?.generationStartTime && data.createdAt) {
                        const CLOCK_TOLERANCE_MS = 60_000;
                        const resultCreatedAt = new Date(data.createdAt).getTime();
                        if (resultCreatedAt < node.generationStartTime - CLOCK_TOLERANCE_MS) {
                            return;
                        }
                    }

                    const resultUrl = `${data.resultUrl}${data.resultUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;

                    updateNode(nodeId, {
                        status: NodeStatus.SUCCESS,
                        resultUrl,
                        errorMessage: undefined,
                        generationStartTime: undefined,
                    });

                    if (data.type === 'video') {
                        const extras: Partial<NodeData> = {};
                        try {
                            const v = document.createElement('video');
                            await new Promise<void>((r) => {
                                v.onloadedmetadata = () => {
                                    extras.resultAspectRatio = `${v.videoWidth}/${v.videoHeight}`;
                                    r();
                                };
                                v.onerror = () => r();
                                v.src = resultUrl;
                            });
                        } catch { /* ignore */ }
                        try { extras.lastFrame = await extractVideoLastFrame(resultUrl); } catch { /* ignore */ }
                        if (Object.keys(extras).length > 0) updateNode(nodeId, extras);
                    }
                }
            }
        } catch (error) {
            console.error(`[Recovery] Error checking status for node ${nodeId}:`, error);
        }
    }, [updateNode]);

    const RECOVERY_WINDOW_MS = 10 * 60 * 1000;
    const MAX_LOADING_POLL_MS = 15 * 60 * 1000;
    const recoverableNodeIds = nodes
        .filter(n => {
            if (n.status === NodeStatus.LOADING) {
                if (n.generationStartTime && Date.now() - n.generationStartTime > MAX_LOADING_POLL_MS) {
                    return false;
                }
                return true;
            }
            if (n.status === NodeStatus.ERROR && n.generationStartTime) {
                return Date.now() - n.generationStartTime < RECOVERY_WINDOW_MS;
            }
            return false;
        })
        .map(n => n.id)
        .join(',');

    // Auto-timeout LOADING nodes that have been polling too long
    useEffect(() => {
        nodes.forEach(n => {
            if (n.status === NodeStatus.LOADING && n.generationStartTime
                && Date.now() - n.generationStartTime > MAX_LOADING_POLL_MS) {
                updateNode(n.id, {
                    status: NodeStatus.ERROR,
                    errorMessage: '生成超时，请重试',
                    generationStartTime: undefined,
                });
            }
        });
    }, [nodes, updateNode]);

    useEffect(() => {
        if (!recoverableNodeIds) return;

        const nodeIds = recoverableNodeIds.split(',');

        const checkAll = () => {
            nodeIds.forEach(nodeId => checkStatus(nodeId));
        };

        // Delay the first check to avoid racing with in-flight generation
        // requests that haven't reached the server yet.
        const initialTimer = setTimeout(checkAll, 5_000);
        const interval = setInterval(checkAll, 10_000);

        return () => {
            clearTimeout(initialTimer);
            clearInterval(interval);
        };
    }, [recoverableNodeIds, checkStatus]);
};

