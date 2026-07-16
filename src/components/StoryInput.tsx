import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CharacterAsset } from '../hooks/useStoryboardGenerator';
import { useTheme } from '../hooks/useTheme';
import { cn } from '../utils/cn';

interface StoryInputProps {
    value: string;
    onChange: (value: string) => void;
    assets: CharacterAsset[]; // For resolving names to images
    placeholder?: string;
    className?: string;
    onBlur?: () => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    inputRef?: React.RefObject<HTMLDivElement>;
    readOnly?: boolean;
}

export const StoryInput: React.FC<StoryInputProps> = ({
    value,
    onChange,
    assets,
    placeholder,
    className,
    onBlur,
    onKeyDown,
    inputRef,
    readOnly = false
}) => {
    const { isDark } = useTheme();
    const internalRef = useRef<HTMLDivElement>(null);
    const ref = inputRef || internalRef;
    const lastValue = useRef(value);

    const escapeHtml = (text: string) => {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    const normalizeMentions = (text: string) => {
        return text
            .replace(/\*{2,}\s*(@[^\s@，。！？,.!?:：；;、（）()「」『』[\]{}<>《》"'""''*]+(?:\s+\S+)*?)\s*\*{2,}/g, '$1')
            .replace(/_{2,}\s*(@[^\s@，。！？,.!?:：；;、（）()「」『』[\]{}<>《》"'""''_]+(?:\s+\S+)*?)\s*_{2,}/g, '$1')
            .replace(/`\s*(@[^`]+?)\s*`/g, '$1');
    };

    // Boundary pattern for mention matching: whitespace, punctuation, CJK ideographs, end of string
    const MENTION_BOUNDARY = '(?=\\s|$|\\.|,|!|\\?|\u3002|\uFF0C|\uFF01|\uFF1F|\uFF1B|\uFF1A|\u3001|\uFF09|\\)|\\]|\u3011|\u300B|\u300D|\u300F|"|\'|\u201D|\u2019|\u2026|\u2014|[\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff\\u3040-\\u309f\\u30a0-\\u30ff\\uac00-\\ud7af])';

    const textToHtml = useCallback((text: string) => {
        if (!text) return '';
        let html = escapeHtml(normalizeMentions(text));

        // Deduplicate by asset name first; otherwise same-name assets (e.g. Character/Scene/Item)
        // can trigger repeated replacements and corrupt the generated HTML chips.
        const uniqueAssetsByName = new Map<string, CharacterAsset>();
        for (const asset of assets) {
            if (!asset?.name) continue;
            const existing = uniqueAssetsByName.get(asset.name);
            if (!existing) {
                uniqueAssetsByName.set(asset.name, asset);
                continue;
            }
            const existingIsCharacter = existing.category === 'Character';
            const nextIsCharacter = asset.category === 'Character';
            if (!existingIsCharacter && nextIsCharacter) {
                uniqueAssetsByName.set(asset.name, asset);
            }
        }

        // Sort unique names by length (descending) so longest names match first.
        const sortedAssets = [...uniqueAssetsByName.values()].sort((a, b) => b.name.length - a.name.length);

        // Build a single combined regex to replace all mentions in one pass.
        // This prevents shorter names (e.g. @我的素材) from matching inside
        // already-replaced chip HTML of longer names (e.g. @我的素材 2).
        const assetLookup = new Map<string, CharacterAsset>();
        const allPatterns: string[] = [];

        sortedAssets.forEach(asset => {
            const exactMention = `@${asset.name}`;
            const normalizedName = asset.name.replace(/\s+/g, '');
            const normalizedMention = `@${normalizedName}`;
            const escExact = exactMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escNorm = normalizedMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            assetLookup.set(exactMention, asset);
            if (normalizedMention !== exactMention) {
                assetLookup.set(normalizedMention, asset);
            }
            allPatterns.push(escExact === escNorm ? escExact : `${escExact}|${escNorm}`);
        });

        if (allPatterns.length > 0) {
            const combinedRegex = new RegExp(`(${allPatterns.join('|')})${MENTION_BOUNDARY}`, 'g');

            html = html.replace(combinedRegex, (match) => {
                const asset = assetLookup.get(match) || assetLookup.get(`@${match.slice(1).replace(/\s+/g, '')}`);
                if (!asset) return match;

                const safeMention = escapeHtml(`@${asset.name}`);
                const safeImageUrl = escapeHtml(asset.url || '');
                return `<span class="inline-flex items-center gap-1.5 align-middle bg-violet-500/10 border border-violet-500/30 rounded px-1.5 py-0.5 mx-0.5 select-none" contenteditable="false" data-mention="${safeMention}"><img src="${safeImageUrl}" class="w-4 h-4 rounded-sm object-cover" /><span class="text-violet-300 font-medium text-xs">${safeMention}</span></span>`;
            });
        }

        // Preserve newlines
        return html.replace(/\n/g, '<br>');
    }, [assets]);

    const saveSelection = (containerEl: Node) => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        try {
            const range = selection.getRangeAt(0);
            const preSelectionRange = range.cloneRange();
            preSelectionRange.selectNodeContents(containerEl);
            preSelectionRange.setEnd(range.startContainer, range.startOffset);
            return preSelectionRange.toString().length;
        } catch (e) {
            return null;
        }
    };

    const restoreSelection = (containerEl: Node, savedPos: number) => {
        if (savedPos === null) return;
        let charIndex = 0;
        const range = document.createRange();
        range.setStart(containerEl, 0);
        range.collapse(true);
        const nodeStack = [containerEl];
        let node;
        let found = false;

        while (!found && (node = nodeStack.pop())) {
            if (node.nodeType === 3) {
                const nextCharIndex = charIndex + (node.nodeValue?.length || 0);
                if (!found && savedPos >= charIndex && savedPos <= nextCharIndex) {
                    range.setStart(node, savedPos - charIndex);
                    range.collapse(true);
                    found = true;
                }
                charIndex = nextCharIndex;
            } else {
                let i = node.childNodes.length;
                while (i--) {
                    nodeStack.push(node.childNodes[i]);
                }
            }
        }

        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    };

    useEffect(() => {
        if (!ref.current) return;

        const currentText = ref.current.innerText;

        // Compare normalized values to avoid re-render loops from markdown stripping
        const normalizedValue = normalizeMentions(value);
        if (normalizedValue !== currentText) {
            const savedPos = document.activeElement === ref.current ? saveSelection(ref.current) : null;
            ref.current.innerHTML = textToHtml(value);
            if (savedPos !== null) {
                restoreSelection(ref.current, savedPos);
            } else if (document.activeElement === ref.current) {
                const range = document.createRange();
                range.selectNodeContents(ref.current);
                range.collapse(false);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            }
        }
        lastValue.current = value;
    }, [value, textToHtml]);

    const handleInput = (e: React.SyntheticEvent<HTMLDivElement>) => {
        if (ref.current) {
            const plainText = ref.current.innerText;
            if (plainText !== lastValue.current) {
                lastValue.current = plainText;
                onChange(plainText);
            }
        }
    };

    return (
        <div className="relative w-full h-full">
            {!value && placeholder && (
                <div className={cn(
                    'absolute top-4 left-4 pointer-events-none text-sm',
                    isDark ? 'text-neutral-500' : 'text-gray-500'
                )}>
                    {placeholder}
                </div>
            )}
            <div
                ref={ref}
                contentEditable={!readOnly}
                suppressContentEditableWarning
                onInput={!readOnly ? handleInput : undefined}
                onBlur={onBlur}
                onKeyDown={onKeyDown}
                className={cn(
                    'w-full h-full rounded-xl p-4 text-sm focus:outline-none overflow-y-auto whitespace-pre-wrap',
                    readOnly ? 'cursor-default' : 'cursor-text',
                    isDark
                        ? 'bg-neutral-900 border border-neutral-700 text-white focus:border-white/30'
                        : 'bg-white border border-gray-200 text-gray-900 shadow-sm focus:border-violet-400/60',
                    className
                )}
                style={{ minHeight: '12rem' }}
            />
        </div>
    );
};
