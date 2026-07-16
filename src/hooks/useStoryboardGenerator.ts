/**
 * useStoryboardGenerator.ts
 * 
 * Custom hook for managing storyboard generation workflow.
 * Handles character selection, story input, script generation, and node creation.
 */

import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeData, NodeStatus, NodeType, Viewport } from '../types';
import { generateUUID } from '../utils/uuid';
import { sanitizeError } from '../utils/errorSanitizer';
import { authFetch, apiEndpoint } from '../config/api';

// ============================================================================
// TYPES
// ============================================================================

export interface CharacterAsset {
    id: string;
    name: string;
    url: string;
    description?: string;
    category?: string; // 'Character' | 'Scene' | 'Item' | 'Style' | 'Others'
}

interface OptimizeReferenceAsset {
    name: string;
    url: string;
    category?: string;
    description?: string;
}

export interface SceneScript {
    sceneNumber: number;
    description: string;
    cameraAngle: string;
    cameraMovement?: string;
    lighting?: string;
    mood: string;
}

export interface StoryboardState {
    step: 'characters' | 'story' | 'scripts' | 'preview' | 'generate';
    selectedCharacters: CharacterAsset[];
    sceneCount: number;
    story: string;
    scripts: SceneScript[];
    styleAnchor: string;
    characterDNA: Record<string, string>;
    compositeImageUrl: string | null;
    isGeneratingPreview: boolean;
    isGenerating: boolean;
    isBrainstorming: boolean;
    isOptimizing: boolean;
    error: string | null;
}

// ============================================================================
// HOOK
// ============================================================================

interface StoryboardGroupInfo {
    groupId: string;
    groupLabel: string;
    storyContext?: {
        story: string;
        scripts: SceneScript[];
        selectedCharacters?: CharacterAsset[];
        sceneCount?: number;
        styleAnchor?: string;
        characterDNA?: Record<string, string>;
        compositeImageUrl?: string | null;
    };
}

interface UseStoryboardGeneratorProps {
    onCreateNodes: (nodes: Partial<NodeData>[], groupInfo?: StoryboardGroupInfo) => void;
    viewport: Viewport;
}

