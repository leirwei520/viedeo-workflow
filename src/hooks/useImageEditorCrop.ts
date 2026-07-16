/**
 * useImageEditorCrop.ts
 * 
 * Manages crop functionality for the image editor.
 * Handles crop selection, dragging, resizing, and applying the crop.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

interface UseImageEditorCropProps {
    imageRef: React.RefObject<HTMLImageElement>;
    saveState: () => void;
    onCropApply: (croppedImageDataUrl: string) => void;
}

interface UseImageEditorCropReturn {
    // State
    isCropMode: boolean;
    setIsCropMode: React.Dispatch<React.SetStateAction<boolean>>;
    cropRect: CropRect | null;
    setCropRect: React.Dispatch<React.SetStateAction<CropRect | null>>;
    isDragging: boolean;
    // Handlers
    handleCropMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
    applyCrop: () => void;
    cancelCrop: () => void;
    initializeCropRect: () => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const HANDLE_SIZE = 12; // Size of corner handles in pixels
const MIN_CROP_SIZE = 20; // Minimum crop area size

// ============================================================================
// HOOK
// ============================================================================

export const useImageEditorCrop = ({
    imageRef,
    saveState,
    onCropApply
}: UseImageEditorCropProps): UseImageEditorCropReturn => {
    // --- State ---
    const [isCropMode, setIsCropMode] = useState(false);
    const [cropRect, setCropRect] = useState<CropRect | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // --- Refs ---
    const dragHandleRef = useRef<DragHandle>(null);
    const dragStartRef = useRef<{ x: number; y: number; rect: CropRect } | null>(null);
    const cropRectRef = useRef<CropRect | null>(null);

    // Keep ref in sync with state for use in document event handlers
    useEffect(() => {
        cropRectRef.current = cropRect;
    }, [cropRect]);

    // --- Helpers ---

    /**
     * Get mouse coordinates relative to the image from any mouse event
     */
    const getImageCoordinatesFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
        const img = imageRef.current;
        if (!img) return { x: 0, y: 0 };
        const rect = img.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }, [imageRef]);

    /**
     * Determine which handle (if any) is at the given position
     */
    const getHandleAtPosition = useCallback((x: number, y: number, rect: CropRect): DragHandle => {
        const halfHandle = HANDLE_SIZE / 2;

        // Check corners
        if (Math.abs(x - rect.x) <= halfHandle && Math.abs(y - rect.y) <= halfHandle) {
            return 'nw';
        }
        if (Math.abs(x - (rect.x + rect.width)) <= halfHandle && Math.abs(y - rect.y) <= halfHandle) {
            return 'ne';
        }
        if (Math.abs(x - rect.x) <= halfHandle && Math.abs(y - (rect.y + rect.height)) <= halfHandle) {
            return 'sw';
        }
        if (Math.abs(x - (rect.x + rect.width)) <= halfHandle && Math.abs(y - (rect.y + rect.height)) <= halfHandle) {
            return 'se';
        }

        // Check if inside the rect (for move)
        if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
            return 'move';
        }

        return null;
    }, []);

    /**
     * Initialize crop rectangle to cover most of the image
     */
    const initializeCropRect = useCallback(() => {
        const img = imageRef.current;
        if (!img) return;

        const margin = 40; // pixels margin from edges
        const width = img.clientWidth;
        const height = img.clientHeight;

        setCropRect({
            x: margin,
            y: margin,
            width: Math.max(width - margin * 2, MIN_CROP_SIZE),
            height: Math.max(height - margin * 2, MIN_CROP_SIZE)
        });
    }, [imageRef]);

    // --- Document-Level Mouse Event Handlers ---
    // Using document-level listeners prevents losing the drag when mouse leaves the image area

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!dragStartRef.current || !cropRectRef.current) return;

            const img = imageRef.current;
            if (!img) return;

            const coords = getImageCoordinatesFromEvent(e);
            const dx = coords.x - dragStartRef.current.x;
            const dy = coords.y - dragStartRef.current.y;
            const startRect = dragStartRef.current.rect;

            let newRect = { ...cropRectRef.current };

            switch (dragHandleRef.current) {
                case 'move':
                    newRect.x = Math.max(0, Math.min(startRect.x + dx, img.clientWidth - startRect.width));
                    newRect.y = Math.max(0, Math.min(startRect.y + dy, img.clientHeight - startRect.height));
                    break;
                case 'nw':
                    newRect.x = Math.max(0, Math.min(startRect.x + dx, startRect.x + startRect.width - MIN_CROP_SIZE));
                    newRect.y = Math.max(0, Math.min(startRect.y + dy, startRect.y + startRect.height - MIN_CROP_SIZE));
                    newRect.width = startRect.width - (newRect.x - startRect.x);
                    newRect.height = startRect.height - (newRect.y - startRect.y);
                    break;
                case 'ne':
                    newRect.y = Math.max(0, Math.min(startRect.y + dy, startRect.y + startRect.height - MIN_CROP_SIZE));
                    newRect.width = Math.max(MIN_CROP_SIZE, Math.min(startRect.width + dx, img.clientWidth - startRect.x));
                    newRect.height = startRect.height - (newRect.y - startRect.y);
                    break;
                case 'sw':
                    newRect.x = Math.max(0, Math.min(startRect.x + dx, startRect.x + startRect.width - MIN_CROP_SIZE));
                    newRect.width = startRect.width - (newRect.x - startRect.x);
                    newRect.height = Math.max(MIN_CROP_SIZE, Math.min(startRect.height + dy, img.clientHeight - startRect.y));
                    break;
                case 'se':
                    newRect.width = Math.max(MIN_CROP_SIZE, Math.min(startRect.width + dx, img.clientWidth - startRect.x));
                    newRect.height = Math.max(MIN_CROP_SIZE, Math.min(startRect.height + dy, img.clientHeight - startRect.y));
                    break;
            }

            setCropRect(newRect);
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            dragHandleRef.current = null;
            dragStartRef.current = null;
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, imageRef, getImageCoordinatesFromEvent]);

    // --- Event Handlers ---

    const handleCropMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!isCropMode || !cropRect) return;

        const coords = getImageCoordinatesFromEvent(e);
        const handle = getHandleAtPosition(coords.x, coords.y, cropRect);

        if (handle) {
            setIsDragging(true);
            dragHandleRef.current = handle;
            dragStartRef.current = {
                x: coords.x,
                y: coords.y,
                rect: { ...cropRect }
            };
            e.preventDefault();
        }
    }, [isCropMode, cropRect, getImageCoordinatesFromEvent, getHandleAtPosition]);

    /**
     * Apply the crop and generate a new cropped image
     * Uses crossOrigin image loading with fallback for local server images
     */
    const applyCrop = useCallback(async () => {
        if (!cropRect || !imageRef.current) return;

        const img = imageRef.current;
        const imgSrc = img.src;

        // Calculate scale between displayed size and natural size
        const scaleX = img.naturalWidth / img.clientWidth;
        const scaleY = img.naturalHeight / img.clientHeight;

        // Set canvas size to the cropped area (in natural pixels)
        const cropWidth = Math.round(cropRect.width * scaleX);
        const cropHeight = Math.round(cropRect.height * scaleY);
        const sourceX = Math.round(cropRect.x * scaleX);
        const sourceY = Math.round(cropRect.y * scaleY);

        /**
         * Helper to draw the crop and export
         */
        const drawCropAndExport = (sourceImg: HTMLImageElement): string | null => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            canvas.width = cropWidth;
            canvas.height = cropHeight;

            // Draw the cropped portion
            ctx.drawImage(
                sourceImg,
                sourceX,      // source x
                sourceY,      // source y
                cropWidth,    // source width
                cropHeight,   // source height
                0,            // dest x
                0,            // dest y
                cropWidth,    // dest width
                cropHeight    // dest height
            );

            return canvas.toDataURL('image/png');
        };

        try {
            let croppedDataUrl: string | null = null;

            if (imgSrc.startsWith('data:')) {
                // Already a data URL, use the original image directly
                croppedDataUrl = drawCropAndExport(img);
            } else {
                // Try loading with crossOrigin anonymous first
                try {
                    const crossOriginImg = await new Promise<HTMLImageElement>((resolve, reject) => {
                        const newImg = new Image();
                        newImg.crossOrigin = 'anonymous';
                        newImg.onload = () => resolve(newImg);
                        newImg.onerror = reject;
                        // Add cache buster to avoid 304 issues
                        newImg.src = imgSrc + (imgSrc.includes('?') ? '&' : '?') + '_t=' + Date.now();
                    });
                    croppedDataUrl = drawCropAndExport(crossOriginImg);
                } catch {
                    // If crossOrigin fails, try direct drawing (may work for same-origin)
                    console.log('CrossOrigin loading failed, trying direct draw...');
                    try {
                        croppedDataUrl = drawCropAndExport(img);
                    } catch {
                        console.error('All crop methods failed');
                    }
                }
            }

            if (!croppedDataUrl) {
                throw new Error('Failed to generate cropped image');
            }

            // IMPORTANT: Save state BEFORE applying crop (captures pre-crop state for undo)
            saveState();

            // Pass cropped image to callback
            onCropApply(croppedDataUrl);

            // Reset crop state
            setIsCropMode(false);
            setCropRect(null);
        } catch (error) {
            console.error('Failed to crop image:', error);
        }
    }, [cropRect, imageRef, saveState, onCropApply]);

    /**
     * Cancel crop mode without applying changes
     */
    const cancelCrop = useCallback(() => {
        setIsCropMode(false);
        setCropRect(null);
        setIsDragging(false);
        dragHandleRef.current = null;
        dragStartRef.current = null;
    }, []);

    return {
        isCropMode,
        setIsCropMode,
        cropRect,
        setCropRect,
        isDragging,
        handleCropMouseDown,
        applyCrop,
        cancelCrop,
        initializeCropRect
    };
};
