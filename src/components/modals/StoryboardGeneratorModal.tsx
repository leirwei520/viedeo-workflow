/**
 * StoryboardGeneratorModal.tsx
 * 
 * Modal overlay for creating AI-powered storyboard scenes.
 * Multi-step workflow: Character Selection → Story Input → Script Review → Generate
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft, Loader2, Film, Users, PenTool, Sparkles, Check, Edit3, Wand2, Eye, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CharacterAsset, SceneScript, StoryboardState } from '../../hooks/useStoryboardGenerator';
import { StoryInput } from '../StoryInput';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { useTheme } from '../../hooks/useTheme';
import { authFetch, apiEndpoint, ossResize } from '../../config/api';
import { sanitizeError } from '../../utils/errorSanitizer';

// ============================================================================
// IMAGE MODELS (Copied from NodeControls.tsx for model selection)
// ============================================================================

/** Primary action — aligned with Toolbar / WorkflowPanel modals */
const footerPrimaryEnabled = (isDark: boolean) =>
    isDark
        ? 'sf-rainbow-btn text-white'
        : 'lt-btn-primary text-white';

const IMAGE_MODELS = [
    { id: 'gem-3.0', name: 'Nano Banana Pro', group: 'Google' },
    { id: 'gem-3.1', name: 'Nano2', group: 'Google' },
    { id: 'gem-2.5', name: 'Nano Banana', group: 'Google' },
    { id: 'kling-img-3.0', name: '可灵 3.0', group: '可灵 Kling' },
    { id: 'kling-img-3.0-omni', name: '可灵 3.0-Omni', group: '可灵 Kling' },
    { id: 'kling-img-2.1', name: '可灵 2.1', group: '可灵 Kling' },
    { id: 'vidu-q2', name: '生数 Vidu q2', group: 'Vidu' },
    { id: 'si-4.0', name: '豆包 Seedream 4.0', group: '豆包 Seedream' },
    { id: 'si-4.5', name: '豆包 Seedream 4.5', group: '豆包 Seedream' },
    { id: 'si-5.0-lite', name: '豆包 Seedream 5.0-lite', group: '豆包 Seedream' },
    { id: 'jimeng-4.0', name: '即梦 4.0', group: '即梦 Jimeng' },
    { id: 'hunyuan-3.0', name: '混元 3.0', group: '混元 Hunyuan' },
    { id: 'qwen-0925', name: '千问 0925', group: '千问 Qwen' },
    { id: 'chuhaibang', name: 'ChuHaiBang', group: 'ChuHaiBang' },
];

// ============================================================================
// TYPES
// ============================================================================

interface StoryboardGeneratorModalProps {
    isOpen: boolean;
    onClose: () => void;
    state: StoryboardState;
    onSetStep: (step: StoryboardState['step']) => void;
    onToggleCharacter: (character: CharacterAsset) => void;
    onSetSceneCount: (count: number) => void;
    onSetStory: (story: string) => void;
    onUpdateScript: (index: number, updates: Partial<SceneScript>) => void;
    onGenerateScripts: () => Promise<void>;
    onBrainstormStory: () => Promise<void>;
    onOptimizeStory: (extraReferences?: CharacterAsset[]) => Promise<void>;
    onGenerateComposite: () => Promise<void>;
    onRegenerateComposite: () => Promise<void>;
    onCreateNodes: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const StoryboardGeneratorModal: React.FC<StoryboardGeneratorModalProps> = ({
    isOpen,
    onClose,
    state,
    onSetStep,
    onToggleCharacter,
    onSetSceneCount,
    onSetStory,
    onUpdateScript,
    onGenerateScripts,
    onBrainstormStory,
    onOptimizeStory,
    onGenerateComposite,
    onRegenerateComposite,
    onCreateNodes
}) => {
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const [characterAssets, setCharacterAssets] = useState<(CharacterAsset & { category: string })[]>([]);
    const [isLoadingAssets, setIsLoadingAssets] = useState(false);
    const [editingScriptIndex, setEditingScriptIndex] = useState<number | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);

    // Mention picker state
    const [showMentionPicker, setShowMentionPicker] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [mentionIndex, setMentionIndex] = useState(0);
    const [mentionStartPos, setMentionStartPos] = useState(0);
    const textareaRef = useRef<HTMLDivElement>(null);


    // Step definitions for progress bar
    const stepDefinitions = [
        { id: 'characters', label: t('modals.storyboard.steps.characters'), icon: Users },
        { id: 'story', label: t('modals.storyboard.steps.story'), icon: PenTool },
        { id: 'scripts', label: t('modals.storyboard.steps.scripts'), icon: Film },
        { id: 'preview', label: t('modals.storyboard.steps.preview'), icon: Eye },
        { id: 'generate', label: t('modals.storyboard.steps.generate'), icon: Sparkles }
    ];

    const currentStepIndex = stepDefinitions.findIndex(s => s.id === state.step);


    /**
     * Start composite fetch when landing on preview with no URL.
     * Ref avoids re-running when generateComposite's identity changes (script edits) — that caused repeat requests and flicker.
     * In-flight dedupe lives in the hook.
     */
    const generateCompositeRef = useRef(onGenerateComposite);
    generateCompositeRef.current = onGenerateComposite;

    useEffect(() => {
        if (state.step !== 'preview' || state.compositeImageUrl) return;
        generateCompositeRef.current();
    }, [state.step, state.compositeImageUrl]);


