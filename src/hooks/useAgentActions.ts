/**
 * useAgentActions.ts
 *
 * Processes AgentAction objects from the agent and manipulates the canvas.
 * Maps agent action types to existing App.tsx patterns for creating nodes,
 * triggering generation, etc.
 */

import React, { useCallback, useRef } from 'react';
import { NodeData, NodeType, NodeStatus, NodeGroup } from '../types';
import type { AgentAction, StoryboardData, ImageNodePlan, VideoGenerationPlan, VideoMergePlan } from './useAgentChat';

function generateUUID(): string {
    return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

interface UseAgentActionsParams {
    nodes: NodeData[];
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: (ids: string[]) => void;
    groups: NodeGroup[];
    setGroups: React.Dispatch<React.SetStateAction<NodeGroup[]>>;
    viewport: { x: number; y: number; zoom: number };
    handleGenerateRef: React.RefObject<((id: string) => void) | null>;
    getNextNodeTitle: (type: NodeType) => string;
    openVideoMergeModal?: (nodeIds: string[]) => void;
    openTTSModal?: (text?: string) => void;
}

export function useAgentActions({
    nodes,
    setNodes,
    setSelectedNodeIds,
    groups,
    setGroups,
    viewport,
    handleGenerateRef,
    getNextNodeTitle,
    openVideoMergeModal,
    openTTSModal,
}: UseAgentActionsParams) {
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;

    const executeAction = useCallback((action: AgentAction) => {
        switch (action.type) {
            case 'create_storyboard_nodes':
                return handleCreateStoryboardNodes(action.data, (action as any)._referenceUrls);
            case 'create_and_generate_images':
                return handleCreateAndGenerateImages(action.data.images, action.data.groupLabel, (action as any)._referenceUrls);
            case 'create_and_generate_videos':
                return handleCreateAndGenerateVideos(action.data);
            case 'merge_videos':
                return handleMergeVideos(action.data);
            case 'generate_tts':
                return handleGenerateTTS(action.data);
            default:
                console.warn('[AgentActions] Unknown action type:', (action as any).type);
        }
    }, []);

    const executeActions = useCallback((actions: AgentAction[]) => {
        for (const action of actions) {
            executeAction(action);
        }
    }, [executeAction]);

    // ========================================================================
    // ACTION HANDLERS
    // ========================================================================

    function handleCreateStoryboardNodes(data: StoryboardData, referenceUrls?: string[]) {
        const { scripts, styleAnchor, characterDNA } = data;

        const NODE_W = 380;
        const NODE_H = 300;
        const GAP = 40;
        const COLS = 4;
        const GROUP_GAP = 320;

        const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
        const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;

        const newGroups: NodeGroup[] = [];

        // Reference images on the LEFT, stacked vertically
        const refNodes: NodeData[] = [];
        const refNodeIds: string[] = [];
        const hasRefs = referenceUrls && referenceUrls.length > 0;
        const sceneGridW = Math.min(scripts.length, COLS) * (NODE_W + GAP) - GAP;

        if (hasRefs) {
            const refGroupId = generateUUID();
            const refCols = Math.min(referenceUrls.length, 2);
            const refX = centerX - sceneGridW / 2 - GROUP_GAP - refCols * (NODE_W + GAP);
            const refStartY = centerY - 150;
            referenceUrls.forEach((url, i) => {
                const refNode: NodeData = {
                    id: generateUUID(),
                    type: NodeType.IMAGE,
                    title: `参考图 ${i + 1}`,
                    x: refX + (i % refCols) * (NODE_W + GAP),
                    y: refStartY + Math.floor(i / refCols) * (NODE_H + GAP),
                    prompt: '',
                    status: NodeStatus.SUCCESS,
                    model: 'Upload',
                    resultUrl: url,
                    aspectRatio: '1:1',
                    resolution: 'Auto',
                    parentIds: [],
                    groupId: refGroupId,
                };
                refNodes.push(refNode);
                refNodeIds.push(refNode.id);
            });
            newGroups.push({
                id: refGroupId,
                nodeIds: refNodes.map(n => n.id),
                label: '参考图',
            });
        }

        // Scene nodes on the RIGHT in a grid
        const sceneStartX = centerX - sceneGridW / 2;
        const sceneStartY = centerY - 150;

        const storyGroupId = generateUUID();
        const newNodes: NodeData[] = scripts.map((scene, i) => {
            const charDetails = Object.entries(characterDNA || {})
                .map(([name, desc]) => `${name}: ${desc}`)
                .join('. ');

            const fullPrompt = [
                styleAnchor,
                scene.description,
                scene.cameraAngle ? `Camera: ${scene.cameraAngle}` : '',
                scene.lighting ? `Lighting: ${scene.lighting}` : '',
                scene.mood ? `Mood: ${scene.mood}` : '',
                charDetails ? `Characters: ${charDetails}` : '',
            ].filter(Boolean).join('. ');

            return {
                id: generateUUID(),
                type: NodeType.IMAGE,
                title: `Scene ${scene.sceneNumber || i + 1}`,
                x: sceneStartX + (i % COLS) * (NODE_W + GAP),
                y: sceneStartY + Math.floor(i / COLS) * (NODE_H + GAP),
                prompt: fullPrompt,
                status: NodeStatus.IDLE,
                model: 'Nano Banana Pro',
                imageModel: 'gem-3.0',
                aspectRatio: '16:9',
                resolution: 'Auto',
                parentIds: [...refNodeIds],
                groupId: storyGroupId,
            };
        });

        newGroups.push({
            id: storyGroupId,
            nodeIds: newNodes.map(n => n.id),
            label: 'AI Storyboard',
            storyContext: {
                story: '',
                scripts,
                styleAnchor,
                characterDNA,
            },
        });

        setNodes(prev => [...prev, ...refNodes, ...newNodes]);
        setGroups(prev => [...prev, ...newGroups]);
        setSelectedNodeIds(newNodes.map(n => n.id));
    }

    function handleCreateAndGenerateImages(images: ImageNodePlan[], groupLabel?: string, referenceUrls?: string[]) {
        if (!images || images.length === 0) return;

        const NODE_W = 380;
        const NODE_H = 300;
        const GAP = 40;
        const COLS = 4;
        const GROUP_GAP = 320;

        const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
        const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;

        const newGroups: NodeGroup[] = [];

        // Reference images on the LEFT, stacked vertically
        const refNodes: NodeData[] = [];
        const refNodeIds: string[] = [];
        const hasRefs = referenceUrls && referenceUrls.length > 0;
        const sceneGridW = Math.min(images.length, COLS) * (NODE_W + GAP) - GAP;

        if (hasRefs) {
            const refGroupId = generateUUID();
            const refCols = Math.min(referenceUrls.length, 2);
            const refX = centerX - sceneGridW / 2 - GROUP_GAP - refCols * (NODE_W + GAP);
            const refStartY = centerY - 150;
            referenceUrls.forEach((url, i) => {
                const refNode: NodeData = {
                    id: generateUUID(),
                    type: NodeType.IMAGE,
                    title: `参考图 ${i + 1}`,
                    x: refX + (i % refCols) * (NODE_W + GAP),
                    y: refStartY + Math.floor(i / refCols) * (NODE_H + GAP),
                    prompt: '',
                    status: NodeStatus.SUCCESS,
                    model: 'Upload',
                    resultUrl: url,
                    aspectRatio: '1:1',
                    resolution: 'Auto',
                    parentIds: [],
                    groupId: refGroupId,
                };
                refNodes.push(refNode);
                refNodeIds.push(refNode.id);
            });
            newGroups.push({
                id: refGroupId,
                nodeIds: refNodes.map(n => n.id),
                label: '参考图',
            });
        }

        // Scene nodes on the RIGHT in a grid
        const sceneStartX = centerX - sceneGridW / 2;
        const sceneStartY = centerY - 150;

        const sceneGroupId = groupLabel ? generateUUID() : undefined;
        const newNodes: NodeData[] = images.map((img, i) => ({
            id: generateUUID(),
            type: NodeType.IMAGE,
            title: img.title || `Scene ${i + 1}`,
            x: sceneStartX + (i % COLS) * (NODE_W + GAP),
            y: sceneStartY + Math.floor(i / COLS) * (NODE_H + GAP),
            prompt: img.prompt,
            status: NodeStatus.IDLE,
            model: img.model || 'chuhaibang',
            imageModel: img.model || 'chuhaibang',
            aspectRatio: img.aspectRatio || '16:9',
            resolution: 'Auto',
            parentIds: [...refNodeIds],
            groupId: sceneGroupId,
        }));

        setNodes(prev => [...prev, ...refNodes, ...newNodes]);

        if (sceneGroupId && groupLabel) {
            newGroups.push({
                id: sceneGroupId,
                label: groupLabel,
                nodeIds: newNodes.map(n => n.id),
                color: '#8B5CF6',
            });
        }

        if (newGroups.length > 0) {
            setGroups(prev => [...prev, ...newGroups]);
        }

        setSelectedNodeIds(newNodes.map(n => n.id));

        newNodes.forEach((node, i) => {
            setTimeout(() => {
                handleGenerateRef.current?.(node.id);
            }, 200 + i * 300);
        });
    }

    function handleCreateAndGenerateVideos(plan: VideoGenerationPlan) {
        const currentNodes = nodesRef.current;

        let sourceNodes: NodeData[];
        if (plan.sourceNodeIds && plan.sourceNodeIds.length > 0) {
            sourceNodes = currentNodes.filter(n =>
                plan.sourceNodeIds.includes(n.id) && n.type === NodeType.IMAGE && n.status === NodeStatus.SUCCESS
            );
        } else {
            sourceNodes = currentNodes.filter(n =>
                n.type === NodeType.IMAGE && n.status === NodeStatus.SUCCESS && n.resultUrl
            );
        }

        if (sourceNodes.length === 0) {
            console.warn('[AgentActions] No completed image nodes found for video generation');
            return;
        }

        const DEFAULT_WIDTH = 400;
        const GAP_X = 100;
        const maxX = Math.max(...sourceNodes.map(n => n.x + DEFAULT_WIDTH));
        const minX = Math.min(...sourceNodes.map(n => n.x));
        const xOffset = maxX + GAP_X - minX;

        const newNodes: NodeData[] = sourceNodes.map((sourceNode) => ({
            id: generateUUID(),
            type: NodeType.VIDEO,
            title: sourceNode.title ? `${sourceNode.title} Video` : getNextNodeTitle(NodeType.VIDEO),
            x: sourceNode.x + xOffset,
            y: sourceNode.y,
            prompt: plan.promptOverride || sourceNode.prompt || 'Animated video',
            status: NodeStatus.IDLE,
            model: plan.model || 'Kling/3.0',
            videoModel: plan.model || 'Kling/3.0',
            videoDuration: plan.duration || 5,
            aspectRatio: sourceNode.aspectRatio || '16:9',
            resolution: 'Auto',
            parentIds: [sourceNode.id],
            videoMode: 'frame-to-frame' as const,
            inputUrl: sourceNode.resultUrl,
        }));

        setNodes(prev => [...prev, ...newNodes]);
        setSelectedNodeIds(newNodes.map(n => n.id));

        setTimeout(() => {
            newNodes.forEach((node, index) => {
                setTimeout(() => {
                    handleGenerateRef.current?.(node.id);
                }, index * 1000);
            });
        }, 500);
    }

    function handleMergeVideos(plan: VideoMergePlan) {
        const currentNodes = nodesRef.current;

        let videoNodeIds: string[];
        if (plan.sourceNodeIds && plan.sourceNodeIds.length > 0) {
            videoNodeIds = plan.sourceNodeIds.filter(id => {
                const node = currentNodes.find(n => n.id === id);
                return node && node.type === NodeType.VIDEO && node.status === NodeStatus.SUCCESS;
            });
        } else {
            videoNodeIds = currentNodes
                .filter(n => n.type === NodeType.VIDEO && n.status === NodeStatus.SUCCESS && n.resultUrl)
                .map(n => n.id);
        }

        if (videoNodeIds.length < 2) {
            console.warn('[AgentActions] Need at least 2 completed video nodes to merge');
            return;
        }

        openVideoMergeModal?.(videoNodeIds);
    }

    function handleGenerateTTS(data: { text: string; voice: string | null; language: string }) {
        openTTSModal?.(data.text);
    }

    return {
        executeAction,
        executeActions,
    };
}

export default useAgentActions;
