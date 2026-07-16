/**
 * useImageNodeHandlers.ts
 * 
 * Handles Image node menu actions (Image to Image, Image to Video, Change Angle, Three-View).
 * Creates connected nodes when users select these options from the placeholder.
 */

import React from 'react';
import { NodeData, NodeType, NodeStatus } from '../types';
import { generateCameraAngle } from '../services/cameraAngleService';
import { generateUUID } from '../utils/uuid';

export interface ThreeViewGenerateOptions {
    style: 'original' | 'realistic' | 'anime' | 'illustration' | 'pixel';
    framing: 'fullBody' | 'upperBody' | 'headshot';
}

const STYLE_PROMPTS: Record<ThreeViewGenerateOptions['style'], string> = {
    original: '保持与原图完全一致的画风、材质、渲染风格（如原图是写实3D则必须是写实3D，不要变成卡通或动漫风格）',
    realistic: '写实3D渲染风格，高精度材质纹理，真实光影效果，照片级质感',
    anime: '日系动漫赛璐璐风格，清晰的线条，平涂上色，明亮的色彩',
    illustration: '手绘插画风格，柔和笔触，艺术质感，精致的手绘细节',
    pixel: '像素风格，清晰的像素边缘，复古游戏美术风格',
};

const FRAMING_PROMPTS: Record<ThreeViewGenerateOptions['framing'], string> = {
    fullBody: '全身像，从头到脚完整展示',
    upperBody: '半身像，从头到腰部展示',
    headshot: '头部特写，展示面部和头发细节',
};

function buildThreeViewPrompt(options: ThreeViewGenerateOptions): string {
    return `根据这张图片生成三视图参考图。严格要求：
1. ${STYLE_PROMPTS[options.style]}
2. ${FRAMING_PROMPTS[options.framing]}
3. 纯白背景(#FFFFFF)，无噪点、无阴影、无多余元素、无文字
4. 水平排列三个视角：正面（居中）、侧面（左）、背面（右）
5. 三个视角比例一致、大小相同，专业角色转面图风格
6. 均匀柔和的工作室灯光，干净的线条`;
}

// ============================================================================
// TYPES
// ============================================================================

interface UseImageNodeHandlersOptions {
    nodes: NodeData[];
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    onGenerateNode?: (nodeId: string) => void;
}

// ============================================================================
// HOOK
// ============================================================================

