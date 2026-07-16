/**
 * useWorkflow.ts
 * 
 * Custom hook for managing workflow save/load functionality.
 * Handles persistence to the backend server.
 */

import { useState, useCallback, useRef, Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeData, NodeGroup, Viewport } from '../types';
import { API_URL, authFetch } from '../config/api';

const SESSION_KEY = 'chuhaibang_active_workflow';

interface WorkflowData {
    id: string | null;
    title: string;
    nodes: NodeData[];
    groups: NodeGroup[];
    viewport: Viewport;
}

interface UseWorkflowOptions {
    nodes: NodeData[];
    groups: NodeGroup[];
    viewport: Viewport;
    canvasTitle: string;
    setNodes: Dispatch<SetStateAction<NodeData[]>>;
    setGroups: Dispatch<SetStateAction<NodeGroup[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
    setViewport: Dispatch<SetStateAction<Viewport>>;
    setCanvasTitle: (title: string) => void;
    setEditingTitleValue: (value: string) => void;
    onPanelOpen?: () => void;
}

export const useWorkflow = ({
    nodes,
    groups,
    viewport,
    canvasTitle,
    setNodes,
    setGroups,
    setSelectedNodeIds,
    setViewport,
    setCanvasTitle,
    setEditingTitleValue,
    onPanelOpen
}: UseWorkflowOptions) => {
    const { t } = useTranslation();
    // Workflow state — initialise from sessionStorage so browser refresh reloads the same canvas
    const [workflowId, setWorkflowIdRaw] = useState<string | null>(
        () => sessionStorage.getItem(SESSION_KEY) || null
    );
    const [isWorkflowPanelOpen, setIsWorkflowPanelOpen] = useState(false);
    const [workflowPanelY, setWorkflowPanelY] = useState(0);

    // Refs to always read the latest values (avoids stale closures in setTimeout/callbacks)
    const workflowIdRef = useRef(workflowId);
    workflowIdRef.current = workflowId;
    const canvasTitleRef = useRef(canvasTitle);
    canvasTitleRef.current = canvasTitle;
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;
    const groupsRef = useRef(groups);
    groupsRef.current = groups;
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;

    const setWorkflowId = useCallback((id: string | null) => {
        setWorkflowIdRaw(id);
        if (id) {
            sessionStorage.setItem(SESSION_KEY, id);
        } else {
            sessionStorage.removeItem(SESSION_KEY);
        }
    }, []);

    /**
     * Save current workflow to server.
     * Reads from refs to guarantee fresh state even when called from stale closures.
     */
    const handleSaveWorkflow = useCallback(async (): Promise<boolean> => {
        try {
            const currentNodes = nodesRef.current;

            if (workflowIdRef.current && currentNodes.length === 0) {
                console.warn('[Workflow] Skipping save — refusing to overwrite existing workflow with empty nodes');
                return false;
            }

            const workflow: WorkflowData = {
                id: workflowIdRef.current,
                title: canvasTitleRef.current,
                nodes: currentNodes,
                groups: groupsRef.current,
                viewport: viewportRef.current
            };

            const response = await authFetch(`${API_URL}/workflows`, {
                method: 'POST',
                body: JSON.stringify(workflow)
            });

            if (response.ok) {
                const result = await response.json();
                setWorkflowId(result.id);
                console.log('Workflow saved:', result.id);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to save workflow:', error);
            return false;
        }
    }, [setWorkflowId]);

    /**
     * Load workflow from server
     * Supports both user workflows and public workflows (prefixed with "public:")
     * Returns the loaded workflow's node count and title for tracking
     */
    const handleLoadWorkflow = useCallback(async (id: string): Promise<{ nodeCount: number; title: string } | null> => {
        try {
            // Check if loading a public workflow
            const isPublic = id.startsWith('public:');
            const workflowId = isPublic ? id.replace('public:', '') : id;
            const endpoint = isPublic
                ? `${API_URL}/public-workflows/${workflowId}`
                : `${API_URL}/workflows/${workflowId}`;

            const response = await authFetch(endpoint);
            if (response.ok) {
                const workflow = await response.json();

                // For public workflows, don't set the workflowId so it saves as a new workflow
                if (!isPublic) {
                    setWorkflowId(workflow.id);
                } else {
                    setWorkflowId(null); // New copy, not linked to public workflow
                }

                setCanvasTitle(workflow.title || t('common.untitled'));
                setEditingTitleValue(workflow.title || t('common.untitled'));
                // Clean stale i18n keys from node titles
                const cleanedNodes = (workflow.nodes || []).map((node: NodeData) => {
                    if (node.title && /^(nodes|contextMenu|common)\./.test(node.title)) {
                        const { title, ...rest } = node;
                        return rest;
                    }
                    return node;
                });
                setNodes(cleanedNodes);
                setGroups(workflow.groups || []);
                setSelectedNodeIds([]);

                // Restore viewport: use saved viewport, or auto-fit to loaded nodes
                const fitToNodes = (nodeList: NodeData[]) => {
                    const nodeW = 400, nodeH = 500, padding = 80;
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (const n of nodeList) {
                        if (n.x < minX) minX = n.x;
                        if (n.y < minY) minY = n.y;
                        if (n.x + nodeW > maxX) maxX = n.x + nodeW;
                        if (n.y + nodeH > maxY) maxY = n.y + nodeH;
                    }
                    const bw = maxX - minX;
                    const bh = maxY - minY;
                    const zoom = Math.min(1, Math.min(
                        (window.innerWidth - padding * 2) / bw,
                        (window.innerHeight - padding * 2) / bh
                    ));
                    const cx = minX + bw / 2;
                    const cy = minY + bh / 2;
                    return { x: window.innerWidth / 2 - cx * zoom, y: window.innerHeight / 2 - cy * zoom, zoom };
                };

                if (workflow.viewport && typeof workflow.viewport.x === 'number' && cleanedNodes.length > 0) {
                    const vp = workflow.viewport;
                    const nodeW = 400, nodeH = 500, margin = 200;
                    const anyVisible = cleanedNodes.some((n: NodeData) => {
                        const sx = n.x * vp.zoom + vp.x;
                        const sy = n.y * vp.zoom + vp.y;
                        const sr = (n.x + nodeW) * vp.zoom + vp.x;
                        const sb = (n.y + nodeH) * vp.zoom + vp.y;
                        return sr > -margin && sx < window.innerWidth + margin
                            && sb > -margin && sy < window.innerHeight + margin;
                    });
                    setViewport(anyVisible ? vp : fitToNodes(cleanedNodes));
                } else if (workflow.viewport && typeof workflow.viewport.x === 'number') {
                    setViewport(workflow.viewport);
                } else if (cleanedNodes.length > 0) {
                    setViewport(fitToNodes(cleanedNodes));
                }
                setIsWorkflowPanelOpen(false);
                console.log(isPublic ? 'Public workflow loaded:' : 'Workflow loaded:', workflowId);
                // Return info for tracking
                return {
                    nodeCount: (workflow.nodes || []).length,
                    title: workflow.title || t('common.untitled')
                };
            }
        } catch (error) {
            console.error('Failed to load workflow:', error);
        }
        return null;
    }, [setNodes, setGroups, setSelectedNodeIds, setViewport, setCanvasTitle, setEditingTitleValue]);

    /**
     * Handle workflow panel toggle from toolbar click
     */
    const handleWorkflowsClick = useCallback((e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setWorkflowPanelY(rect.top);
        setIsWorkflowPanelOpen(prev => !prev);
        onPanelOpen?.(); // Close other panels
    }, [onPanelOpen]);

    /**
     * Close workflow panel
     */
    const closeWorkflowPanel = useCallback(() => {
        setIsWorkflowPanelOpen(false);
    }, []);

    /**
     * Reset workflow ID (for creating a new canvas)
     */
    const resetWorkflowId = useCallback(() => {
        setWorkflowId(null);
    }, []);

    return {
        workflowId,
        setWorkflowId,
        isWorkflowPanelOpen,
        workflowPanelY,
        handleSaveWorkflow,
        handleLoadWorkflow,
        handleWorkflowsClick,
        closeWorkflowPanel,
        resetWorkflowId
    };
};
