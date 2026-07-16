/**
 * useImageEditorDrawing.ts
 * 
 * Manages brush/eraser drawing functionality for the image editor.
 * Handles drawing state, canvas operations, and tool settings.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { PRESET_COLORS } from '../components/modals/imageEditor/imageEditor.types';

// ============================================================================
// TYPES
// ============================================================================

export type DrawingTool = 'brush' | 'eraser';

interface UseImageEditorDrawingProps {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    imageRef: React.RefObject<HTMLImageElement>;
    saveState: () => void;
}

interface UseImageEditorDrawingReturn {
    // State
    isDrawingMode: boolean;
    setIsDrawingMode: React.Dispatch<React.SetStateAction<boolean>>;
    drawingTool: DrawingTool;
    setDrawingTool: React.Dispatch<React.SetStateAction<DrawingTool>>;
    brushWidth: number;
    setBrushWidth: React.Dispatch<React.SetStateAction<number>>;
    eraserWidth: number;
    setEraserWidth: React.Dispatch<React.SetStateAction<number>>;
    brushColor: string;
    setBrushColor: React.Dispatch<React.SetStateAction<string>>;
    showToolSettings: boolean;
    setShowToolSettings: React.Dispatch<React.SetStateAction<boolean>>;
    presetColors: string[];
    // Handlers
    startDrawing: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    draw: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    stopDrawing: () => void;
    getCanvasCoordinates: (e: React.MouseEvent<HTMLCanvasElement>) => { x: number; y: number };
}

// ============================================================================
// HOOK
// ============================================================================

export const useImageEditorDrawing = ({
    canvasRef,
    imageRef,
    saveState
}: UseImageEditorDrawingProps): UseImageEditorDrawingReturn => {
    // --- State ---
    const [isDrawingMode, setIsDrawingMode] = useState(false);
    const [drawingTool, setDrawingTool] = useState<DrawingTool>('brush');
    const [brushWidth, setBrushWidth] = useState(4);
    const [eraserWidth, setEraserWidth] = useState(10);
    const [brushColor, setBrushColor] = useState('#ff0000');
    const [showToolSettings, setShowToolSettings] = useState(false);

    // --- Refs ---
    const isDrawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);

    // Initialize canvas size when drawing mode is enabled
    // IMPORTANT: Setting canvas.width or canvas.height clears the canvas content,
    // so we only resize if dimensions actually changed, and we preserve content
    useEffect(() => {
        if (isDrawingMode && imageRef.current && canvasRef.current) {
            const img = imageRef.current;
            const canvas = canvasRef.current;
            const targetWidth = img.clientWidth;
            const targetHeight = img.clientHeight;

            // Only resize if dimensions are different (to avoid clearing canvas)
            if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
                // Save current canvas content before resizing
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = canvas.width;
                tempCanvas.height = canvas.height;
                const tempCtx = tempCanvas.getContext('2d');
                if (tempCtx && canvas.width > 0 && canvas.height > 0) {
                    tempCtx.drawImage(canvas, 0, 0);
                }

                // Resize canvas
                canvas.width = targetWidth;
                canvas.height = targetHeight;

                // Restore content (scaled to new size if needed)
                const ctx = canvas.getContext('2d');
                if (ctx && tempCanvas.width > 0 && tempCanvas.height > 0) {
                    ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
                }
            }
        }
    }, [isDrawingMode, imageRef, canvasRef]);

    // --- Coordinate Helpers ---

    const getCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }, [canvasRef]);

    // --- Drawing Handlers ---

    const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawingMode) return;
        saveState(); // Save state before drawing action
        isDrawingRef.current = true;
        const coords = getCanvasCoordinates(e);
        lastPointRef.current = coords;

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        const currentWidth = drawingTool === 'eraser' ? eraserWidth : brushWidth;

        ctx.beginPath();
        ctx.arc(coords.x, coords.y, currentWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = drawingTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor;
        if (drawingTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
        }
        ctx.fill();
    }, [isDrawingMode, saveState, getCanvasCoordinates, canvasRef, drawingTool, eraserWidth, brushWidth, brushColor]);

    const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawingMode || !isDrawingRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx || !lastPointRef.current) return;

        const coords = getCanvasCoordinates(e);
        const currentWidth = drawingTool === 'eraser' ? eraserWidth : brushWidth;

        ctx.beginPath();
        ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        ctx.lineTo(coords.x, coords.y);
        ctx.strokeStyle = drawingTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor;
        ctx.lineWidth = currentWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (drawingTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
        }

        ctx.stroke();
        lastPointRef.current = coords;
    }, [isDrawingMode, canvasRef, getCanvasCoordinates, drawingTool, eraserWidth, brushWidth, brushColor]);

    const stopDrawing = useCallback(() => {
        isDrawingRef.current = false;
        lastPointRef.current = null;
    }, []);

    return {
        isDrawingMode,
        setIsDrawingMode,
        drawingTool,
        setDrawingTool,
        brushWidth,
        setBrushWidth,
        eraserWidth,
        setEraserWidth,
        brushColor,
        setBrushColor,
        showToolSettings,
        setShowToolSettings,
        presetColors: PRESET_COLORS,
        startDrawing,
        draw,
        stopDrawing,
        getCanvasCoordinates
    };
};