export const useImageNodeHandlers = ({
    nodes,
    setNodes,
    setSelectedNodeIds,
    onGenerateNode
}: UseImageNodeHandlersOptions) => {
    const pendingGenerateRef = React.useRef<string | null>(null);
    const nodesRef = React.useRef(nodes);
    nodesRef.current = nodes;

    React.useEffect(() => {
        if (!pendingGenerateRef.current || !onGenerateNode) return;
        const pendingId = pendingGenerateRef.current;
        if (nodesRef.current.some(n => n.id === pendingId)) {
            pendingGenerateRef.current = null;
            onGenerateNode(pendingId);
        }
    }, [nodes, onGenerateNode]);
    /**
     * Handle "Image to Image" - creates a new Image node connected to this Image node
     * The current node becomes the input (parent) for the new Image node
     */
    const handleImageToImage = (nodeId: string) => {
        const imageNode = nodes.find(n => n.id === nodeId);
        if (!imageNode) return;

        // Create Image node to the right
        const newNodeId = generateUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;

        const newImageNode: NodeData = {
            id: newNodeId,
            type: NodeType.IMAGE,
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            prompt: '',
            status: NodeStatus.IDLE,
            model: 'GEM 3.0',
            aspectRatio: 'Auto',
            resolution: 'Auto',
            parentIds: [nodeId] // Connect to the source image node
        };

        // Add new image node
        setNodes(prev => [...prev, newImageNode]);
        setSelectedNodeIds([newNodeId]);
    };

    /**
     * Handle "Image to Video" - creates a new Video node connected to this Image node
     * The current node becomes the input frame for the new Video node
     */
    const handleImageToVideo = (nodeId: string) => {
        const imageNode = nodes.find(n => n.id === nodeId);
        if (!imageNode) return;

        // Create Video node to the right
        const newNodeId = generateUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;

        const newVideoNode: NodeData = {
            id: newNodeId,
            type: NodeType.VIDEO,
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            prompt: '',
            status: NodeStatus.IDLE,
            model: 'Seedance/2.0',
            videoModel: 'Seedance/2.0',
            aspectRatio: '16:9',
            resolution: '1080p',
            videoDuration: 5,
            parentIds: [nodeId] // Connect to the source image node
        };

        // Add new video node
        setNodes(prev => [...prev, newVideoNode]);
        setSelectedNodeIds([newNodeId]);
    };

    /**
     * Handle "Change Angle Generate" - calls Modal Camera Angle API
     * Creates a new Image node with the transformed result
     */
    const handleChangeAngleGenerate = React.useCallback(async (nodeId: string) => {
        const imageNode = nodes.find(n => n.id === nodeId);
        if (!imageNode || !imageNode.angleSettings || !imageNode.resultUrl) {
            console.error('[ChangeAngle] Missing required data:', {
                hasNode: !!imageNode,
                hasSettings: !!imageNode?.angleSettings,
                hasResultUrl: !!imageNode?.resultUrl
            });
            return;
        }

        // Create Image node to the right
        const newNodeId = generateUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;

        // Create placeholder node in LOADING state
        const newImageNode: NodeData = {
            id: newNodeId,
            type: NodeType.CAMERA_ANGLE,
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            // Prompt is stored for reference but not displayed in the specialized node
            prompt: `Camera angle: rotation=${imageNode.angleSettings.rotation}°, tilt=${imageNode.angleSettings.tilt}°`,
            status: NodeStatus.LOADING,
            model: 'Qwen Camera Angle',
            imageModel: 'qwen-camera-angle',
            aspectRatio: imageNode.aspectRatio || 'Auto',
            resolution: imageNode.resolution || 'Auto',
            parentIds: [nodeId], // Connect to source

            // Persist angle settings to the new node so controls can be re-opened with same state
            angleSettings: imageNode.angleSettings,
            angleMode: false
        };

        // Add new node and close angle mode on source
        setNodes(prev => [
            ...prev.map(n => n.id === nodeId ? { ...n, angleMode: false } : n),
            newImageNode
        ]);
        setSelectedNodeIds([newNodeId]);

        // Call Modal API
        try {
            console.log('[ChangeAngle] Calling Modal API with settings:', imageNode.angleSettings);

            const result = await generateCameraAngle(
                imageNode.resultUrl,
                imageNode.angleSettings.rotation,
                imageNode.angleSettings.tilt,
                imageNode.angleSettings.scale
            );

            console.log('[ChangeAngle] API success:', {
                seed: result.seed,
                inferenceTimeMs: result.inferenceTimeMs
            });

            // Update node with result
            setNodes(prev => prev.map(n =>
                n.id === newNodeId
                    ? {
                        ...n,
                        status: NodeStatus.SUCCESS,
                        resultUrl: result.imageUrl,
                        seed: result.seed
                    }
                    : n
            ));
        } catch (error: any) {
            console.error('[ChangeAngle] API error:', error);

            // Update node with error
            setNodes(prev => prev.map(n =>
                n.id === newNodeId
                    ? {
                        ...n,
                        status: NodeStatus.ERROR,
                        errorMessage: error.message || 'Camera angle generation failed'
                    }
                    : n
            ));
        }
    }, [nodes, setNodes, setSelectedNodeIds]);

    /**
     * Handle "Three-View Generate" — creates a new Image node with a three-view prompt
     * and auto-triggers generation using the source image as reference.
     */
    const handleThreeViewGenerate = React.useCallback((nodeId: string, options: ThreeViewGenerateOptions) => {
        const imageNode = nodesRef.current.find(n => n.id === nodeId);
        if (!imageNode || !imageNode.resultUrl) return;

        const newNodeId = generateUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;

        const newImageNode: NodeData = {
            id: newNodeId,
            type: NodeType.IMAGE,
            title: '三视图',
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            prompt: buildThreeViewPrompt(options),
            status: NodeStatus.IDLE,
            model: 'ChuHaiBang',
            imageModel: 'chuhaibang',
            aspectRatio: '16:9',
            resolution: '2K',
            parentIds: [nodeId],
            hideControls: true,
        };

        pendingGenerateRef.current = newNodeId;
        setNodes(prev => [...prev, newImageNode]);
        setSelectedNodeIds([newNodeId]);
    }, [setNodes, setSelectedNodeIds]);

    return {
        handleImageToImage,
        handleImageToVideo,
        handleChangeAngleGenerate,
        handleThreeViewGenerate
    };
};
