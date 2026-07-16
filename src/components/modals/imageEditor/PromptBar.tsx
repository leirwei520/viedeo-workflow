/**
 * PromptBar.tsx
 * 
 * Prompt input bar with model, aspect ratio, and resolution dropdowns.
 * Contains batch count controls and generate button.
 */

import React, { useRef, useEffect } from 'react';
import { ChevronDown, Check, Image as ImageIcon, Crop, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ImageModel, IMAGE_MODELS } from './imageEditor.types';
import { HoverBorderGradient } from '../../ui/hover-border-gradient';

// ============================================================================
// TYPES
// ============================================================================

interface PromptBarProps {
    // Prompt state
    prompt: string;
    setPrompt: (prompt: string) => void;
    // Model state
    selectedModel: string;
    onModelChange: (modelId: string) => void;
    showModelDropdown: boolean;
    setShowModelDropdown: (show: boolean) => void;
    // Aspect ratio state
    selectedAspectRatio: string;
    onAspectChange: (ratio: string) => void;
    showAspectDropdown: boolean;
    setShowAspectDropdown: (show: boolean) => void;
    // Resolution state
    selectedResolution: string;
    onResolutionChange: (res: string) => void;
    showResolutionDropdown: boolean;
    setShowResolutionDropdown: (show: boolean) => void;
    // Batch count
    batchCount: number;
    setBatchCount: (count: number) => void;
    // Actions
    onGenerate: () => void;
    // Flags
    hasInputImage: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const PromptBar: React.FC<PromptBarProps> = ({
    prompt,
    setPrompt,
    selectedModel,
    onModelChange,
    showModelDropdown,
    setShowModelDropdown,
    selectedAspectRatio,
    onAspectChange,
    showAspectDropdown,
    setShowAspectDropdown,
    selectedResolution,
    onResolutionChange,
    showResolutionDropdown,
    setShowResolutionDropdown,
    batchCount,
    setBatchCount,
    onGenerate,
    hasInputImage
}) => {
    const { t } = useTranslation();

    // --- Refs ---
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    const aspectDropdownRef = useRef<HTMLDivElement>(null);
    const resolutionDropdownRef = useRef<HTMLDivElement>(null);

    // --- Derived State ---
    const currentModel = IMAGE_MODELS.find(m => m.id === selectedModel) || IMAGE_MODELS[0];
    const availableModels = hasInputImage
        ? IMAGE_MODELS.filter(m => m.supportsImageToImage)
        : IMAGE_MODELS;

    // --- Effects ---

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
                setShowModelDropdown(false);
            }
            if (aspectDropdownRef.current && !aspectDropdownRef.current.contains(event.target as Node)) {
                setShowAspectDropdown(false);
            }
            if (resolutionDropdownRef.current && !resolutionDropdownRef.current.contains(event.target as Node)) {
                setShowResolutionDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [setShowModelDropdown, setShowAspectDropdown, setShowResolutionDropdown]);