export const useStoryboardGenerator = ({ onCreateNodes, viewport }: UseStoryboardGeneratorProps) => {
    const { t, i18n } = useTranslation();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [state, setState] = useState<StoryboardState>({
        step: 'characters',
        selectedCharacters: [],
        sceneCount: 3,
        story: '',
        scripts: [],
        styleAnchor: '',
        characterDNA: {},
        compositeImageUrl: null,
        isGeneratingPreview: false,
        isGenerating: false,
        isBrainstorming: false,
        isOptimizing: false,
        error: null
    });

    // ============================================================================
    // MODAL CONTROLS
    // ============================================================================

    const compositeFlightRef = useRef(false);

    /** Wipe all in-progress storyboard data — call after a session is "completed" (nodes created), not on every open. */
    const resetState = useCallback(() => {
        setState({
            step: 'characters',
            selectedCharacters: [],
            sceneCount: 3,
            story: '',
            scripts: [],
            styleAnchor: '',
            characterDNA: {},
            compositeImageUrl: null,
            isGeneratingPreview: false,
            isGenerating: false,
            isBrainstorming: false,
            isOptimizing: false,
            error: null
        });
    }, []);

    const openModal = useCallback(() => {
        // Preserve the previous session so users can resume mid-flow after closing.
        // State is only reset after `createStoryboardNodes` completes, or via `resetState`.
        setIsModalOpen(true);
        // Clear any stale transient flags from the last open without losing progress.
        setState(prev => ({
            ...prev,
            isGenerating: false,
            isGeneratingPreview: false,
            isBrainstorming: false,
            isOptimizing: false,
            error: null,
        }));
    }, []);

    const closeModal = useCallback(() => {
        setIsModalOpen(false);
    }, []);

    // ============================================================================
    // STATE UPDATES
    // ============================================================================

    const setStep = useCallback((step: StoryboardState['step']) => {
        setState(prev => {
            const enteringPreviewNeedsComposite =
                step === 'preview' && !prev.compositeImageUrl;
            return {
                ...prev,
                step,
                error: null,
                /** Same-tick as navigation so preview never flashes the empty fallback before fetch starts */
                ...(enteringPreviewNeedsComposite ? { isGeneratingPreview: true } : {})
            };
        });
    }, []);

    const setSelectedCharacters = useCallback((characters: CharacterAsset[]) => {
        setState(prev => ({ ...prev, selectedCharacters: characters }));
    }, []);

    const toggleCharacter = useCallback((character: CharacterAsset) => {
        setState(prev => {
            const isSelected = prev.selectedCharacters.some(c => c.id === character.id);
            if (isSelected) {
                return {
                    ...prev,
                    selectedCharacters: prev.selectedCharacters.filter(c => c.id !== character.id)
                };
            } else {
                // Limit to 3 characters max
                if (prev.selectedCharacters.length >= 3) {
                    return { ...prev, error: t('modals.storyboard.characters.maxLimit') };
                }
                return {
                    ...prev,
                    selectedCharacters: [...prev.selectedCharacters, character],
                    error: null
                };
            }
        });
    }, []);

    const setSceneCount = useCallback((count: number) => {
        setState(prev => ({ ...prev, sceneCount: Math.max(1, Math.min(10, count)) }));
    }, []);

    const setStory = useCallback((story: string) => {
        setState(prev => ({ ...prev, story }));
    }, []);

    const setSelectedImageModel = useCallback((model: string) => {
        setState(prev => ({ ...prev, selectedImageModel: model }));
    }, []);

    const updateScript = useCallback((index: number, updates: Partial<SceneScript>) => {
        setState(prev => ({
            ...prev,
            scripts: prev.scripts.map((script, i) =>
                i === index ? { ...script, ...updates } : script
            )
        }));
    }, []);

    // ============================================================================
    // API CALLS
    // ============================================================================

    const generateScripts = useCallback(async () => {
        if (!state.story.trim()) {
            setState(prev => ({ ...prev, error: t('modals.storyboard.story.emptyError') }));
            return;
        }


        setState(prev => ({
            ...prev,
            isGenerating: true,
            error: null,
            step: 'scripts',    // Transition immediately
            scripts: []         // Clear for skeleton loading
        }));

        try {
            const response = await authFetch(apiEndpoint('/api/storyboard/generate-scripts'), {
                method: 'POST',
                body: JSON.stringify({
                    story: state.story,
                    language: i18n.language,
                    characterDescriptions: state.selectedCharacters.map(c => ({
                        name: c.name,
                        description: c.description || 'A reference',
                        category: c.category || 'Others'
                    })),
                    sceneCount: state.sceneCount,
                    referenceImages: state.selectedCharacters.map(char => ({
                        name: char.name,
                        url: char.url,
                        category: char.category || 'Others'
                    }))
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to generate scripts');
            }

            const data = await response.json();
            setState(prev => ({
                ...prev,
                scripts: data.scripts,
                styleAnchor: data.styleAnchor || '',
                characterDNA: data.characterDNA || {},
                // step: 'scripts', // Already transitioned
                isGenerating: false
            }));
        } catch (error) {
            console.error('[Storyboard] Script generation error:', error);
            setState(prev => ({
                ...prev,
                error: sanitizeError(error),
                isGenerating: false
            }));
        }
    }, [state.story, state.selectedCharacters, state.sceneCount]);

    const brainstormStory = useCallback(async () => {
        setState(prev => ({ ...prev, isBrainstorming: true, error: null }));

        try {
            const response = await authFetch(apiEndpoint('/api/storyboard/brainstorm-story'), {
                method: 'POST',
                body: JSON.stringify({
                    language: i18n.language,
                    characterDescriptions: state.selectedCharacters.map(c => ({
                        name: c.name,
                        description: c.description || 'A character'
                    })),
                    referenceImages: state.selectedCharacters.map(char => ({
                        name: char.name,
                        url: char.url,
                        category: char.category || 'Others'
                    }))
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to brainstorm story');
            }

            const data = await response.json();
            setState(prev => ({
                ...prev,
                story: data.story,
                isBrainstorming: false
            }));
        } catch (error) {
            console.error('[Storyboard] Brainstorm error:', error);
            setState(prev => ({
                ...prev,
                error: sanitizeError(error),
                isBrainstorming: false
            }));
        }
    }, [state.selectedCharacters]);

    const optimizeStory = useCallback(async (extraReferences: OptimizeReferenceAsset[] = []) => {
        console.log('[Storyboard][Optimize] Called!', { storyLen: state.story.length, extraRefs: extraReferences.length, selectedChars: state.selectedCharacters.length });
        if (!state.story.trim()) {
            setState(prev => ({ ...prev, error: t('modals.storyboard.story.emptyOptimizeError') }));
            return;
        }

        setState(prev => ({ ...prev, isOptimizing: true, error: null }));

        try {
            const mergedReferencesMap = new Map<string, OptimizeReferenceAsset>();
            state.selectedCharacters.forEach(char => {
                if (char?.url) {
                    mergedReferencesMap.set(char.url, {
                        name: char.name,
                        url: char.url,
                        category: char.category || 'Others',
                        description: char.description || ''
                    });
                }
            });
            extraReferences.forEach(ref => {
                if (ref?.url) {
                    mergedReferencesMap.set(ref.url, {
                        name: ref.name,
                        url: ref.url,
                        category: ref.category || 'Others',
                        description: ref.description || ''
                    });
                }
            });
            const mergedReferences = Array.from(mergedReferencesMap.values());
            const optimizeEndpoint = apiEndpoint('/api/storyboard/optimize-story');
            console.log('[Storyboard][Optimize] Request payload summary:', {
                endpoint: optimizeEndpoint,
                storyLength: state.story.length,
                mentionCount: (state.story.match(/@[^\s@，。！？,.!?:：；;、（）()「」『』[\]{}<>《》"'“”‘’*]+/g) || []).length,
                referenceCount: mergedReferences.length,
                references: mergedReferences.map(ref => ({
                    name: ref.name,
                    category: ref.category || 'Others',
                    hasUrl: Boolean(ref.url)
                }))
            });

            const response = await authFetch(optimizeEndpoint, {
                method: 'POST',
                body: JSON.stringify({
                    story: state.story,
                    language: i18n.language,
                    characterNames: mergedReferences.map(c => c.name),
                    mentionTokens: mergedReferences.map(c => `@${c.name}`),
                    selectedReferences: mergedReferences.map(c => ({
                        name: c.name,
                        category: c.category || 'Others',
                        description: c.description || ''
                    })),
                    referenceImages: mergedReferences.map(char => ({
                        name: char.name,
                        url: char.url,
                        category: char.category || 'Others'
                    }))
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to optimize story');
            }

            const data = await response.json();
            setState(prev => ({
                ...prev,
                story: data.optimizedStory,
                isOptimizing: false
            }));
        } catch (error) {
            console.error('[Storyboard] Optimization error:', error);
            setState(prev => ({
                ...prev,
                error: sanitizeError(error),
                isOptimizing: false
            }));
        }
    }, [state.story, state.selectedCharacters]);

    // Generate composite storyboard preview image
    const generateComposite = useCallback(async () => {
        if (compositeFlightRef.current) return;
        compositeFlightRef.current = true;
        setState(prev => ({ ...prev, isGeneratingPreview: true, error: null }));

        try {
            const response = await authFetch(apiEndpoint('/api/storyboard/generate-composite'), {
                method: 'POST',
                body: JSON.stringify({
                    scripts: state.scripts,
                    styleAnchor: state.styleAnchor,
                    characterDNA: state.characterDNA,
                    sceneCount: state.scripts.length,
                    // Pass reference images with their categories
                    referenceImages: state.selectedCharacters.map(char => ({
                        name: char.name,
                        url: char.url,
                        category: char.category || 'Others'
                    }))
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to generate composite preview');
            }

            const data = await response.json();
            setState(prev => ({
                ...prev,
                compositeImageUrl: data.imageUrl,
                step: 'preview',
                isGeneratingPreview: false
            }));
        } catch (error) {
            console.error('[Storyboard] Composite generation error:', error);
            setState(prev => ({
                ...prev,
                error: sanitizeError(error),
                isGeneratingPreview: false
            }));
        } finally {
            compositeFlightRef.current = false;
        }
    }, [state.scripts, state.styleAnchor, state.characterDNA]);

    // Regenerate composite image if user wants to try again
    const regenerateComposite = useCallback(async () => {
        setState(prev => ({
            ...prev,
            step: 'preview',
            isGeneratingPreview: true,
            error: null
        }));
        await generateComposite();
    }, [generateComposite]);

    // ============================================================================
    // NODE CREATION
    // ============================================================================

    const createStoryboardNodes = useCallback(() => {
        if (state.scripts.length === 0) {
            setState(prev => ({ ...prev, error: t('modals.storyboard.scripts.noScripts') }));
            return;
        }

        // Calculate center position
        const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
        const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;

        // Calculate node layout (horizontal, with spacing)
        const NODE_WIDTH = 340;
        const NODE_GAP = 100;
        const totalWidth = state.scripts.length * NODE_WIDTH + (state.scripts.length - 1) * NODE_GAP;
        const startX = centerX - totalWidth / 2;

        // Get character image URLs for reference (to maintain character consistency)
        const characterImageUrls = state.selectedCharacters
            .filter(c => c.url)
            .map(c => c.url);

        // Generate a shared group ID for all storyboard nodes
        const storyboardGroupId = generateUUID();

        // Create nodes for each script - generate each scene independently
        const isZh = i18n.language?.startsWith('zh');
        const newNodes: Partial<NodeData>[] = state.scripts.map((script, index) => {
            const sceneNumber = script.sceneNumber || (index + 1);
            const style = state.styleAnchor || (isZh ? '写实风格，电影级灯光，高细节' : 'photorealistic, cinematic lighting, high detail');
            const cameraLabel = isZh ? '镜头' : 'Camera';
            const lightingLabel = isZh ? '光线' : 'Lighting';
            const moodLabel = isZh ? '氛围' : 'Mood';
            const prompt = `${style}。${script.description}。${cameraLabel}：${script.cameraAngle}${script.cameraMovement ? `，${script.cameraMovement}` : ''}。${script.lighting ? `${lightingLabel}：${script.lighting}。` : ''}${moodLabel}：${script.mood}。`;

            // Use character images as reference for visual consistency
            const referenceUrls = characterImageUrls.length > 0 ? characterImageUrls : undefined;

            return {
                id: generateUUID(),
                type: NodeType.IMAGE,
                x: startX + index * (NODE_WIDTH + NODE_GAP),
                y: centerY - 100,
                prompt,
                // Set to IDLE - handleGenerate will set to LOADING when called
                status: NodeStatus.IDLE,
                model: 'ChuHaiBang',
                imageModel: 'chuhaibang',
                aspectRatio: '16:9',
                resolution: '1K',
                title: t('modals.storyboard.generate.sceneTitle', { num: sceneNumber }),
                parentIds: [],
                groupId: storyboardGroupId,
                characterReferenceUrls: referenceUrls,
                assetMentions: state.selectedCharacters
                    .filter(c => c.url)
                    .map(c => ({ name: c.name, url: c.url }))
            };
        });

        // Pass the group info along with nodes for App.tsx to create the group
        onCreateNodes(newNodes, {
            groupId: storyboardGroupId,
            groupLabel: t('modals.storyboard.generate.groupLabel', { time: new Date().toLocaleTimeString() }),
            storyContext: {
                story: state.story,
                scripts: state.scripts,
                selectedCharacters: state.selectedCharacters,
                sceneCount: state.sceneCount,
                styleAnchor: state.styleAnchor,
                characterDNA: state.characterDNA,
                compositeImageUrl: state.compositeImageUrl
            }
        });
        closeModal();
        // A finished session shouldn't leak into the next "新建分镜" — reset for a clean slate next open.
        resetState();
    }, [state.scripts, state.selectedCharacters, state.styleAnchor, state.compositeImageUrl, viewport, onCreateNodes, closeModal, resetState]);

    // Restore state from saved context to edit an existing storyboard
    const editStoryboard = useCallback((context: NonNullable<StoryboardGroupInfo['storyContext']>) => {
        const hasComposite = !!context.compositeImageUrl;
        setState({
            step: hasComposite ? 'preview' : 'scripts', // Only jump to preview if we have the image, otherwise go to scripts to avoid auto-regen
            selectedCharacters: context.selectedCharacters || [],
            sceneCount: context.sceneCount || 3,
            story: context.story,
            scripts: context.scripts,
            styleAnchor: context.styleAnchor || '',
            characterDNA: context.characterDNA || {},
            compositeImageUrl: context.compositeImageUrl || null,
            isGeneratingPreview: false,
            isGenerating: false,
            isBrainstorming: false,
            isOptimizing: false,
            error: null
        });
        setIsModalOpen(true);
    }, []);

    return {
        isModalOpen,
        openModal,
        closeModal,
        editStoryboard,
        resetState,
        state,
        setStep,
        setSelectedCharacters,
        toggleCharacter,
        setSceneCount,
        setStory,
        updateScript,
        generateScripts,
        brainstormStory,
        optimizeStory,
        generateComposite,
        regenerateComposite,
        createStoryboardNodes
    };
};
