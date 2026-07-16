/**
 * StoryboardVideoModal.tsx
 * 
 * Modal for batch generating videos from storyboard scene images.
 * Allows users to write/generate prompts for each scene and configure video settings.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Sparkles, Film, Loader2, Play, Check, ChevronDown, Wand2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NodeData } from '../../types';
import { authFetch, apiEndpoint, ossResize } from '../../config/api';
import { GoogleIcon, KlingIcon, HailuoIcon } from '../icons/BrandIcons';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { sanitizeError } from '../../utils/errorSanitizer';
import { StoryInput } from '../StoryInput';
import type { CharacterAsset } from '../../hooks/useStoryboardGenerator';

interface StoryboardVideoModalProps {
    isOpen: boolean;
    onClose: () => void;
    scenes: NodeData[];
    onCreateVideos: (
        prompts: Record<string, string>,
        settings: {
            model: string;
            duration: number;
            resolution: string;
        },
        activeNodeIds: string[]
    ) => void;
    storyContext?: {
        story: string;
        scripts: any[];
        selectedCharacters?: CharacterAsset[];
    };
}

const VIDEO_MODELS = [
    // 海螺 Hailuo
    { id: 'Hailuo/02', name: '海螺 02', provider: 'hailuo', durations: [6, 10], resolutions: ['720p', '1080p'] },
    { id: 'Hailuo/2.3', name: '海螺 2.3', provider: 'hailuo', durations: [6, 10], resolutions: ['720p', '1080p'] },
    { id: 'Hailuo/2.3-fast', name: '海螺 2.3 Fast', provider: 'hailuo', durations: [6, 10], resolutions: ['720p', '1080p'] },
    // 可灵 Kling
    { id: 'Kling/2.1', name: '可灵 2.1', provider: 'kling', durations: [5, 10], resolutions: ['720p', '1080p'] },
    { id: 'Kling/2.5', name: '可灵 2.5 Turbo', provider: 'kling', durations: [5, 10], resolutions: ['720p', '1080p'] },
    { id: 'Kling/2.6', name: '可灵 2.6', provider: 'kling', durations: [5, 10], resolutions: ['720p', '1080p'] },
    { id: 'Kling/2.6-audio', name: '可灵 2.6 音画', provider: 'kling', durations: [5, 10], resolutions: ['720p', '1080p'] },
    { id: 'Kling/3.0', name: '可灵 3.0', provider: 'kling', recommended: true, durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ['720p', '1080p'] },
    { id: 'Kling/3.0-Omni', name: '可灵 3.0 Omni', provider: 'kling', durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ['720p', '1080p'] },
    { id: 'Kling/O1', name: '可灵 O1', provider: 'kling', durations: [3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['720p', '1080p'] },
    // 生数 Vidu
    { id: 'Vidu/q2', name: '生数 Q2', provider: 'vidu', durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['540p', '720p', '1080p'] },
    { id: 'Vidu/q2-pro', name: '生数 Q2 Pro', provider: 'vidu', durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['720p', '1080p'] },
    { id: 'Vidu/q3', name: '生数 Q3', provider: 'vidu', durations: [3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['540p', '720p', '1080p'] },
    // 即梦 Jimeng
    { id: 'Jimeng/3.0pro', name: '即梦 3.0 Pro', provider: 'jimeng', durations: [5, 10], resolutions: ['1080p'] },
    // 豆包 Seedance
    { id: 'Seedance/2.0', name: '豆包 2.0', provider: 'seedance', durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ['720p', '1080p'] },
    // Google Veo
    { id: 'GV/3.1', name: 'Google Veo 3.1', provider: 'google', durations: [4, 8, 12], resolutions: ['720p', '1080p'] },
    { id: 'GV/3.1-fast', name: 'Google Veo 3.1 Fast', provider: 'google', durations: [4, 8, 12], resolutions: ['720p', '1080p'] },
    // OpenAI Sora
    { id: 'OS/2.0', name: 'Sora 2.0', provider: 'openai', durations: [4, 8, 12], resolutions: ['720p'] },
    // 混元 Hunyuan
    { id: 'Hunyuan/1.5', name: '混元 1.5', provider: 'hunyuan', durations: [5], resolutions: ['480p', '720p', '1080p'] },
];

export const StoryboardVideoModal: React.FC<StoryboardVideoModalProps> = ({
    isOpen,
    onClose,
    scenes,
    onCreateVideos,
    storyContext
}) => {
    const { t, i18n } = useTranslation();
    const [removedSceneIds, setRemovedSceneIds] = useState<Set<string>>(new Set());

    // Reset removed scenes when modal opens/closes or scenes change significantly
    useEffect(() => {
        if (isOpen) {
            setRemovedSceneIds(new Set());
        }
    }, [isOpen]);

    // Filter out removed scenes, then sort by X position
    const activeScenes = scenes.filter(s => !removedSceneIds.has(s.id));
    const sortedScenes = [...activeScenes].sort((a, b) => a.x - b.x);

    const mentionAssets: CharacterAsset[] = useMemo(() =>
        (storyContext?.selectedCharacters || []).filter(c => c?.name && c?.url),
        [storyContext?.selectedCharacters]
    );

    const [prompts, setPrompts] = useState<Record<string, string>>({});
    const [settings, setSettings] = useState({
        model: 'Kling/3.0',
        duration: 5,
        resolution: '720p'
    });
    const [generatingPrompts, setGeneratingPrompts] = useState<Record<string, boolean>>({});
    const [optimizingPrompts, setOptimizingPrompts] = useState<Record<string, boolean>>({});
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const modelDropdownRef = useRef<HTMLDivElement>(null);

    const currentModel = VIDEO_MODELS.find(m => m.id === settings.model) || VIDEO_MODELS[0];
    const availableResolutions = currentModel.resolutions;

    // Ensure settings are valid when model/duration changes
    useEffect(() => {
        const model = VIDEO_MODELS.find(m => m.id === settings.model);
        if (!model) return;

        let newDuration = settings.duration;
        let newResolution = settings.resolution;
        let changed = false;

        // Validation for Duration
        if (!model.durations.includes(newDuration)) {
            newDuration = model.durations[0];
            changed = true;
        }

        const allowedResolutions = model.resolutions;
        if (!allowedResolutions.includes(newResolution)) {
            // If current resolution not allowed, pick first allowed
            // Favor '720p' or '1080p' if available, else first
            if (allowedResolutions.includes('720p')) newResolution = '720p';
            else if (allowedResolutions.includes('1080p')) newResolution = '1080p';
            else newResolution = allowedResolutions[0];
            changed = true;
        }

        if (changed) {
            setSettings(prev => ({ ...prev, duration: newDuration, resolution: newResolution }));
        }
    }, [settings.model, settings.duration, settings.resolution]);

    // Initial settings sync
    useEffect(() => {
        // Ensure duration is valid for initial model
        const model = VIDEO_MODELS.find(m => m.id === settings.model);
        if (model && !model.durations.includes(settings.duration)) {
            setSettings(prev => ({ ...prev, duration: model.durations[0] }));
        }
    }, []); // Only run once on mount

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
                setShowModelDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Initialize prompts with existing node prompts or empty
    useEffect(() => {
        if (isOpen) {
            const initialPrompts: Record<string, string> = {};
            sortedScenes.forEach(scene => {
                // If the scene prompt is an "Extract panel" command, we probably want a fresh description
                // If it's a creative prompt, use it
                if (scene.prompt && !scene.prompt.startsWith('Extract panel')) {
                    initialPrompts[scene.id] = scene.prompt;
                } else {
                    initialPrompts[scene.id] = '';
                }
            });
            setPrompts(initialPrompts);
        }
    }, [isOpen, scenes]);

    // Handle single prompt generation using Gemini
    const handleGeneratePrompt = async (nodeId: string) => {
        const scene = scenes.find(s => s.id === nodeId);
        if (!scene || !scene.resultUrl) return;

        setGeneratingPrompts(prev => ({ ...prev, [nodeId]: true }));

        try {
            const isZh = i18n.language?.startsWith('zh');
            let systemPrompt = isZh
                ? "请用中文详细描述这张图片，用于视频生成提示词。重点描述动作、运动和氛围。控制在50字以内。"
                : "Describe this image in detail to be used as a prompt for video generation. Focus on the action, movement, and atmosphere. Keep it under 50 words.";

            if (storyContext) {
                systemPrompt += isZh
                    ? `\n\n故事背景："${storyContext.story}"`
                    : `\n\nContext from Story: "${storyContext.story}"`;
                const sceneIndex = sortedScenes.findIndex(s => s.id === nodeId);
                if (sceneIndex !== -1 && storyContext.scripts[sceneIndex]) {
                    const script = storyContext.scripts[sceneIndex];
                    console.log(`[StoryboardModal] Injecting script for scene #${sceneIndex + 1}:`, script.description);
                    if (isZh) {
                        systemPrompt += `\n\n场景脚本：${script.description}`;
                        if (script.cameraAngle) systemPrompt += `\n镜头：${script.cameraAngle}${script.cameraMovement ? `（${script.cameraMovement}）` : ''}`;
                        if (script.lighting) systemPrompt += `\n光线：${script.lighting}`;
                        if (script.mood) systemPrompt += `\n氛围：${script.mood}`;
                    } else {
                        systemPrompt += `\n\nScene Script: ${script.description}`;
                        if (script.cameraAngle) systemPrompt += `\nCamera: ${script.cameraAngle} ${script.cameraMovement ? `(${script.cameraMovement})` : ''}`;
                        if (script.lighting) systemPrompt += `\nLighting: ${script.lighting}`;
                        if (script.mood) systemPrompt += `\nMood: ${script.mood}`;
                    }
                }
            }

            const response = await authFetch(apiEndpoint('/api/gemini/describe-image'), {
                method: 'POST',
                body: JSON.stringify({
                    imageUrl: scene.resultUrl,
                    prompt: systemPrompt
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to generate prompt');
            }

            const data = await response.json();
            setPrompts(prev => ({ ...prev, [nodeId]: data.description }));
        } catch (error: any) {
            console.error('Prompt generation failed:', error);
            alert(sanitizeError(error));
        } finally {
            setGeneratingPrompts(prev => ({ ...prev, [nodeId]: false }));
        }
    };

    // Handle optimizing manually entered prompts using Gemini
    const handleOptimizePrompt = async (nodeId: string) => {
        const currentPrompt = prompts[nodeId];
        if (!currentPrompt) return; // Nothing to optimize

        setOptimizingPrompts(prev => ({ ...prev, [nodeId]: true }));

        try {
            // Keep legacy field name (selectedCharacters), but treat it as selected references
            // from "已选参考" (can be character/scene/item/style images).
            const selectedReferenceImageUrls = (storyContext?.selectedCharacters || [])
                .map(asset => asset?.url)
                .filter((url): url is string => Boolean(url));
            const uniqueReferenceImageUrls = Array.from(new Set(selectedReferenceImageUrls));

            const response = await authFetch(apiEndpoint('/api/gemini/optimize-prompt'), {
                method: 'POST',
                body: JSON.stringify({
                    prompt: currentPrompt,
                    imageUrls: uniqueReferenceImageUrls
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to optimize prompt');
            }

            const data = await response.json();
            setPrompts(prev => ({ ...prev, [nodeId]: data.optimizedPrompt }));
        } catch (error: any) {
            console.error('Prompt optimization failed:', error);
            alert(sanitizeError(error));
        } finally {
            setOptimizingPrompts(prev => ({ ...prev, [nodeId]: false }));
        }
    };

    const handleRemoveScene = (nodeId: string) => {
        setRemovedSceneIds(prev => {
            const newSet = new Set(prev);
            newSet.add(nodeId);
            return newSet;
        });
    };

    const handleModelChange = (modelId: string) => {
        const newModel = VIDEO_MODELS.find(m => m.id === modelId);
        if (!newModel) return;

        // Determine new duration: keep current if valid, else first available
        let newDuration = settings.duration;
        if (!newModel.durations.includes(newDuration)) {
            newDuration = newModel.durations[0];
        }

        // Determine new resolution
        let newResolution = settings.resolution;
        const availableRes = newModel.resolutions;
        if (!availableRes.includes(newResolution) && availableRes.length > 0) {
            newResolution = availableRes[0];
        }

        setSettings({
            model: modelId,
            duration: newDuration,
            resolution: newResolution
        });
        setShowModelDropdown(false);
    };

    // Use currentModel derived from settings state
    // ...

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

            {/* Modal */}
            <HoverBorderGradient containerClassName="rounded-xl w-full max-w-4xl" className="rounded-[10px] bg-[var(--sf-bg-panel)]" duration={4}>
            <div className="relative max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-[#1a1a1a] z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 via-purple-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                            <Film size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">{t('storyboardVideo.title')}</h2>
                            <p className="text-xs text-neutral-500">{t('storyboardVideo.subtitle')}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-neutral-800 rounded-lg transition-colors text-neutral-500 hover:text-white"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content - Scrollable List of Scenes */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {sortedScenes.length === 0 ? (
                        <div className="text-center text-neutral-500 py-12">
                            {t('storyboardVideo.noScenes')}
                        </div>
                    ) : (
                        sortedScenes.map((scene, index) => (
                            <div key={scene.id} className="flex gap-2 items-center group/card">
                                {/* Remove Button - Left side */}
                                <button
                                    onClick={() => handleRemoveScene(scene.id)}
                                    className="p-2 text-neutral-600 hover:text-red-400 hover:bg-neutral-800/50 rounded-full transition-all opacity-0 group-hover/card:opacity-100 flex-shrink-0"
                                    title={t('storyboardVideo.removeScene')}
                                >
                                    <Trash2 size={16} />
                                </button>

                                <div className="flex-1 flex gap-4 bg-neutral-900/50 border border-neutral-800 rounded-xl p-4 hover:border-neutral-700 transition-colors">
                                    {/* Scene Image Helper */}
                                    <div className="w-48 aspect-video bg-black rounded-lg overflow-hidden border border-neutral-800 shrink-0 relative group">
                                        {scene.resultUrl ? (
                                            <img src={ossResize(scene.resultUrl, 300)} alt={t('storyboardVideo.sceneAlt', { num: index + 1 })} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-neutral-700">{t('storyboardVideo.noImage')}</div>
                                        )}
                                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded text-[10px] font-medium text-white border border-white/10">
                                            {t('storyboardVideo.sceneLabel', { num: index + 1 })}
                                        </div>
                                    </div>

                                    {/* Prompt Input Area */}
                                    <div className="flex-1 flex flex-col gap-2 relative">
                                        <div className="flex justify-between items-center">
                                            <label className="text-xs font-medium text-neutral-400">{t('storyboardVideo.videoPrompt')}</label>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleOptimizePrompt(scene.id)}
                                                    disabled={generatingPrompts[scene.id] || optimizingPrompts[scene.id] || !prompts[scene.id]}
                                                    className="flex items-center gap-1.5 text-xs sf-rainbow-text transition-colors disabled:opacity-50"
                                                    title={t('storyboardVideo.optimizeHint')}
                                                >
                                                    {optimizingPrompts[scene.id] ? (
                                                        <Loader2 size={12} className="animate-spin" />
                                                    ) : (
                                                        <Wand2 size={12} />
                                                    )}
                                                    {t('storyboardVideo.optimize')}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="relative flex-1">
                                            <StoryInput
                                                value={prompts[scene.id] || ''}
                                                onChange={(val) => setPrompts(prev => ({ ...prev, [scene.id]: val }))}
                                                assets={mentionAssets}
                                                placeholder={t('storyboardVideo.promptPlaceholder')}
                                                className="!min-h-[100px] !rounded-lg !p-3 !bg-neutral-950 !border-neutral-800"
                                            />

                                            {/* Auto-Generate Overlay Button */}
                                            {(!prompts[scene.id] || prompts[scene.id].trim() === '') && (
                                                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                                                    <button
                                                        onClick={() => handleGeneratePrompt(scene.id)}
                                                        disabled={generatingPrompts[scene.id]}
                                                        className="pointer-events-auto flex items-center gap-2 sf-rainbow-text hover:scale-105 transition-all opacity-80 hover:opacity-100"
                                                    >
                                                        {generatingPrompts[scene.id] ? (
                                                            <Loader2 size={14} className="animate-spin" />
                                                        ) : (
                                                            <Sparkles size={14} />
                                                        )}
                                                        <span className="text-sm font-medium">{t('storyboardVideo.autoGenerate')}</span>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer - Global Settings & Action */}
                <div className="px-6 py-4 border-t border-neutral-800 bg-[#151515]">
                    <div className="flex items-center justify-between">
                        {/* Settings */}
                        <div className="flex items-center gap-4">
                            {/* Model Selector */}
                            <div className="flex flex-col gap-1" ref={modelDropdownRef}>
                                <label className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">{t('storyboardVideo.model')}</label>
                                <div className="relative">
                                    <button
                                        onClick={() => setShowModelDropdown(!showModelDropdown)}
                                        className="flex items-center gap-2 bg-neutral-800 text-white text-xs px-3 py-2 rounded-lg border border-neutral-700 hover:bg-neutral-700 transition-colors min-w-[160px] justify-between"
                                    >
                                        <div className="flex items-center gap-2">
                                            {currentModel.provider === 'google' ? <GoogleIcon size={14} className="text-white" /> :
                                                currentModel.provider === 'kling' ? <KlingIcon size={16} /> :
                                                    currentModel.provider === 'hailuo' ? <HailuoIcon size={16} /> :
                                                        <Film size={14} />}
                                            <span>{currentModel.name}</span>
                                        </div>
                                        <ChevronDown size={14} className="opacity-50" />
                                    </button>

                                    {/* Dropdown */}
                                    {showModelDropdown && (
                                        <div className="absolute bottom-full mb-2 left-0 w-64 bg-[#1f1f1f] border border-neutral-700 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col max-h-[400px] overflow-y-auto">
                                            {(() => {
                                                const providerOrder = ['hailuo', 'kling', 'vidu', 'jimeng', 'seedance', 'google', 'openai', 'hunyuan'];
                                                const providerLabels: Record<string, string> = { hailuo: '海螺 Hailuo', kling: '可灵 Kling', vidu: '生数 Vidu', jimeng: '即梦 Jimeng', seedance: '豆包 Seedance', google: 'Google Veo', openai: 'OpenAI Sora', hunyuan: '混元 Hunyuan' };
                                                const providerIcons: Record<string, React.ReactNode> = { google: <GoogleIcon size={14} />, kling: <KlingIcon size={16} />, hailuo: <HailuoIcon size={16} /> };
                                                return providerOrder.filter(p => VIDEO_MODELS.some(m => m.provider === p)).map((provider, pi) => (
                                                    <React.Fragment key={provider}>
                                                        <div className={`px-3 py-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1a1a1a] ${pi > 0 ? 'border-t border-neutral-700' : ''}`}>
                                                            {providerLabels[provider] || provider}
                                                        </div>
                                                        {VIDEO_MODELS.filter(m => m.provider === provider).map(model => (
                                                            <button
                                                                key={model.id}
                                                                onClick={() => handleModelChange(model.id)}
                                                                className={`w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-[#2a2a2a] transition-colors ${settings.model === model.id ? 'sf-rainbow-text bg-white/10' : 'text-neutral-300'}`}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    {providerIcons[provider] || <Film size={14} />}
                                                                    {model.name}
                                                                    {model.recommended && (
                                                                        <span className="text-[9px] px-1 py-0.5 bg-green-500/20 text-green-400 rounded font-medium">REC</span>
                                                                    )}
                                                                </div>
                                                                {settings.model === model.id && <Check size={14} />}
                                                            </button>
                                                        ))}
                                                    </React.Fragment>
                                                ));
                                            })()}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Duration Selector - Dynamic based on model */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">{t('storyboardVideo.duration')}</label>
                                <select
                                    value={settings.duration}
                                    onChange={(e) => setSettings(prev => ({ ...prev, duration: Number(e.target.value) }))}
                                    className="bg-neutral-800 text-white text-xs px-3 py-2 rounded-lg border border-neutral-700 focus:outline-none focus:border-white/30 min-w-[80px]"
                                >
                                    {currentModel.durations.map(d => (
                                        <option key={d} value={d}>{d}s</option>
                                    ))}
                                </select>
                            </div>

                            {/* Resolution Selector */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">{t('storyboardVideo.resolution')}</label>
                                <select
                                    value={settings.resolution}
                                    onChange={(e) => setSettings(prev => ({ ...prev, resolution: e.target.value }))}
                                    className="bg-neutral-800 text-white text-xs px-3 py-2 rounded-lg border border-neutral-700 focus:outline-none focus:border-white/30 min-w-[80px]"
                                >
                                    {availableResolutions.map(res => (
                                        <option key={res} value={res}>{res}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Generate Action */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => onCreateVideos(prompts, settings, sortedScenes.map(s => s.id))}
                                className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 hover:from-pink-400 hover:via-purple-400 hover:to-blue-400 text-white pl-4 pr-5 py-2.5 rounded-xl text-sm font-medium transition-all shadow-lg shadow-blue-900/40 flex items-center gap-2"
                            >
                                <Play size={16} fill="currentColor" />
                                {t('storyboardVideo.generateBtn')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            </HoverBorderGradient>
        </div>
    );
};