    return (
        <HoverBorderGradient containerClassName="w-full rounded-xl pointer-events-auto" className="w-full bg-[var(--sf-bg-deep)] backdrop-blur-sm rounded-xl shadow-2xl flex items-center px-3 py-2.5 gap-3" duration={2}>
            {/* Left - Model Dropdown */}
            <div className="relative flex-shrink-0" ref={modelDropdownRef}>
                <HoverBorderGradient
                    as="button"
                    containerClassName="rounded-md"
                    className="flex items-center gap-1 text-[11px] text-neutral-300 px-2 py-1.5 rounded-md bg-[var(--sf-bg-deep)]"
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    duration={2}
                >
                    <ImageIcon size={11} className="sf-rainbow-text" />
                    <span className="font-medium whitespace-nowrap">{currentModel.name}</span>
                    <ChevronDown size={10} className="opacity-50" />
                </HoverBorderGradient>

                {showModelDropdown && (
                    <div className="absolute bottom-full mb-2 left-0 w-52 bg-[var(--sf-bg-panel)] rounded-lg shadow-xl overflow-hidden z-50 max-h-[400px] overflow-y-auto border border-white/10">
                        <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider bg-[#1a1a1a] border-b border-neutral-700 sticky top-0 z-10">
                            {hasInputImage ? t('modals.imageEditor.imageToImage') : t('modals.imageEditor.textToImage')}
                        </div>
                        {(() => {
                            const groups: string[] = [];
                            availableModels.forEach(m => { const g = m.group || m.provider || 'Other'; if (!groups.includes(g)) groups.push(g); });
                            return groups.map((groupName, gi) => {
                                const models = availableModels.filter(m => (m.group || m.provider || 'Other') === groupName);
                                if (models.length === 0) return null;
                                return (
                                    <div key={groupName}>
                                        <div className={`px-3 py-1 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f] ${gi > 0 ? 'border-t border-neutral-700' : ''}`}>{groupName}</div>
                                        {models.map(model => (
                                            <button
                                                key={model.id}
                                                onClick={() => onModelChange(model.id)}
                                                className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left hover:bg-[#333] transition-colors ${currentModel.id === model.id ? 'sf-rainbow-text' : 'text-neutral-300'}`}
                                            >
                                                <span className="flex items-center gap-2 min-w-0">
                                                    <span className="truncate">{model.name}</span>
                                                    {model.label && <span className="text-[9px] text-neutral-500 shrink-0">{model.label}</span>}
                                                    {model.recommended && <span className="text-[9px] px-1 py-0.5 bg-green-600/30 text-green-400 rounded shrink-0">REC</span>}
                                                </span>
                                                {currentModel.id === model.id && <Check size={12} className="shrink-0 ml-1" />}
                                            </button>
                                        ))}
                                    </div>
                                );
                            });
                        })()}
                    </div>
                )}
            </div>

            {/* Prompt Input - Takes remaining space */}
            <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t('modals.imageEditor.describePlaceholder')}
                className="flex-1 min-w-0 bg-transparent text-sm text-neutral-200 placeholder-neutral-500 outline-none"
            />

            {/* Right - Compact Controls Group */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Aspect Ratio - only show when model supports it */}
                {currentModel.aspectRatios && currentModel.aspectRatios.length > 0 && (
                <div className="relative" ref={aspectDropdownRef}>
                    <HoverBorderGradient
                        as="button"
                        containerClassName="rounded-md"
                        className="flex items-center gap-1 text-[11px] font-medium text-white px-2 py-1.5 rounded-md bg-[var(--sf-bg-deep)]"
                        onClick={() => setShowAspectDropdown(!showAspectDropdown)}
                        duration={2}
                    >
                        <Crop size={10} className="sf-rainbow-text" />
                        <span>{selectedAspectRatio}</span>
                    </HoverBorderGradient>

                    {showAspectDropdown && (
                        <div className="absolute bottom-full mb-2 right-0 w-28 bg-[var(--sf-bg-panel)] rounded-lg shadow-xl overflow-hidden z-50 max-h-60 overflow-y-auto border border-white/10">
                            <div className="px-3 py-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f]">{t('modals.imageEditor.size')}</div>
                            {currentModel.aspectRatios.map(ratio => (
                                <button
                                    key={ratio}
                                    onClick={() => onAspectChange(ratio)}
                                    className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-[#333] transition-colors ${selectedAspectRatio === ratio ? 'sf-rainbow-text' : 'text-neutral-300'}`}
                                >
                                    <span>{ratio}</span>
                                    {selectedAspectRatio === ratio && <Check size={12} />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                )}

                {/* Resolution - only show when model supports it */}
                {currentModel.resolutions && currentModel.resolutions.length > 0 && (
                <div className="relative" ref={resolutionDropdownRef}>
                    <HoverBorderGradient
                        as="button"
                        containerClassName="rounded-md"
                        className="flex items-center gap-1 text-[11px] font-medium text-white px-2 py-1.5 rounded-md bg-[var(--sf-bg-deep)]"
                        onClick={() => setShowResolutionDropdown(!showResolutionDropdown)}
                        duration={2}
                    >
                        <Monitor size={10} className="text-green-400" />
                        <span>{selectedResolution}</span>
                    </HoverBorderGradient>

                    {showResolutionDropdown && (
                        <div className="absolute bottom-full mb-2 right-0 w-24 bg-[var(--sf-bg-panel)] rounded-lg shadow-xl overflow-hidden z-50 border border-white/10">
                            <div className="px-3 py-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f]">{t('modals.imageEditor.quality')}</div>
                            {currentModel.resolutions.map(res => (
                                <button
                                    key={res}
                                    onClick={() => onResolutionChange(res)}
                                    className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-[#333] transition-colors ${selectedResolution === res ? 'sf-rainbow-text' : 'text-neutral-300'}`}
                                >
                                    <span>{res}</span>
                                    {selectedResolution === res && <Check size={12} />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                )}

                {/* Batch Count */}
                <HoverBorderGradient containerClassName="rounded-md" className="flex items-center rounded-md px-2 py-1.5 gap-1 text-[11px] text-neutral-300 font-medium bg-[var(--sf-bg-deep)]" duration={2}>
                    <button
                        className="hover:text-white disabled:opacity-50"
                        onClick={() => setBatchCount(Math.max(1, batchCount - 1))}
                        disabled={batchCount <= 1}
                    >‹</button>
                    <span className="w-3 text-center">{batchCount}</span>
                    <button
                        className="hover:text-white disabled:opacity-50"
                        onClick={() => setBatchCount(Math.min(4, batchCount + 1))}
                        disabled={batchCount >= 4}
                    >›</button>
                </HoverBorderGradient>

                {/* Generate Button */}
                <HoverBorderGradient
                    as="button"
                    containerClassName="rounded-md"
                    className="px-4 py-1.5 rounded-md text-[11px] font-bold text-white shadow-lg flex items-center gap-1.5 whitespace-nowrap bg-[var(--sf-bg-deep)]"
                    onClick={onGenerate}
                    duration={2}
                >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M12 2v20M2 12h20" />
                    </svg>
                    {t('modals.imageEditor.generate')}
                </HoverBorderGradient>
            </div>
        </HoverBorderGradient>
    );
};