    // Fetch character assets from library
    useEffect(() => {
        if (!isOpen) return;

        const fetchAssets = async () => {
            setIsLoadingAssets(true);
            try {
                const response = await authFetch(apiEndpoint('/api/library'));
                if (response.ok) {
                    const assets = await response.json();
                    // Filter to show all image assets and include category info
                    const imageAssets = assets
                        .filter((a: any) => a.type === 'image')
                        .map((a: any) => ({
                            id: a.id,
                            name: a.name,
                            url: a.url,
                            description: a.description || '',
                            category: a.category || 'Others'
                        }));
                    setCharacterAssets(imageAssets);
                    setSelectedCategory('All');
                }
            } catch (error) {
                console.error('[StoryboardModal] Failed to fetch assets:', error);
            } finally {
                setIsLoadingAssets(false);
            }
        };

        fetchAssets();
    }, [isOpen]);

    const translateCategory = useCallback((cat: string) => {
        return t(`modals.storyboard.categories.${cat}`, cat);
    }, [t]);

    // Get unique categories from loaded assets (exclude Sound Effect)
    const availableCategories = useMemo(() => {
        const categories = new Set(characterAssets.map(a => a.category));
        categories.delete('Sound Effect');
        return ['All', ...Array.from(categories).sort()];
    }, [characterAssets]);

    // Filter assets by selected category
    const filteredAssets = useMemo(() => {
        if (selectedCategory === 'All') return characterAssets;
        return characterAssets.filter(a => a.category === selectedCategory);
    }, [characterAssets, selectedCategory]);

    // Filter mention suggestions based on current filter text
    const mentionSuggestions = useMemo(() => {
        if (!showMentionPicker || state.selectedCharacters.length === 0) return [];
        const filter = mentionFilter.toLowerCase();
        return state.selectedCharacters.filter(c =>
            c.name.toLowerCase().includes(filter)
        );
    }, [showMentionPicker, mentionFilter, state.selectedCharacters]);

