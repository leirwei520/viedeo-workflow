/**
 * useImageEditorText.ts
 * 
 * Manages text annotation functionality for the image editor.
 * Handles text creation, editing, and styling.
 */

import React, { useState, useCallback } from 'react';
import { TextElement, EditorElement, PRESET_COLORS } from '../components/modals/imageEditor/imageEditor.types';

// ============================================================================
// TYPES
// ============================================================================

interface UseImageEditorTextProps {
    imageRef: React.RefObject<HTMLImageElement>;
    saveState: () => void;
    setElements: React.Dispatch<React.SetStateAction<EditorElement[]>>;
}

interface UseImageEditorTextReturn {
    // State
    isTextMode: boolean;
    setIsTextMode: React.Dispatch<React.SetStateAction<boolean>>;
    editingTextId: string | null;
    setEditingTextId: React.Dispatch<React.SetStateAction<string | null>>;
    textFontSize: number;
    setTextFontSize: React.Dispatch<React.SetStateAction<number>>;
    textColor: string;
    setTextColor: React.Dispatch<React.SetStateAction<string>>;
    showTextSettings: boolean;
    setShowTextSettings: React.Dispatch<React.SetStateAction<boolean>>;
    presetColors: string[];
    // Handlers
    handleTextCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    handleTextChange: (id: string, newText: string) => void;
    handleTextBlur: () => void;
    handleDeleteText: (id: string) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_FONT_SIZE = 24;
const DEFAULT_FONT_FAMILY = 'Arial, sans-serif';

// ============================================================================
// HOOK
// ============================================================================

export const useImageEditorText = ({
    imageRef,
    saveState,
    setElements
}: UseImageEditorTextProps): UseImageEditorTextReturn => {
    // --- State ---
    const [isTextMode, setIsTextMode] = useState(false);
    const [editingTextId, setEditingTextId] = useState<string | null>(null);
    const [textFontSize, setTextFontSize] = useState(DEFAULT_FONT_SIZE);
    const [textColor, setTextColor] = useState('#ff0000');
    const [showTextSettings, setShowTextSettings] = useState(false);

    // --- Handlers ---

    /**
     * Handle click on canvas in text mode - create new text element
     */
    const handleTextCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isTextMode) return;

        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Save state before creating text
        saveState();

        // Create new text element
        const newTextElement: TextElement = {
            id: `text-${Date.now()}`,
            type: 'text',
            x,
            y,
            text: 'Text',
            fontSize: textFontSize,
            color: textColor,
            fontFamily: DEFAULT_FONT_FAMILY
        };

        setElements(prev => [...prev, newTextElement]);
        setEditingTextId(newTextElement.id);
    }, [isTextMode, saveState, setElements, textFontSize, textColor]);

    /**
     * Update text content
     */
    const handleTextChange = useCallback((id: string, newText: string) => {
        setElements(prev => prev.map(el => {
            if (el.id === id && el.type === 'text') {
                return { ...el, text: newText };
            }
            return el;
        }));
    }, [setElements]);

    /**
     * Finish editing text
     */
    const handleTextBlur = useCallback(() => {
        setEditingTextId(null);
    }, []);

    /**
     * Delete a text element
     */
    const handleDeleteText = useCallback((id: string) => {
        saveState();
        setElements(prev => prev.filter(el => el.id !== id));
        setEditingTextId(null);
    }, [saveState, setElements]);

    return {
        isTextMode,
        setIsTextMode,
        editingTextId,
        setEditingTextId,
        textFontSize,
        setTextFontSize,
        textColor,
        setTextColor,
        showTextSettings,
        setShowTextSettings,
        presetColors: PRESET_COLORS,
        handleTextCanvasClick,
        handleTextChange,
        handleTextBlur,
        handleDeleteText
    };
};
