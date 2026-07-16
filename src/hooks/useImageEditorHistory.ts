/**
 * useImageEditorHistory.ts
 * 
 * Manages undo/redo functionality for the image editor.
 * Tracks canvas state and element changes for reversible editing.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { HistoryState, EditorElement } from '../components/modals/imageEditor/imageEditor.types';

// ============================================================================
// TYPES
// ============================================================================

interface UseImageEditorHistoryProps {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    elements: EditorElement[];
    setElements: React.Dispatch<React.SetStateAction<EditorElement[]>>;
    setSelectedElementId: React.Dispatch<React.SetStateAction<string | null>>;
    isOpen: boolean;
    imageUrl?: string;
    setImageUrl?: React.Dispatch<React.SetStateAction<string | undefined>>;
    onImageUrlChange?: (url: string) => void; // Callback when image URL changes (for syncing to node)
}

interface UseImageEditorHistoryReturn {
    historyStack: HistoryState[];
    redoStack: HistoryState[];
    captureState: () => void;
    commitPendingState: () => void;
    saveState: () => void;
    handleUndo: () => void;
    handleRedo: () => void;
    isUndoRedoRef: React.MutableRefObject<boolean>;
}

// ============================================================================
// HOOK
// ============================================================================

export const useImageEditorHistory = ({
    canvasRef,
    elements,
    setElements,
    setSelectedElementId,
    isOpen,
    imageUrl,
    setImageUrl,
    onImageUrlChange
}: UseImageEditorHistoryProps): UseImageEditorHistoryReturn => {
    // --- State ---
    const [historyStack, setHistoryStack] = useState<HistoryState[]>([]);
    const [redoStack, setRedoStack] = useState<HistoryState[]>([]);

    // --- Refs ---
    const isUndoRedoRef = useRef(false);
    const pendingStateRef = useRef<HistoryState | null>(null);
    const elementsRef = useRef<EditorElement[]>([]);
    const historyStackRef = useRef<HistoryState[]>([]);
    const redoStackRef = useRef<HistoryState[]>([]);
    const imageUrlRef = useRef<string | undefined>(undefined);

    // Keep refs in sync with state
    elementsRef.current = elements;
    historyStackRef.current = historyStack;
    redoStackRef.current = redoStack;
    imageUrlRef.current = imageUrl;

    // --- Capture/Save Functions ---

    /**
     * Capture current state at start of action (but don't save to history yet)
     */
    const captureState = useCallback(() => {
        if (isUndoRedoRef.current) return;

        const canvas = canvasRef.current;
        const canvasData = canvas ? canvas.toDataURL() : null;

        pendingStateRef.current = {
            canvasData,
            elements: [...elementsRef.current],
            imageUrl: imageUrlRef.current
        };
    }, [canvasRef]);

    /**
     * Commit pending state to history (call when action actually completes)
     */
    const commitPendingState = useCallback(() => {
        if (isUndoRedoRef.current || !pendingStateRef.current) return;

        setHistoryStack(prev => [...prev, pendingStateRef.current!]);
        setRedoStack([]);
        pendingStateRef.current = null;
    }, []);

    /**
     * Save current state immediately to history (for single-step actions like crop)
     */
    const saveState = useCallback(() => {
        if (isUndoRedoRef.current) return;

        const canvas = canvasRef.current;
        const canvasData = canvas ? canvas.toDataURL() : null;

        const newState: HistoryState = {
            canvasData,
            elements: [...elementsRef.current],
            imageUrl: imageUrlRef.current
        };

        setHistoryStack(prev => [...prev, newState]);
        setRedoStack([]);
    }, [canvasRef]);

    // --- Undo/Redo Functions ---

    /**
     * Undo last action
     */
    const handleUndo = useCallback(() => {
        const currentHistory = historyStackRef.current;
        if (currentHistory.length === 0) return;

        const newHistory = [...currentHistory];
        const previousState = newHistory.pop();

        if (!previousState) return;

        isUndoRedoRef.current = true;

        // Save current state to redo stack (including current image URL)
        const canvas = canvasRef.current;
        const currentCanvasData = canvas ? canvas.toDataURL() : null;
        const currentState: HistoryState = {
            canvasData: currentCanvasData,
            elements: [...elementsRef.current],
            imageUrl: imageUrlRef.current
        };
        setRedoStack(prev => [...prev, currentState]);

        // Update history stack
        setHistoryStack(newHistory);

        // Restore previous state
        setElements(previousState.elements);

        // Restore image URL if it changed (for crop undo)
        if (previousState.imageUrl !== undefined && previousState.imageUrl !== imageUrlRef.current) {
            setImageUrl?.(previousState.imageUrl);
            onImageUrlChange?.(previousState.imageUrl);
        }

        // Restore canvas
        if (previousState.canvasData && canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    isUndoRedoRef.current = false;
                };
                img.src = previousState.canvasData;
            }
        } else if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            isUndoRedoRef.current = false;
        } else {
            isUndoRedoRef.current = false;
        }

        setSelectedElementId(null);
    }, [canvasRef, setElements, setSelectedElementId, setImageUrl, onImageUrlChange]);

    /**
     * Redo last undone action
     */
    const handleRedo = useCallback(() => {
        const currentRedoStack = redoStackRef.current;
        if (currentRedoStack.length === 0) return;

        const newRedoStack = [...currentRedoStack];
        const nextState = newRedoStack.pop();

        if (!nextState) return;

        isUndoRedoRef.current = true;

        // Save current state to history stack (including current image URL)
        const canvas = canvasRef.current;
        const currentCanvasData = canvas ? canvas.toDataURL() : null;
        const currentState: HistoryState = {
            canvasData: currentCanvasData,
            elements: [...elementsRef.current],
            imageUrl: imageUrlRef.current
        };
        setHistoryStack(prev => [...prev, currentState]);

        // Update redo stack
        setRedoStack(newRedoStack);

        // Restore next state
        setElements(nextState.elements);

        // Restore image URL if it changed (for crop redo)
        if (nextState.imageUrl !== undefined && nextState.imageUrl !== imageUrlRef.current) {
            setImageUrl?.(nextState.imageUrl);
            onImageUrlChange?.(nextState.imageUrl);
        }

        // Restore canvas
        if (nextState.canvasData && canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    isUndoRedoRef.current = false;
                };
                img.src = nextState.canvasData;
            }
        } else if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            isUndoRedoRef.current = false;
        } else {
            isUndoRedoRef.current = false;
        }

        setSelectedElementId(null);
    }, [canvasRef, setElements, setSelectedElementId, setImageUrl, onImageUrlChange]);

    // --- Keyboard Shortcuts ---

    useEffect(() => {
        // Only attach keyboard listener when modal is open
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Handle undo/redo (use toLowerCase for Mac Shift+Z → 'Z')
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
                return;
            }

            // Prevent Delete/Backspace from propagating to main canvas
            // (which would delete the node)
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Only stop propagation if not in an input field
                const target = e.target as HTMLElement;
                const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
                if (!isInputField) {
                    e.stopPropagation();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, handleUndo, handleRedo]);

    return {
        historyStack,
        redoStack,
        captureState,
        commitPendingState,
        saveState,
        handleUndo,
        handleRedo,
        isUndoRedoRef
    };
};
