/**
 * useNodeManagement.ts
 * 
 * Custom hook for managing node state and operations.
 * Handles node creation, updates, selection, and deletion.
 */

import { useState, useCallback, useRef } from 'react';
import { NodeData, NodeType, NodeStatus, Viewport } from '../types';
import { generateUUID } from '../utils/uuid';

const NODE_TYPE_LABELS: Record<string, string> = {
    [NodeType.IMAGE]: '图片',
    [NodeType.VIDEO]: '视频',
    [NodeType.TEXT]: '文本',
    [NodeType.AUDIO]: '音频',
    [NodeType.IMAGE_EDITOR]: '图片编辑',
    [NodeType.VIDEO_EDITOR]: '视频编辑',
    [NodeType.STORYBOARD]: '分镜',
    [NodeType.CAMERA_ANGLE]: '机位',
    [NodeType.LOCAL_IMAGE_MODEL]: '本地图片',
    [NodeType.LOCAL_VIDEO_MODEL]: '本地视频',
};

export const useNodeManagement = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [nodes, setNodes] = useState<NodeData[]>([]);
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    /**
     * Generate a numbered title for a new node based on existing nodes of the same type.
     * e.g. "图片 1", "图片 2", "视频 1"
     */
    const getNextNodeTitle = useCallback((type: NodeType, currentNodes?: NodeData[]): string => {
        const label = NODE_TYPE_LABELS[type] || type;
        const all = currentNodes || nodesRef.current;
        const re = new RegExp(`^${label}\\s*(\\d+)$`);
        let max = 0;
        for (const n of all) {
            if (n.type !== type) continue;
            const m = n.title?.match(re);
            if (m) max = Math.max(max, parseInt(m[1], 10));
            else if (!n.title || n.title === label) max = Math.max(max, 0);
        }
        return `${label} ${max + 1}`;
    }, []);

    /**
     * Adds a new node to the canvas
     */
    const addNode = (
        type: NodeType,
        x: number,
        y: number,
        parentId: string | undefined,
        viewport: Viewport
    ) => {
        const canvasX = (x - viewport.x) / viewport.zoom;
        const canvasY = (y - viewport.y) / viewport.zoom;

        const isVideo = type === NodeType.VIDEO || type === NodeType.LOCAL_VIDEO_MODEL;
        
        const newNode: NodeData = {
            id: generateUUID(),
            type,
            title: getNextNodeTitle(type),
            x: parentId ? canvasX : canvasX - 170,
            y: parentId ? canvasY : canvasY - 100,
            prompt: '',
            status: NodeStatus.IDLE,
            model: isVideo ? 'Seedance/2.0' : 'GEM 3.0',
            videoModel: isVideo ? 'Seedance/2.0' : undefined,
            videoDuration: isVideo ? 5 : undefined,
            aspectRatio: '16:9',
            resolution: isVideo ? '1080p' : 'Auto',
            parentIds: parentId ? [parentId] : []
        };

        setNodes(prev => [...prev, newNode]);
        setSelectedNodeIds([newNode.id]);

        return newNode.id;
    };

    /**
     * Updates a node with partial data
     * @param id - Node ID to update
     * @param updates - Partial node data to merge
     */
    const updateNode = (id: string, updates: Partial<NodeData>) => {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
    };

    /**
     * Deletes a node by ID
     * @param id - Node ID to delete
     */
    const deleteNode = (id: string) => {
        setNodes(prev => prev.filter(n => n.id !== id));
        setSelectedNodeIds(prev => prev.filter(nodeId => nodeId !== id));
    };

    /**
     * Deletes multiple nodes by IDs
     * @param ids - Array of node IDs to delete
     */
    const deleteNodes = (ids: string[]) => {
        setNodes(prev => prev.filter(n => !ids.includes(n.id)));
        setSelectedNodeIds([]);
    };

    /**
     * Clears all node selections
     */
    const clearSelection = () => {
        setSelectedNodeIds([]);
    };

    /**
     * Handles node type selection from context menu
     * Creates new node or deletes existing node
     */
    const handleSelectTypeFromMenu = (
        type: NodeType | 'DELETE',
        contextMenu: any,
        viewport: Viewport,
        onCloseMenu: () => void
    ) => {
        // Handle Delete Action
        if (type === 'DELETE') {
            if (contextMenu.sourceNodeId) {
                deleteNode(contextMenu.sourceNodeId);
            }
            onCloseMenu();
            return;
        }

        if (contextMenu.type === 'node-connector' && contextMenu.sourceNodeId) {
            const sourceNode = nodes.find(n => n.id === contextMenu.sourceNodeId);
            if (sourceNode) {
                const direction = contextMenu.connectorSide || 'right';
                const newNodeId = generateUUID();
                const NODE_WIDTH = 340;

                let newNode: NodeData;

                const isVideo = type === NodeType.VIDEO || type === NodeType.LOCAL_VIDEO_MODEL;

                const canvasX = (contextMenu.x - viewport.x) / viewport.zoom - NODE_WIDTH / 2;
                const canvasY = (contextMenu.y - viewport.y) / viewport.zoom - 200;

                const title = getNextNodeTitle(type);
                if (direction === 'right') {
                    newNode = {
                        id: newNodeId,
                        type,
                        title,
                        x: canvasX,
                        y: canvasY,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: isVideo ? 'Seedance/2.0' : 'GEM 3.0',
                        videoModel: isVideo ? 'Seedance/2.0' : undefined,
                        videoDuration: isVideo ? 5 : undefined,
                        aspectRatio: '16:9',
                        resolution: isVideo ? '1080p' : 'Auto',
                        parentIds: [contextMenu.sourceNodeId]
                    };
                } else {
                    newNode = {
                        id: newNodeId,
                        type,
                        title,
                        x: canvasX,
                        y: canvasY,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: isVideo ? 'Seedance/2.0' : 'GEM 3.0',
                        videoModel: isVideo ? 'Seedance/2.0' : undefined,
                        videoDuration: isVideo ? 5 : undefined,
                        aspectRatio: '16:9',
                        resolution: isVideo ? '1080p' : 'Auto',
                        parentIds: []
                    };
                    const existingParentIds = sourceNode.parentIds || [];
                    updateNode(contextMenu.sourceNodeId, { parentIds: [...existingParentIds, newNodeId] });
                }

                setNodes(prev => [...prev, newNode]);
                setSelectedNodeIds([newNodeId]);
            }
        } else if (contextMenu.type === 'group-connector' && contextMenu.sourceGroupNodeIds?.length) {
            const groupNodeIds: string[] = contextMenu.sourceGroupNodeIds;
            const direction = contextMenu.connectorSide || 'right';
            const groupNodes = nodes.filter(n => groupNodeIds.includes(n.id));
            if (groupNodes.length > 0) {
                const newNodeId = generateUUID();
                const NODE_WIDTH = 340;
                const isVideo = type === NodeType.VIDEO || type === NodeType.LOCAL_VIDEO_MODEL;

                const canvasX = (contextMenu.x - viewport.x) / viewport.zoom - NODE_WIDTH / 2;
                const canvasY = (contextMenu.y - viewport.y) / viewport.zoom - 200;

                const title = getNextNodeTitle(type);
                let newNode: NodeData;
                if (direction === 'right') {
                    newNode = {
                        id: newNodeId,
                        type,
                        title,
                        x: canvasX,
                        y: canvasY,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: isVideo ? 'Seedance/2.0' : 'GEM 3.0',
                        videoModel: isVideo ? 'Seedance/2.0' : undefined,
                        videoDuration: isVideo ? 5 : undefined,
                        aspectRatio: '16:9',
                        resolution: isVideo ? '1080p' : 'Auto',
                        parentIds: [...groupNodeIds]
                    };
                } else {
                    newNode = {
                        id: newNodeId,
                        type,
                        title,
                        x: canvasX,
                        y: canvasY,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: isVideo ? 'Seedance/2.0' : 'GEM 3.0',
                        videoModel: isVideo ? 'Seedance/2.0' : undefined,
                        videoDuration: isVideo ? 5 : undefined,
                        aspectRatio: '16:9',
                        resolution: isVideo ? '1080p' : 'Auto',
                        parentIds: []
                    };
                    setNodes(prev => prev.map(n => {
                        if (groupNodeIds.includes(n.id)) {
                            const existing = n.parentIds || [];
                            if (!existing.includes(newNodeId)) {
                                return { ...n, parentIds: [...existing, newNodeId] };
                            }
                        }
                        return n;
                    }));
                }

                setNodes(prev => [...prev, newNode]);
                setSelectedNodeIds([newNodeId]);
            }
        } else {
            const cx = contextMenu.placeAtCenter ? window.innerWidth / 2 : contextMenu.x;
            const cy = contextMenu.placeAtCenter ? window.innerHeight / 2 : contextMenu.y;
            addNode(type, cx, cy, undefined, viewport);
        }

        onCloseMenu();
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        nodes,
        setNodes,
        selectedNodeIds,
        setSelectedNodeIds,
        addNode,
        updateNode,
        deleteNode,
        deleteNodes,
        clearSelection,
        handleSelectTypeFromMenu,
        getNextNodeTitle
    };
};