    const getMentionedAssetsFromStory = useCallback(() => {
        const normalized = String(state.story || '')
            .replace(/\*\*(@[^\s@，。！？,.!?:：；;、（）()「」『』[\]{}<>《》"'“”‘’*]+)\*\*/g, '$1')
            .replace(/__(@[^\s@，。！？,.!?:：；;、（）()「」『』[\]{}<>《》"'“”‘’*_]+)__/g, '$1')
            .replace(/`(@[^`\s]+)`/g, '$1');
        const mentions = normalized.match(/@[^\s@，。！？,.!?:：；;、（）()「」『』[\]{}<>《》"'“”‘’*]+/g) || [];
        const mentionNames = new Set(mentions.map(m => m.slice(1)).filter(Boolean));
        if (mentionNames.size === 0) return [];
        return characterAssets.filter(asset => mentionNames.has(asset.name));
    }, [state.story, characterAssets]);

    const appendMentionToStory = useCallback((story: string, assetName: string) => {
        // contentEditable innerText can keep trailing newlines/spaces;
        // trim tail whitespace to prevent inserted mention from jumping to next line.
        const normalizedStory = (story || '').replace(/\s+$/g, '');
        const mention = `@${assetName}`;
        return normalizedStory ? `${normalizedStory} ${mention} ` : `${mention} `;
    }, []);

    // Handle story change with mention detection
    const handleStoryChange = useCallback((value: string) => {
        // Calculate cursor position for mention detection
        let cursorPos = value.length;
        if (textareaRef.current) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && textareaRef.current.contains(sel.anchorNode)) {
                try {
                    const range = sel.getRangeAt(0);
                    const preCaretRange = range.cloneRange();
                    preCaretRange.selectNodeContents(textareaRef.current);
                    preCaretRange.setEnd(range.endContainer, range.endOffset);
                    cursorPos = preCaretRange.toString().length;
                } catch (e) {
                    console.warn('Failed to calculate cursor position', e);
                }
            }
        }

        const textBeforeCursor = value.substring(0, cursorPos);
        const atIndex = textBeforeCursor.lastIndexOf('@');

        if (atIndex !== -1) {
            // Check if @ is at start or preceded by space/newline
            const charBefore = textBeforeCursor[atIndex - 1];
            if (atIndex === 0 || charBefore === ' ' || charBefore === '\n') {
                const filterText = textBeforeCursor.substring(atIndex + 1);
                // Only show if no space after @ (user is still typing the mention)
                if (!filterText.includes(' ')) {
                    setShowMentionPicker(true);
                    setMentionFilter(filterText);
                    setMentionStartPos(atIndex);
                    setMentionIndex(0);
                } else {
                    setShowMentionPicker(false);
                }
            } else {
                setShowMentionPicker(false);
            }
        } else {
            setShowMentionPicker(false);
        }

        onSetStory(value);
    }, [onSetStory]);

    // Insert a mention at the current position
    const insertMention = useCallback((asset: CharacterAsset) => {
        const value = state.story;
        const beforeMention = value.substring(0, mentionStartPos);
        const afterMention = value.substring(mentionStartPos + mentionFilter.length + 1); // +1 for @
        const newValue = beforeMention + '@' + asset.name + ' ' + afterMention;
        onSetStory(newValue);
        setShowMentionPicker(false);
        setMentionFilter('');

        // Focus input after mention
        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                // Move cursor to end logic handled by StoryInput fallback or browser default
            }
        }, 0);
    }, [state.story, mentionStartPos, mentionFilter, onSetStory]);

    // Handle keyboard navigation for mention picker
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!showMentionPicker || mentionSuggestions.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setMentionIndex(prev => (prev + 1) % mentionSuggestions.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setMentionIndex(prev => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            insertMention(mentionSuggestions[mentionIndex]);
        } else if (e.key === 'Escape') {
            setShowMentionPicker(false);
        }
    }, [showMentionPicker, mentionSuggestions, mentionIndex, insertMention]);

    if (!isOpen) return null;

    /** Light-mode–aware tokens (modal was neutral-800 everywhere). */
    const th = {
        borderHeader: isDark ? 'border-neutral-800/50' : 'border-gray-200',
        borderMid: isDark ? 'border-neutral-800/30' : 'border-gray-200/90',
        borderFooter: isDark ? 'border-neutral-800' : 'border-gray-200',
        title: isDark ? 'text-white' : 'text-gray-900',
        subtitle: isDark ? 'text-neutral-500' : 'text-gray-600',
        heading: isDark ? 'text-white' : 'text-gray-900',
        body: isDark ? 'text-neutral-400' : 'text-gray-600',
        muted: isDark ? 'text-neutral-500' : 'text-gray-500',
        closeBtn: isDark ? 'hover:bg-neutral-800/80' : 'hover:bg-gray-100',
        closeIcon: isDark ? 'text-neutral-500 group-hover:text-neutral-300' : 'text-gray-500 group-hover:text-gray-700',
        stepTrack: isDark ? 'bg-neutral-800' : 'bg-gray-200',
        stepLabelDone: isDark ? 'text-pink-200/90' : 'text-pink-500',
        stepLabelIdle: isDark ? 'text-neutral-400 group-hover:text-neutral-300' : 'text-gray-500 group-hover:text-gray-700',
        stepLabelOff: isDark ? 'text-neutral-600' : 'text-gray-400',
        categoryBtn: isDark
            ? 'bg-neutral-900 border border-neutral-700 text-white hover:border-neutral-600'
            : 'bg-white border border-gray-200 text-gray-900 hover:border-gray-300 shadow-sm',
        categoryMeta: isDark ? 'text-neutral-400' : 'text-gray-500',
        categoryMeta2: isDark ? 'text-neutral-500' : 'text-gray-500',
        dropdown: isDark ? 'bg-neutral-900 border border-neutral-700' : 'bg-white border border-gray-200 shadow-xl',
        dropdownItem: isDark ? 'text-neutral-300 hover:bg-neutral-800' : 'text-gray-800 hover:bg-gray-100',
        refPanel: isDark ? 'bg-neutral-900/50 border border-neutral-800' : 'bg-gray-100 border border-gray-200',
        refChip: isDark
            ? 'bg-neutral-800 hover:bg-neutral-700'
            : 'bg-white hover:bg-gray-50 border border-gray-200',
        refChipText: isDark ? 'text-neutral-300 group-hover:text-white' : 'text-gray-800 group-hover:text-gray-900',
        refChipBadge: isDark ? 'text-neutral-500 bg-neutral-900' : 'text-gray-600 bg-gray-100',
        mentionPanel: isDark ? 'bg-neutral-900 border border-neutral-700' : 'bg-white border border-gray-200 shadow-2xl',
        mentionHead: isDark ? 'text-neutral-500 border-b border-neutral-700/50 bg-neutral-900' : 'text-gray-500 border-b border-gray-200 bg-gray-50',
        mentionRow: isDark ? 'hover:bg-neutral-800 text-neutral-300' : 'hover:bg-gray-100 text-gray-800',
        scriptCard: isDark ? 'bg-neutral-900 border border-neutral-700' : 'bg-white border border-gray-200 shadow-sm',
        scriptSkeleton: isDark ? 'bg-neutral-900 border border-neutral-800' : 'bg-gray-50 border border-gray-200',
        pulse: isDark ? 'bg-neutral-800/50' : 'bg-gray-200/80',
        scriptTag: isDark ? 'bg-neutral-800' : 'bg-gray-100',
        scriptInput: isDark ? 'bg-neutral-800 border border-neutral-600' : 'bg-gray-50 border border-gray-300',
        scriptEditHover: isDark ? 'hover:bg-neutral-800' : 'hover:bg-gray-100',
        previewBox: isDark ? 'bg-neutral-900 border border-neutral-700' : 'bg-gray-50 border border-gray-200',
        summaryBox: isDark ? 'bg-neutral-900 border border-neutral-700' : 'bg-white border border-gray-200 shadow-sm',
        summaryVal: isDark ? 'text-white' : 'text-gray-900',
        footerBack: isDark ? 'text-neutral-300 hover:bg-neutral-800' : 'text-gray-700 hover:bg-gray-100',
        footerBackOff: isDark ? 'text-neutral-600' : 'text-gray-400',
        btnDisabled: isDark ? 'bg-neutral-800 text-neutral-500' : 'bg-gray-200 text-gray-400',
        labelS: isDark ? 'text-neutral-300' : 'text-gray-700',
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className={`absolute inset-0 backdrop-blur-sm ${isDark ? 'bg-black/70' : 'bg-black/40'}`}
            />

            {/* Modal */}
            <HoverBorderGradient
                variant="subtle"
                containerClassName="rounded-xl w-full max-w-2xl"
                className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
                fillClassName={isDark ? undefined : 'bg-white'}
                duration={4}
            >
            <div className="relative max-h-[85vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className={`px-6 py-4 border-b ${th.borderHeader} flex items-center justify-between`}>
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                                isDark
                                    ? 'sf-rainbow-btn !p-0 text-white'
                                    : 'lt-btn !p-0 !shadow-sm'
                            }`}
                        >
                            <Film size={20} />
                        </div>
                        <div className="min-w-0">
                            <h2 className={`text-lg font-semibold leading-tight ${th.title}`}>{t('modals.storyboard.title')}</h2>
                            <p className={`text-xs mt-0.5 ${th.subtitle}`}>{t('modals.storyboard.subtitle')}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-lg transition-all duration-200 group ${th.closeBtn}`}
                    >
                        <X size={18} className={`transition-colors ${th.closeIcon}`} />
                    </button>
                </div>

                {/* Step Indicator — vibrant connected dots, mirrors CanvasNode selection palette */}
                <div className={`px-6 pt-4 pb-5 border-b ${th.borderHeader}`}>
                    <div
                        className={`relative rounded-xl px-5 py-4 ${
                            isDark
                                ? 'bg-gradient-to-br from-white/[0.04] to-white/[0.015] border border-white/[0.07] shadow-inner shadow-black/20'
                                : 'bg-gradient-to-br from-gray-50/95 to-white border border-gray-200/90 shadow-sm'
                        }`}
                    >
                        <div className="flex items-center justify-between relative">
                            {/* Progress line background */}
                            <div className={`absolute left-3 right-3 h-[3px] rounded-full ${th.stepTrack}`} style={{ top: '14px' }} />
                            {/* Progress line filled — purple→pink (matches global accent) */}
                            <div
                                className="absolute left-3 h-[3px] rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-purple-500 via-pink-500 to-rose-400 shadow-sm shadow-pink-500/40"
                                style={{
                                    top: '14px',
                                    width: `calc((100% - 24px) * ${currentStepIndex / Math.max(1, stepDefinitions.length - 1)})`,
                                }}
                            />

                            {stepDefinitions.map((step, index) => {
                                let isAccessible = false;
                                if (index <= currentStepIndex) isAccessible = true;
                                else if (step.id === 'story' && state.story.trim().length > 0) isAccessible = true;
                                else if (step.id === 'scripts' && state.scripts.length > 0) isAccessible = true;
                                else if ((step.id === 'preview' || step.id === 'generate') && state.compositeImageUrl) isAccessible = true;

                                const isCompleted = isAccessible && index < currentStepIndex;
                                const isCurrent = index === currentStepIndex;

                                return (
                                    <button
                                        key={step.id}
                                        onClick={() => isAccessible && onSetStep(step.id as StoryboardState['step'])}
                                        disabled={!isAccessible}
                                        className={`flex flex-col items-center gap-2 relative z-10 group ${
                                            isAccessible ? 'cursor-pointer' : 'cursor-not-allowed'
                                        }`}
                                    >
                                        {/* Pulse halo for current step only */}
                                        {isCurrent && (
                                            <span className="absolute -top-2 w-11 h-11 rounded-full bg-gradient-to-br from-purple-500/25 to-pink-500/25 motion-safe:animate-ping" style={{ animationDuration: '2.4s' }} />
                                        )}
                                        {/* Soft glow under current dot */}
                                        {isCurrent && (
                                            <span className="absolute -top-1 w-9 h-9 rounded-full bg-gradient-to-br from-purple-500/30 to-pink-500/30 blur-md" />
                                        )}
                                        {/* Step dot */}
                                        <div
                                            className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                                                isCurrent
                                                    ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg shadow-pink-500/40 ring-2 ring-white/40 dark:ring-white/30 scale-110'
                                                    : isCompleted
                                                        ? isDark
                                                            ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-sm shadow-pink-500/20 opacity-90'
                                                            : 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-sm shadow-pink-500/25 opacity-90'
                                                        : isAccessible
                                                            ? isDark
                                                                ? 'bg-neutral-800 text-neutral-300 border border-neutral-600 group-hover:border-purple-400/60 group-hover:text-white'
                                                                : 'bg-white text-gray-600 border border-gray-300 shadow-sm group-hover:border-purple-400 group-hover:text-purple-600'
                                                            : isDark
                                                                ? 'bg-neutral-900 text-neutral-600 border border-neutral-800'
                                                                : 'bg-gray-100 text-gray-400 border border-gray-200'
                                            }`}
                                        >
                                            {isCompleted ? (
                                                <Check size={14} strokeWidth={3} />
                                            ) : (
                                                <step.icon size={14} strokeWidth={isCurrent ? 2.5 : 2} />
                                            )}
                                        </div>
                                        {/* Step label */}
                                        <span
                                            className={`text-[11px] font-medium tracking-wide transition-colors duration-200 ${
                                                isCurrent
                                                    ? isDark ? 'text-white' : 'text-gray-900'
                                                    : isCompleted
                                                        ? th.stepLabelDone
                                                        : isAccessible
                                                            ? th.stepLabelIdle
                                                            : th.stepLabelOff
                                            }`}
                                        >
                                            {step.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Characters Step Header - Fixed outside scroll area */}
                {state.step === 'characters' && (
                    <div className={`px-6 pt-6 pb-4 border-b ${th.borderMid}`}>
                        <h3 className={`${th.heading} font-medium mb-2`}>{t('modals.storyboard.characters.title')}</h3>
                        <p className={`${th.body} text-sm mb-4`}>
                            {t('modals.storyboard.characters.description')}
                        </p>

                        {/* Category Dropdown */}
                        {characterAssets.length > 0 && (
                            <div className="relative">
                                <button
                                    onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-colors ${th.categoryBtn}`}
                                >
                                    <span className="flex items-center gap-2">
                                        <span className={th.categoryMeta}>{t('modals.storyboard.characters.category')}:</span>
                                        <span className="font-medium">{translateCategory(selectedCategory)}</span>
                                        <span className={`${th.categoryMeta2} text-xs`}>({filteredAssets.length} {t('modals.storyboard.characters.items')})</span>
                                    </span>
                                    <ChevronDown size={16} className={`${th.categoryMeta} transition-transform duration-200 ${isCategoryDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isCategoryDropdownOpen && (
                                    <div className={`absolute z-20 w-full mt-1 rounded-xl overflow-hidden ${th.dropdown}`}>
                                        {availableCategories.map(category => (
                                            <button
                                                key={category}
                                                onClick={() => {
                                                    setSelectedCategory(category);
                                                    setIsCategoryDropdownOpen(false);
                                                }}
                                                className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${selectedCategory === category
                                                    ? isDark ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-white'
                                                    : th.dropdownItem
                                                    }`}
                                            >
                                                <span className="flex items-center justify-between">
                                                    <span>{translateCategory(category)}</span>
                                                    <span className="text-xs opacity-60">
                                                        {category === 'All'
                                                            ? characterAssets.length
                                                            : characterAssets.filter(a => a.category === category).length}
                                                    </span>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* Error Message */}
                    {state.error && (
                        <div className={`mb-4 p-3 rounded-lg text-sm border ${isDark ? 'bg-red-900/20 border-red-800 text-red-400' : 'bg-red-50 border-red-200 text-red-700'}`}>
                            {sanitizeError(state.error)}
                        </div>
                    )}

                    {/* Step 1: Character Selection - Grid Only */}
                    {state.step === 'characters' && (

                        <div>
                            {isLoadingAssets ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 sf-rainbow-text animate-spin" />
                                </div>
                            ) : characterAssets.length === 0 ? (
                                <div className={`text-center py-12 ${th.muted}`}>
                                    <Users size={48} className="mx-auto mb-3 opacity-50" />
                                    <p>{t('modals.storyboard.characters.noImages')}</p>
                                    <p className="text-xs mt-1">{t('modals.storyboard.characters.noImagesHint')}</p>
                                </div>
                            ) : filteredAssets.length === 0 ? (
                                <div className={`text-center py-12 ${th.muted}`}>
                                    <Users size={48} className="mx-auto mb-3 opacity-50" />
                                    <p>{t('modals.storyboard.characters.noCategoryImages', { category: selectedCategory })}</p>
                                    <p className="text-xs mt-1">{t('modals.storyboard.characters.tryCategoryHint')}</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-4">
                                    {filteredAssets.map(character => {
                                        const isSelected = state.selectedCharacters.some(c => c.id === character.id);
                                        return (
                                            <button
                                                key={character.id}
                                                onClick={() => onToggleCharacter(character)}
                                                className={`relative aspect-square rounded-xl overflow-hidden transition-all duration-300 group cursor-pointer ${
                                                    isSelected
                                                        ? isDark
                                                            ? 'shadow-[0_0_25px_rgba(192,132,252,0.25)] scale-[1.02]'
                                                            : 'lt-card-selected scale-[1.02]'
                                                        : 'hover:scale-[1.02] hover:-translate-y-0.5'
                                                }`}
                                            >
                                                {/* Image */}
                                                <img
                                                    src={ossResize(character.url, 200)}
                                                    alt={character.name}
                                                    loading="lazy"
                                                    className={`w-full h-full object-cover transition-all duration-300 ${
                                                        isSelected ? 'brightness-100' : 'brightness-90 group-hover:brightness-100'
                                                    }`}
                                                />

                                                {/* Selected ring overlay (purple, matches CanvasNode/lt-card-selected) */}
                                                {isSelected && (
                                                    <div className="absolute inset-0 rounded-xl pointer-events-none ring-2 ring-purple-400/80 ring-inset" />
                                                )}

                                                {/* Frosted glass name label */}
                                                <div className="absolute inset-x-0 bottom-0 backdrop-blur-md bg-black/45 border-t border-white/10 p-2.5">
                                                    <p className="text-white text-xs font-medium truncate">
                                                        {character.name}
                                                    </p>
                                                </div>

                                                {/* Selection indicator (purple to match selected ring) */}
                                                <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 ${
                                                    isSelected
                                                        ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-md shadow-purple-500/40 scale-100 opacity-100'
                                                        : 'bg-black/40 backdrop-blur-sm scale-90 opacity-0 group-hover:opacity-100 border border-white/20'
                                                }`}>
                                                    <Check size={12} className="text-white" strokeWidth={3} />
                                                </div>

                                                {/* Hover overlay */}
                                                <div className={`absolute inset-0 transition-opacity duration-300 pointer-events-none ${
                                                    isSelected
                                                        ? 'bg-purple-500/[0.06] opacity-100'
                                                        : isDark
                                                            ? 'bg-white/5 opacity-0 group-hover:opacity-100'
                                                            : 'bg-gray-900/10 opacity-0 group-hover:opacity-100'
                                                }`} />
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 2: Story Input */}
                    {state.step === 'story' && (
                        <div>
                            <h3 className={`${th.heading} font-medium mb-2`}>{t('modals.storyboard.story.title')}</h3>
                            <p className={`${th.body} text-sm mb-4`}>
                                {t('modals.storyboard.story.description', { count: state.sceneCount })}
                            </p>

                            {/* Selected Reference Images - clickable to insert @ mention */}
                            {state.selectedCharacters.length > 0 && (
                                <div className={`mb-4 p-3 rounded-xl ${th.refPanel}`}>
                                    <p className={`text-xs ${th.body} mb-2`}>
                                        {t('modals.storyboard.story.selectedRefs')}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {state.selectedCharacters.map(asset => (
                                            <button
                                                key={asset.id}
                                                onClick={() => {
                                                    onSetStory(appendMentionToStory(state.story, asset.name));
                                                }}
                                                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors group ${th.refChip}`}
                                            >
                                                <img
                                                    src={ossResize(asset.url, 50)}
                                                    alt={asset.name}
                                                    className="w-6 h-6 rounded object-cover"
                                                />
                                                <span className={`text-xs ${th.refChipText}`}>
                                                    @{asset.name}
                                                </span>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${th.refChipBadge}`}>
                                                    {translateCategory(asset.category || 'Others')}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Scene Count Slider */}
                            <div className="mb-4">
                                <label className={`block text-sm ${th.labelS} mb-2`}>
                                    {t('modals.storyboard.story.sceneCount')}: <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{state.sceneCount}</span>
                                </label>
                                <input
                                    type="range"
                                    min={1}
                                    max={10}
                                    value={state.sceneCount}
                                    onChange={(e) => onSetSceneCount(parseInt(e.target.value))}
                                    className={`w-full ${isDark ? 'accent-neutral-400' : 'accent-neutral-500'}`}
                                />
                                <div className={`flex justify-between text-xs mt-1 ${th.muted}`}>
                                    <span>1</span>
                                    <span>10</span>
                                </div>
                            </div>

                            {/* Brainstorm with AI Button */}
                            <button
                                onClick={onBrainstormStory}
                                disabled={state.isBrainstorming}
                                className="mb-3 flex items-center gap-2 text-sm sf-rainbow-text transition-colors group"
                            >
                                {state.isBrainstorming ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" />
                                        <span>{t('modals.storyboard.story.brainstorming')}</span>
                                    </>
                                ) : (
                                    <>
                                        <Wand2 size={14} className="group-hover:rotate-12 transition-transform" />
                                        <span className="underline decoration-dashed underline-offset-2">{t('modals.storyboard.story.brainstorm')}</span>
                                        <span className={`${th.muted} text-xs`}>{t('modals.storyboard.story.brainstormHint')}</span>
                                    </>
                                )}
                            </button>

                            {/* Story Textarea with Mention Picker */}
                            <div className="relative">
                                <StoryInput
                                    inputRef={textareaRef}
                                    value={state.story}
                                    onChange={handleStoryChange}
                                    onKeyDown={handleKeyDown}
                                    onBlur={() => {
                                        // Delay closing to allow click on mention
                                        setTimeout(() => setShowMentionPicker(false), 150);
                                    }}
                                    placeholder={state.selectedCharacters.length > 0
                                        ? t('modals.storyboard.story.placeholderWithRef', { name: state.selectedCharacters[0]?.name })
                                        : t('modals.storyboard.story.placeholder')}
                                    assets={state.selectedCharacters}
                                    className="min-h-[12rem]"
                                />

                                {/* Mention Picker Dropdown */}
                                {showMentionPicker && mentionSuggestions.length > 0 && (
                                    <div className={`absolute left-4 top-10 w-64 rounded-lg overflow-hidden z-50 ${th.mentionPanel}`}>
                                        <div className={`text-[10px] px-3 py-1 ${th.mentionHead}`}>
                                            {t('modals.storyboard.story.mentionHint')}
                                        </div>
                                        <div className="max-h-48 overflow-y-auto">
                                            {mentionSuggestions.map((asset, index) => (
                                                <button
                                                    key={asset.id}
                                                    onClick={() => insertMention(asset)}
                                                    onMouseEnter={() => setMentionIndex(index)}
                                                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${index === mentionIndex
                                                        ? isDark ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-white'
                                                        : th.mentionRow
                                                        }`}
                                                >
                                                    <img
                                                        src={ossResize(asset.url, 50)}
                                                        alt={asset.name}
                                                        className="w-7 h-7 rounded object-cover flex-shrink-0"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-medium truncate">@{asset.name}</div>
                                                        <div className={`text-[10px] ${index === mentionIndex ? 'text-white/80' : th.body}`}>{translateCategory(asset.category || 'Others')}</div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-between items-start mt-2">
                                <p className={`text-xs ${th.muted}`}>
                                    {t('modals.storyboard.story.tip')}
                                </p>
                                <button
                                    onClick={() => onOptimizeStory(getMentionedAssetsFromStory())}
                                    disabled={state.isOptimizing || !state.story.trim()}
                                    className={`text-xs flex items-center gap-1.5 transition-colors ${state.story.trim() ? 'sf-rainbow-text' : `${th.footerBackOff} cursor-not-allowed`
                                        }`}
                                >
                                    {state.isOptimizing ? (
                                        <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                        <Wand2 size={12} />
                                    )}
                                    {t('modals.storyboard.story.optimize')}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Script Review */}
                    {state.step === 'scripts' && (
                        <div>
                            <h3 className={`${th.heading} font-medium mb-2`}>{t('modals.storyboard.scripts.title')}</h3>
                            <p className={`${th.body} text-sm mb-4`}>
                                {t('modals.storyboard.scripts.description', { count: state.scripts.length })}
                            </p>

                            <div className="space-y-3">
                                {state.isGenerating ? (
                                    // SKELETON LOADERS
                                    Array.from({ length: state.sceneCount }).map((_, i) => (
                                        <div key={i} className={`rounded-xl p-4 relative overflow-hidden ${th.scriptSkeleton}`}>
                                            {/* Shimmer Effect */}
                                            <div className={`absolute inset-0 animate-[pulse_2s_infinite] ${isDark ? 'bg-gradient-to-r from-transparent via-white/5 to-transparent' : 'bg-gradient-to-r from-transparent via-gray-300/40 to-transparent'}`} />

                                            <div className="flex items-center justify-between mb-3">
                                                <div className={`h-4 w-20 rounded animate-pulse ${th.pulse}`} />
                                                <div className="flex gap-2">
                                                    <div className={`h-4 w-16 rounded animate-pulse ${th.pulse}`} />
                                                    <div className={`h-4 w-16 rounded animate-pulse ${th.pulse}`} />
                                                </div>
                                            </div>

                                            <div className="space-y-2 mb-2">
                                                <div className={`h-3 w-full rounded animate-pulse ${th.pulse}`} />
                                                <div className={`h-3 w-5/6 rounded animate-pulse ${th.pulse}`} />
                                                <div className={`h-3 w-4/6 rounded animate-pulse ${th.pulse}`} />
                                            </div>

                                            <div className="flex items-center justify-center sf-rainbow-text opacity-50 text-xs font-medium gap-2 pt-2">
                                                <Loader2 size={12} className="animate-spin" />
                                                {t('modals.storyboard.scripts.creating', { num: i + 1 })}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    // ACTUAL CONTENTS
                                    state.scripts.map((script, index) => (
                                        <div
                                            key={index}
                                            className={`rounded-xl p-4 ${th.scriptCard}`}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="sf-rainbow-text text-sm font-medium">
                                                    {t('modals.storyboard.scripts.scene')} {script.sceneNumber}
                                                </span>
                                                <div className={`flex items-center gap-2 text-xs ${th.muted}`}>
                                                    <span className={`px-2 py-0.5 rounded ${th.scriptTag}`}>
                                                        {script.cameraAngle}
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded ${th.scriptTag}`}>
                                                        {script.mood}
                                                    </span>
                                                </div>
                                            </div>

                                            {editingScriptIndex === index ? (
                                                <StoryInput
                                                    value={script.description}
                                                    onChange={(val) => onUpdateScript(index, { description: val })}
                                                    onBlur={() => setEditingScriptIndex(null)}
                                                    assets={state.selectedCharacters}
                                                    className={`w-full rounded-lg p-2 min-h-[5rem] ${th.scriptInput}`}
                                                // autoFocus is trickier with contentEditable, handled by ref usually but let's test
                                                />
                                            ) : (
                                                <div
                                                    onClick={() => setEditingScriptIndex(index)}
                                                    className={`cursor-pointer rounded-lg -m-2 p-2 transition-colors group relative ${th.scriptEditHover}`}
                                                >
                                                    <StoryInput
                                                        value={script.description}
                                                        onChange={() => { }}
                                                        assets={state.selectedCharacters}
                                                        readOnly
                                                        className="bg-transparent border-none p-0 min-h-0 h-auto overflow-visible"
                                                    />
                                                    <Edit3 size={12} className={`absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity ${th.muted}`} />
                                                </div>
                                            )}
                                        </div>
                                    )))}
                            </div>
                        </div>
                    )}

                    {/* STEP 4: PREVIEW COMPOSITE */}
                    {state.step === 'preview' && (
                        <div className="flex flex-col h-full">
                            <h3 className={`${th.heading} font-medium mb-2`}>{t('modals.storyboard.preview.title')}</h3>
                            <p className={`${th.body} text-sm mb-4`}>
                                {t('modals.storyboard.preview.description')}
                            </p>

                            <div className={`flex-1 rounded-xl overflow-hidden flex items-center justify-center p-4 relative group ${th.previewBox}`}>
                                {state.isGeneratingPreview ? (
                                    <div className="text-center min-h-[12rem] flex flex-col items-center justify-center">
                                        {/* Single animation (spin only) — sf-rainbow + spin looked jittery */}
                                        <Loader2
                                            size={48}
                                            className={`mx-auto mb-4 motion-safe:animate-spin [animation-duration:0.9s] will-change-transform ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}
                                            aria-hidden
                                        />
                                        <p className={`${th.heading} font-medium`}>{t('modals.storyboard.preview.generating')}</p>
                                        <p className={`${th.body} text-sm mt-2 max-w-sm`}>{t('modals.storyboard.preview.generatingHint')}</p>
                                    </div>
                                ) : state.compositeImageUrl ? (
                                    <div className="relative w-full h-full flex items-center justify-center">
                                        <img
                                            src={state.compositeImageUrl}
                                            alt="Storyboard Composite"
                                            className="max-h-full max-w-full object-contain rounded shadow-lg"
                                        />
                                        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={onRegenerateComposite}
                                                className="bg-black/70 hover:bg-black/90 text-white px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-sm flex items-center gap-2 border border-white/10"
                                            >
                                                <Wand2 size={12} />
                                                {t('modals.storyboard.preview.regenerate')}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`text-center ${th.muted}`}>
                                        <p>{t('modals.storyboard.preview.noPreview')}</p>
                                        <button
                                            onClick={onGenerateComposite}
                                            className="mt-4 sf-rainbow-text text-sm underline"
                                        >
                                            {t('modals.storyboard.preview.generatePreview')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* STEP 5: GENERATE (Summary now, since model selection is removed) */}
                    {state.step === 'generate' && (
                        <div>
                            <h3 className={`${th.heading} font-medium mb-2`}>{t('modals.storyboard.generate.title')}</h3>
                            <p className={`${th.body} text-sm mb-4`}>
                                {t('modals.storyboard.generate.description')}
                            </p>

                            <div className={`rounded-xl p-4 ${th.summaryBox}`}>
                                <h4 className={`${th.heading} text-sm font-medium mb-2`}>{t('modals.storyboard.generate.summary')}</h4>
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className={th.body}>{t('modals.storyboard.generate.characters')}:</div>
                                    <div className={th.summaryVal}>
                                        {state.selectedCharacters.length > 0
                                            ? state.selectedCharacters.map(c => c.name).join(', ')
                                            : t('modals.storyboard.generate.noneSelected')}
                                    </div>
                                    <div className={th.body}>{t('modals.storyboard.generate.scenes')}:</div>
                                    <div className={th.summaryVal}>{state.scripts.length}</div>
                                    <div className={th.body}>{t('modals.storyboard.generate.model')}:</div>
                                    <div className={th.summaryVal}>GEM 3.0</div>
                                    <div className={th.body}>{t('modals.storyboard.generate.previewStatus')}:</div>
                                    <div className={th.summaryVal}>{state.compositeImageUrl ? t('modals.storyboard.generate.generated') : t('modals.storyboard.generate.notAvailable')}</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className={`px-6 py-4 border-t ${th.borderFooter} flex items-center justify-between`}>
                    {/* Back Button */}
                    <button
                        onClick={() => {
                            if (state.step === 'story') onSetStep('characters');
                            else if (state.step === 'scripts') onSetStep('story');
                            else if (state.step === 'preview') onSetStep('scripts');
                            else if (state.step === 'generate') onSetStep('preview');
                        }}
                        disabled={state.step === 'characters'}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${state.step === 'characters'
                            ? `${th.footerBackOff} cursor-not-allowed`
                            : th.footerBack
                            }`}
                    >
                        <ChevronLeft size={16} />
                        {t('modals.storyboard.nav.back')}
                    </button>

                    {/* Selected Characters Count - shown in footer for characters step */}
                    {state.step === 'characters' && (
                        <p className={`text-xs ${th.muted}`}>
                            {t('modals.storyboard.characters.selected')}: {state.selectedCharacters.length}/3 {t('modals.storyboard.characters.optional')}
                        </p>
                    )}

                    {/* Next/Generate Button */}
                    {state.step === 'characters' && (
                        <button
                            onClick={() => onSetStep('story')}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${footerPrimaryEnabled(isDark)}`}
                        >
                            {t('modals.storyboard.nav.next')}
                            <ChevronRight size={16} />
                        </button>
                    )}

                    {state.step === 'story' && (
                        <button
                            onClick={onGenerateScripts}
                            disabled={state.isGenerating || !state.story.trim()}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${state.isGenerating || !state.story.trim()
                                ? `${th.btnDisabled} cursor-not-allowed`
                                : footerPrimaryEnabled(isDark)
                                }`}
                        >
                            {state.isGenerating ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    {t('modals.storyboard.nav.generatingScripts')}
                                </>
                            ) : (
                                <>
                                    <Sparkles size={16} />
                                    {t('modals.storyboard.nav.generateScripts')}
                                </>
                            )}
                        </button>
                    )}

                    {state.step === 'scripts' && (
                        <button
                            onClick={() => {
                                if (state.compositeImageUrl) {
                                    onRegenerateComposite();
                                } else {
                                    onSetStep('preview');
                                }
                            }}
                            disabled={state.isGeneratingPreview}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${state.isGeneratingPreview
                                ? `${th.btnDisabled} cursor-not-allowed`
                                : footerPrimaryEnabled(isDark)
                                }`}
                        >
                            {state.isGeneratingPreview ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    {t('modals.storyboard.nav.generatingScripts')}
                                </>
                            ) : state.compositeImageUrl ? (
                                <>
                                    <Sparkles size={16} />
                                    {t('modals.storyboard.nav.regeneratePreview')}
                                </>
                            ) : (
                                <>
                                    {t('modals.storyboard.nav.next')} <ChevronRight size={16} />
                                </>
                            )}
                        </button>
                    )}

                    {state.step === 'preview' && (
                        <button
                            onClick={() => onSetStep('generate')}
                            disabled={!state.compositeImageUrl || state.isGeneratingPreview}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${!state.compositeImageUrl || state.isGeneratingPreview
                                ? `${th.btnDisabled} cursor-not-allowed`
                                : footerPrimaryEnabled(isDark)
                                }`}
                        >
                            {t('modals.storyboard.nav.next')} <ChevronRight size={16} />
                        </button>
                    )}

                    {state.step === 'generate' && (
                        <button
                            onClick={onCreateNodes}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${footerPrimaryEnabled(isDark)}`}
                        >
                            <Film size={16} />
                            {t('modals.storyboard.generate.createStoryboard')}
                        </button>
                    )}
                </div>
            </div>
            </HoverBorderGradient>
        </div>
    );
};
