/**
 * useGeneration.ts
 * 
 * Custom hook for handling AI content generation (images and videos).
 * Manages generation state, API calls, and error handling.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { NodeData, NodeType, NodeStatus } from '../types';
import { generateImage, generateVideo, QUEUED } from '../services/generationService';
import { generateLocalImage } from '../services/localModelService';
import { apiEndpoint, assetUrl, authFetch } from '../config/api';
import { VIDEO_MODELS } from '../components/canvas/NodeControls';
import { extractVideoLastFrame } from '../utils/videoHelpers';
import { sanitizeError } from '../utils/errorSanitizer';

const OFFLINE_QUEUE_KEY = 'chuhaibang_offline_queue';

interface QueuedGeneration {
    nodeId: string;
    timestamp: number;
}

function getOfflineQueue(): QueuedGeneration[] {
    try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch { return []; }
}

function saveOfflineQueue(queue: QueuedGeneration[]) {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

interface UseGenerationProps {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

export const useGeneration = ({ nodes, updateNode }: UseGenerationProps) => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;

    const processOfflineQueue = useCallback(() => {
        const queue = getOfflineQueue();
        if (queue.length === 0) return;
        const remaining = [...queue];
        const currentNodes = nodesRef.current;
        for (const item of queue) {
            const node = currentNodes.find(n => n.id === item.nodeId);
            if (node && (node.status === NodeStatus.ERROR || node.status === NodeStatus.LOADING)) {
                handleGenerate(item.nodeId);
                const idx = remaining.indexOf(item);
                if (idx !== -1) remaining.splice(idx, 1);
            }
        }
        saveOfflineQueue(remaining);
    }, []);

    useEffect(() => {
        const goOnline = () => {
            setIsOnline(true);
            processOfflineQueue();
        };
        const goOffline = () => setIsOnline(false);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);

        // Periodically check server reachability and retry queued items.
        // The browser `online` event only fires for real network changes,
        // not when a local server comes back up.
        const checkServer = async () => {
            const queue = getOfflineQueue();
            if (queue.length === 0) return;
            try {
                const res = await fetch(apiEndpoint('/settings'), {
                    method: 'GET',
                    signal: AbortSignal.timeout(5000)
                });
                if (res.ok) processOfflineQueue();
            } catch { /* server still unreachable */ }
        };
        const intervalId = setInterval(checkServer, 15_000);

        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
            clearInterval(intervalId);
        };
    }, [processOfflineQueue]);
    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Convert pixel dimensions to closest standard aspect ratio
     */
    const getClosestAspectRatio = (width: number, height: number): string => {
        const ratio = width / height;
        const standardRatios = [
            { label: '1:1', value: 1 },
            { label: '16:9', value: 16 / 9 },
            { label: '9:16', value: 9 / 16 },
            { label: '4:3', value: 4 / 3 },
            { label: '3:4', value: 3 / 4 },
            { label: '3:2', value: 3 / 2 },
            { label: '2:3', value: 2 / 3 },
            { label: '5:4', value: 5 / 4 },
            { label: '4:5', value: 4 / 5 },
            { label: '21:9', value: 21 / 9 }
        ];

        let closest = standardRatios[0];
        let minDiff = Math.abs(ratio - closest.value);

        for (const r of standardRatios) {
            const diff = Math.abs(ratio - r.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = r;
            }
        }

        return closest.label;
    };

    /**
     * Ensure an image URL is sendable to the server.
     * /library/ paths may not exist on disk, so fetch via browser (which may have cache)
     * and convert to base64. OSS / data URLs pass through unchanged.
     */
    const ensureSendableUrl = async (url: string): Promise<string> => {
        if (!url) return url;
        if (url.startsWith('data:')) return url;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            if (!url.includes('/library/')) return url;
        }
        try {
            const fullUrl = assetUrl(url);
            const resp = await fetch(fullUrl);
            if (!resp.ok) return url;
            const blob = await resp.blob();
            return await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = () => resolve(url);
                reader.readAsDataURL(blob);
            });
        } catch {
            return url;
        }
    };

    /**
     * Detect the actual aspect ratio of an image
     * @param imageUrl - URL or base64 of the image
     * @returns Promise with resultAspectRatio (exact) and aspectRatio (closest standard)
     */
    const getImageAspectRatio = (imageUrl: string): Promise<{ resultAspectRatio: string; aspectRatio: string }> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
                const aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
                resolve({ resultAspectRatio, aspectRatio });
            };
            img.onerror = () => {
                resolve({ resultAspectRatio: '16/9', aspectRatio: '16:9' });
            };
            img.src = imageUrl;
        });
    };

    // ============================================================================
    // GENERATION HANDLER
    // ============================================================================

    /**
     * Handles content generation for a node
     * Supports image and video generation with parent node chaining
     * 
     * @param id - ID of the node to generate content for
     */
    const handleGenerate = async (id: string) => {
        const currentNodes = nodesRef.current;
        const node = currentNodes.find(n => n.id === id);
        if (!node) return;

        // Get prompts from connected TEXT nodes (if any)
        const getTextNodePrompts = (): string[] => {
            if (!node.parentIds) return [];
            return node.parentIds
                .map(pid => currentNodes.find(n => n.id === pid))
                .filter(n => n?.type === NodeType.TEXT && n.prompt)
                .map(n => n!.prompt);
        };

        // Combine prompts: TEXT node prompts + node's own prompt
        const textNodePrompts = getTextNodePrompts();
        const combinedPrompt = [...textNodePrompts, node.prompt].filter(Boolean).join('\n\n');

        // Check if prompt is required
        // For Kling frame-to-frame with both start and end frames, prompt is optional
        const isKlingFrameToFrame =
            node.type === NodeType.VIDEO &&
            node.videoModel?.startsWith('kling-') &&
            (node.parentIds && node.parentIds.length >= 2);

        if (!combinedPrompt && !isKlingFrameToFrame) {
            updateNode(id, {
                status: NodeStatus.ERROR,
                errorMessage: '请输入提示词后再生成'
            });
            return;
        }

        updateNode(id, { status: NodeStatus.LOADING, generationStartTime: Date.now(), errorMessage: undefined });

        try {
            if (node.type === NodeType.IMAGE || node.type === NodeType.IMAGE_EDITOR) {
                // Collect ALL parent images for multi-input generation
                const imageBase64s: string[] = [];

                // Get images from all direct parents (excluding TEXT nodes)
                if (node.parentIds && node.parentIds.length > 0) {
                    for (const parentId of node.parentIds) {
                        let currentId: string | undefined = parentId;

                        // Traverse up the chain to find an image source (skip TEXT nodes)
                        while (currentId && imageBase64s.length < 14) { // Gemini 3 Pro limit
                            const parent = currentNodes.find(n => n.id === currentId);
                            // Skip TEXT nodes - they provide prompts, not images
                            if (parent?.type === NodeType.TEXT) {
                                break;
                            }
                            if (parent?.resultUrl) {
                                imageBase64s.push(parent.resultUrl);
                                break; // Found image for this parent chain
                            } else {
                                // Continue up this chain
                                currentId = parent?.parentIds?.[0];
                            }
                        }
                    }
                }

                // No parent images found — use the node's own result as reference for regeneration
                if (imageBase64s.length === 0 && node.resultUrl) {
                    imageBase64s.push(node.resultUrl);
                }

                // Add character reference URLs from storyboard nodes (for maintaining character consistency)
                if (node.characterReferenceUrls && node.characterReferenceUrls.length > 0) {
                    for (const charUrl of node.characterReferenceUrls) {
                        if (imageBase64s.length < 14) { // Respect Gemini's limit
                            imageBase64s.push(charUrl);
                        }
                    }
                }

                // Ensure all image URLs are sendable (convert /library/ paths to base64)
                const sendableImages = await Promise.all(
                    imageBase64s.map(url => ensureSendableUrl(url))
                );

                // Generate image with all parent images and character references
                const rawResultUrl = await generateImage({
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    imageBase64: sendableImages.length > 0 ? sendableImages : undefined,
                    imageModel: node.imageModel,
                    nodeId: id,
                    klingReferenceMode: node.klingReferenceMode,
                    klingFaceIntensity: node.klingFaceIntensity,
                    klingSubjectIntensity: node.klingSubjectIntensity
                });

                // Task was enqueued to RabbitMQ — recovery poller will pick up the result
                if (rawResultUrl === QUEUED) return;

                const resultUrl = `${rawResultUrl}?t=${Date.now()}`;

                const { resultAspectRatio } = await getImageAspectRatio(resultUrl);

                updateNode(id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    resultAspectRatio,
                    errorMessage: undefined
                });


            } else if (node.type === NodeType.LOCAL_IMAGE_MODEL) {
                // --- LOCAL MODEL GENERATION ---
                // Check if model is selected
                if (!node.localModelId && !node.localModelPath) {
                    updateNode(id, {
                        status: NodeStatus.ERROR,
                        errorMessage: 'No local model selected. Please select a model first.'
                    });
                    return;
                }

                // Get parent images if any
                const imageBase64s: string[] = [];
                if (node.parentIds && node.parentIds.length > 0) {
                    for (const parentId of node.parentIds) {
                        const parent = currentNodes.find(n => n.id === parentId);
                        if (parent?.type !== NodeType.TEXT && parent?.resultUrl) {
                            imageBase64s.push(parent.resultUrl);
                        }
                    }
                }

                // Call local generation API
                const result = await generateLocalImage({
                    modelId: node.localModelId,
                    modelPath: node.localModelPath,
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution || '512'
                });

                if (result.success && result.resultUrl) {
                    // Add cache-busting parameter
                    const resultUrl = `${result.resultUrl}?t=${Date.now()}`;

                    // Detect actual image dimensions
                    const { resultAspectRatio } = await getImageAspectRatio(resultUrl);

                    updateNode(id, {
                        status: NodeStatus.SUCCESS,
                        resultUrl,
                        resultAspectRatio,
                        errorMessage: undefined
                    });
                } else {
                    throw new Error(result.error || 'Local generation failed');
                }

            } else if (node.type === NodeType.VIDEO) {
                // Get frame images for video generation
                let imageBase64: string | undefined;
                let lastFrameBase64: string | undefined;
                let frameImages: string[] = [];

                // Get non-TEXT and non-VIDEO parent nodes (image sources only for frames)
                const imageParentIds = node.parentIds?.filter(pid => {
                    const parent = currentNodes.find(n => n.id === pid);
                    return parent?.type === NodeType.IMAGE;
                }) || [];

                // Check for frame-to-frame mode (explicit or auto-detected from 2+ image parents)
                const hasMultipleInputs = imageParentIds.length >= 2;
                const hasExplicitFrameInputs = node.frameInputs && node.frameInputs.length >= 2;

                // Motion Reference logic (Kling 2.6)
                let motionReferenceUrl: string | undefined;
                let isMotionControl = false;
                if (node.videoModel === 'kling-v2-6') {
                    // Find a parent video node that has a result
                    const videoParent = node.parentIds
                        ?.map(pid => currentNodes.find(n => n.id === pid))
                        .find(n => n?.type === NodeType.VIDEO && n.resultUrl);

                    if (videoParent) {
                        motionReferenceUrl = videoParent.resultUrl;
                        isMotionControl = true;
                    }
                }

                // Reference video logic for Tencent models (Kling 3.0-Omni, Vidu Q2/Q3, Sora 2.0)
                let referenceVideoUrls: string[] | undefined;
                if (!isMotionControl && node.videoModel) {
                    const modelDef = VIDEO_MODELS.find(m => m.id === node.videoModel);
                    if (modelDef && 'supportsReferenceVideo' in modelDef && modelDef.supportsReferenceVideo) {
                        const videoParents = (node.parentIds || [])
                            .map(pid => currentNodes.find(n => n.id === pid))
                            .filter(n => n?.type === NodeType.VIDEO && n.resultUrl);
                        if (videoParents.length > 0) {
                            referenceVideoUrls = videoParents.map(n => n!.resultUrl!);
                        }
                    }
                }

                // Only evaluate as frame-to-frame if NOT in motion control mode
                const isFrameToFrame = !isMotionControl && (node.videoMode === 'frame-to-frame' || hasMultipleInputs || hasExplicitFrameInputs);

                if (isFrameToFrame && imageParentIds.length >= 2) {
                    // Collect ALL frame images in order
                    // If user has frameInputs with matching length, use that order
                    // Otherwise use all connected image parents in their connection order
                    
                    // Build a map of all parent images
                    const parentImageMap = new Map<string, string>();
                    for (const parentId of imageParentIds) {
                        const parent = currentNodes.find(n => n.id === parentId);
                        if (parent?.resultUrl) {
                            parentImageMap.set(parentId, parent.resultUrl);
                        }
                    }
                    
                    // Determine order: use frameInputs if it covers all parents, otherwise use parentIds order
                    const frameInputNodeIds = node.frameInputs?.map(f => f.nodeId) || [];
                    const allParentsInFrameInputs = imageParentIds.every(pid => frameInputNodeIds.includes(pid));
                    
                    if (node.frameInputs && node.frameInputs.length >= 2 && allParentsInFrameInputs) {
                        // Use user-defined order from frameInputs
                        for (const frameInput of node.frameInputs) {
                            const url = parentImageMap.get(frameInput.nodeId);
                            if (url) {
                                frameImages.push(url);
                            }
                        }
                    } else {
                        // Use default parent order (all connected images)
                        for (const parentId of imageParentIds) {
                            const url = parentImageMap.get(parentId);
                            if (url) {
                                frameImages.push(url);
                            }
                        }
                    }
                    
                    // Also set imageBase64/lastFrameBase64 for backwards compatibility
                    if (frameImages.length > 0) imageBase64 = frameImages[0];
                    if (frameImages.length > 1) lastFrameBase64 = frameImages[frameImages.length - 1];
                } else if (imageParentIds.length > 0) {
                    // Standard mode or Motion Control: get character reference or first parent image
                    if (isMotionControl) {
                        // For Motion Control, look specifically for an IMAGE parent as character reference
                        const characterParent = node.parentIds
                            ?.map(pid => currentNodes.find(n => n.id === pid))
                            .find(n => n?.type === NodeType.IMAGE && n.resultUrl);

                        if (characterParent?.resultUrl) {
                            imageBase64 = characterParent.resultUrl;
                        }
                    } else {
                        // Standard mode: get first parent image or video last frame
                        const parent = currentNodes.find(n => n.id === imageParentIds[0]);

                        if (parent?.resultUrl) {
                            imageBase64 = parent.resultUrl;
                            frameImages = [parent.resultUrl]; // Single frame
                        }
                    }
                } else {
                    // Check for video parent (for video-to-video chaining)
                    const videoParentIds = node.parentIds?.filter(pid => {
                        const parent = currentNodes.find(n => n.id === pid);
                        return parent?.type === NodeType.VIDEO;
                    }) || [];
                    
                    if (videoParentIds.length > 0 && !isMotionControl) {
                        const parent = currentNodes.find(n => n.id === videoParentIds[0]);
                        if (parent?.lastFrame) {
                            imageBase64 = parent.lastFrame;
                            frameImages = [parent.lastFrame];
                        }
                    }
                }

                // Ensure all image URLs are sendable (convert /library/ paths to base64)
                const sendableFrameImages = await Promise.all(
                    frameImages.map(url => ensureSendableUrl(url))
                );
                const sendableImageBase64 = imageBase64 ? await ensureSendableUrl(imageBase64) : undefined;
                const sendableLastFrame = lastFrameBase64 ? await ensureSendableUrl(lastFrameBase64) : undefined;
                const sendableMotionRef = motionReferenceUrl ? await ensureSendableUrl(motionReferenceUrl) : undefined;

                // Fire video generation — don't await the full response.
                // The backend may take minutes; the recovery poller
                // (useGenerationRecovery, 10s interval) will detect completion.
                generateVideo({
                    prompt: combinedPrompt,
                    imageBase64: sendableImageBase64,
                    lastFrameBase64: sendableLastFrame,
                    frameImages: sendableFrameImages.length > 0 ? sendableFrameImages : undefined,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    duration: node.videoDuration,
                    videoModel: node.videoModel,
                    motionReferenceUrl: sendableMotionRef,
                    referenceVideoUrls,
                    generateAudio: node.generateAudio,
                    nodeId: id
                }).then(async (rawResultUrl) => {
                    // Task enqueued — recovery poller will handle completion
                    if (rawResultUrl === QUEUED) return;

                    const current = nodesRef.current.find(n => n.id === id);
                    if (!current || current.status === NodeStatus.SUCCESS) return;

                    const resultUrl = `${rawResultUrl}?t=${Date.now()}`;

                    updateNode(id, { status: NodeStatus.SUCCESS, resultUrl, errorMessage: undefined });

                    const extras: Partial<NodeData> = {};
                    try {
                        const v = document.createElement('video');
                        await new Promise<void>((r) => {
                            v.onloadedmetadata = () => { extras.resultAspectRatio = `${v.videoWidth}/${v.videoHeight}`; extras.aspectRatio = getClosestAspectRatio(v.videoWidth, v.videoHeight); r(); };
                            v.onerror = () => r();
                            v.src = resultUrl;
                        });
                    } catch { /* ignore */ }
                    try { extras.lastFrame = await extractVideoLastFrame(resultUrl); } catch { /* ignore */ }
                    if (Object.keys(extras).length > 0) updateNode(id, extras);
                }).catch((error) => {
                    const current = nodesRef.current.find(n => n.id === id);
                    if (!current || current.status === NodeStatus.SUCCESS) return;

                    const msg = error.toString().toLowerCase();
                    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('aborted') || msg.includes('timeout') || msg.includes('gateway')) {
                        return;
                    }

                    updateNode(id, { status: NodeStatus.ERROR, errorMessage: error.message || 'Video generation failed' });
                });

                // Return immediately — node stays in LOADING while server processes
                return;


            }
        } catch (error: any) {
            // Before marking as error, check if the server actually saved a result
            // (can happen when proxy times out but server-side generation succeeded)
            try {
                const recoveryRes = await authFetch(apiEndpoint(`/generation-status/${id}`));
                if (recoveryRes.ok) {
                    const recovery = await recoveryRes.json();
                    if (recovery.status === 'success' && recovery.resultUrl) {
                        const resultUrl = `${recovery.resultUrl}?t=${Date.now()}`;
                        const { resultAspectRatio } = await getImageAspectRatio(resultUrl);
                        updateNode(id, {
                            status: NodeStatus.SUCCESS,
                            resultUrl,
                            resultAspectRatio,
                            errorMessage: undefined
                        });
                        console.log('Generation recovered from server-side result:', id);
                        return;
                    }
                }
            } catch { /* recovery check failed, proceed with error */ }

            const msg = error.toString().toLowerCase();
            let errorMessage: string;

            if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('aborted') || !navigator.onLine) {
                errorMessage = '网络连接失败，请检查网络后重试。';
                const queue = getOfflineQueue();
                queue.push({ nodeId: id, timestamp: Date.now() });
                saveOfflineQueue(queue);
            } else {
                errorMessage = sanitizeError(error.message || error);
            }

            updateNode(id, { status: NodeStatus.ERROR, errorMessage });
            console.error('Generation failed:', error);
        }
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleGenerate,
        isOnline
    };
};
