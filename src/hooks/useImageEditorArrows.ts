/**
 * useImageEditorArrows.ts
 * 
 * Manages arrow drawing functionality for the image editor.
 * Handles arrow creation, preview, and rendering.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { EditorElement } from '../components/modals/imageEditor/imageEditor.types';

// ============================================================================
// TYPES
// ============================================================================

interface UseImageEditorArrowsProps {
    arrowCanvasRef: React.RefObject<HTMLCanvasElement>;
    imageRef: React.RefObject<HTMLImageElement>;
    saveState: () => void;
    setElements: React.Dispatch<React.SetStateAction<EditorElement[]>>;
}

interface UseImageEditorArrowsReturn {
    // State
    isArrowMode: boolean;
    setIsArrowMode: React.Dispatch<React.SetStateAction<boolean>>;
    arrowStart: { x: number; y: number } | null;
    arrowEnd: { x: number; y: number } | null;
    // Handlers
    startArrow: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    drawArrowPreview: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    finishArrow: () => void;
    getArrowCanvasCoordinates: (e: React.MouseEvent<HTMLCanvasElement>) => { x: number; y: number };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Draw an arrow on the given canvas context
 */
export const drawArrow = (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
) => {
    const headLength = 15;
    const headAngle = Math.PI / 6;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.strokeStyle = '#ff0000';
    ctx.fillStyle = '#ff0000';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over';

    // Draw the line
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Draw the arrowhead
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
        toX - headLength * Math.cos(angle - headAngle),
        toY - headLength * Math.sin(angle - headAngle)
    );
    ctx.lineTo(
        toX - headLength * Math.cos(angle + headAngle),
        toY - headLength * Math.sin(angle + headAngle)
    );
    ctx.closePath();
    ctx.fill();
};

/**
 * Draw an arrow with custom color and line width
 */
export const drawArrowWithStyle = (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string,
    lineWidth: number
) => {
    const headLength = 15;
    const headAngle = Math.PI / 6;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle - headAngle), toY - headLength * Math.sin(angle - headAngle));
    ctx.lineTo(toX - headLength * Math.cos(angle + headAngle), toY - headLength * Math.sin(angle + headAngle));
    ctx.closePath();
    ctx.fill();
};

// ============================================================================
// HOOK
// ============================================================================

export const useImageEditorArrows = ({
    arrowCanvasRef,
    imageRef,
    saveState,
    setElements
}: UseImageEditorArrowsProps): UseImageEditorArrowsReturn => {
    // --- State ---
    const [isArrowMode, setIsArrowMode] = useState(false);
    const [arrowStart, setArrowStart] = useState<{ x: number; y: number } | null>(null);
    const [arrowEnd, setArrowEnd] = useState<{ x: number; y: number } | null>(null);

    // --- Refs ---
    const isDrawingArrowRef = useRef(false);

    // --- Effects ---

    // Initialize arrow canvas when arrow mode is enabled
    useEffect(() => {
        if (isArrowMode && imageRef.current && arrowCanvasRef.current) {
            const img = imageRef.current;
            const arrowCanvas = arrowCanvasRef.current;
            arrowCanvas.width = img.clientWidth;
            arrowCanvas.height = img.clientHeight;
        }
    }, [isArrowMode, imageRef, arrowCanvasRef]);

    // Render arrow preview during drag
    useEffect(() => {
        if (!isArrowMode || !arrowStart || !arrowEnd || !arrowCanvasRef.current) return;

        const canvas = arrowCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear the preview canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw preview arrow
        const headLength = 15;
        const headAngle = Math.PI / 6;
        const angle = Math.atan2(arrowEnd.y - arrowStart.y, arrowEnd.x - arrowStart.x);

        ctx.strokeStyle = '#ff0000';
        ctx.fillStyle = '#ff0000';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw the line
        ctx.beginPath();
        ctx.moveTo(arrowStart.x, arrowStart.y);
        ctx.lineTo(arrowEnd.x, arrowEnd.y);
        ctx.stroke();

        // Draw the arrowhead
        ctx.beginPath();
        ctx.moveTo(arrowEnd.x, arrowEnd.y);
        ctx.lineTo(
            arrowEnd.x - headLength * Math.cos(angle - headAngle),
            arrowEnd.y - headLength * Math.sin(angle - headAngle)
        );
        ctx.lineTo(
            arrowEnd.x - headLength * Math.cos(angle + headAngle),
            arrowEnd.y - headLength * Math.sin(angle + headAngle)
        );
        ctx.closePath();
        ctx.fill();
    }, [isArrowMode, arrowStart, arrowEnd, arrowCanvasRef]);

    // --- Coordinate Helpers ---

    const getArrowCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = arrowCanvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }, [arrowCanvasRef]);

    // --- Arrow Handlers ---

    const startArrow = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isArrowMode) return;
        isDrawingArrowRef.current = true;
        const coords = getArrowCanvasCoordinates(e);
        setArrowStart(coords);
        setArrowEnd(coords);
    }, [isArrowMode, getArrowCanvasCoordinates]);

    const drawArrowPreview = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isArrowMode || !isDrawingArrowRef.current || !arrowStart) return;
        const coords = getArrowCanvasCoordinates(e);
        setArrowEnd(coords);
    }, [isArrowMode, arrowStart, getArrowCanvasCoordinates]);

    const finishArrow = useCallback(() => {
        if (!isArrowMode || !isDrawingArrowRef.current || !arrowStart || !arrowEnd) {
            isDrawingArrowRef.current = false;
            return;
        }

        // Save state BEFORE adding arrow (so undo removes the arrow)
        saveState();

        // Add arrow as an element
        const newElement: EditorElement = {
            id: `arrow-${Date.now()}`,
            type: 'arrow',
            startX: arrowStart.x,
            startY: arrowStart.y,
            endX: arrowEnd.x,
            endY: arrowEnd.y,
            color: '#ff0000',
            lineWidth: 3
        };
        setElements(prev => [...prev, newElement]);

        // Clear the preview canvas since arrow is now in elements
        const canvas = arrowCanvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        isDrawingArrowRef.current = false;
        setArrowStart(null);
        setArrowEnd(null);
    }, [isArrowMode, arrowStart, arrowEnd, saveState, setElements, arrowCanvasRef]);

    return {
        isArrowMode,
        setIsArrowMode,
        arrowStart,
        arrowEnd,
        startArrow,
        drawArrowPreview,
        finishArrow,
        getArrowCanvasCoordinates
    };
};
