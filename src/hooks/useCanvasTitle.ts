/**
 * useCanvasTitle.ts
 * 
 * Custom hook for managing canvas title state and editing functionality.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const UNTITLED_VALUES = new Set(['未命名', 'Untitled']);

export const useCanvasTitle = (initialTitle?: string) => {
    const { t, i18n } = useTranslation();
    const [canvasTitle, setCanvasTitle] = useState(initialTitle || '');
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editingTitleValue, setEditingTitleValue] = useState(initialTitle || '');
    const canvasTitleInputRef = useRef<HTMLInputElement>(null);
    const hasUserSetTitle = useRef(!!initialTitle);

    // Update default title when language changes
    useEffect(() => {
        if (!hasUserSetTitle.current || !canvasTitle || UNTITLED_VALUES.has(canvasTitle)) {
            const translated = t('common.untitled');
            setCanvasTitle(translated);
            setEditingTitleValue(translated);
            hasUserSetTitle.current = false;
        }
    }, [i18n.language]);

    // Focus input when entering edit mode
    useEffect(() => {
        if (isEditingTitle && canvasTitleInputRef.current) {
            canvasTitleInputRef.current.focus();
            canvasTitleInputRef.current.select();
        }
    }, [isEditingTitle]);

    const setCanvasTitleWrapped = useCallback((title: string) => {
        hasUserSetTitle.current = true;
        setCanvasTitle(title);
    }, []);

    return {
        canvasTitle,
        setCanvasTitle: setCanvasTitleWrapped,
        isEditingTitle,
        setIsEditingTitle,
        editingTitleValue,
        setEditingTitleValue,
        canvasTitleInputRef
    };
};
