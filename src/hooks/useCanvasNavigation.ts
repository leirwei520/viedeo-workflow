/**
 * useCanvasNavigation.ts
 * 
 * Custom hook for managing canvas viewport, zoom, and pan functionality.
 * Handles mouse wheel zoom, slider zoom, and viewport transformations.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Viewport, NodeData, NodeType } from '../types';

export const useCanvasNavigation = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
    const canvasRef = useRef<HTMLDivElement>(null);
    const wheelRafId = useRef<number>(0);
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    const handleWheel = useCallback((e: React.WheelEvent, hoveredNode?: NodeData) => {
        if (e.ctrlKey || e.metaKey) {
            const absDelta = Math.abs(e.deltaY);
            const sensitivity = absDelta < 10 ? 0.01 : 0.001;
            const s = Math.exp(-e.deltaY * sensitivity);
            const vp = viewportRef.current;
            let targetZoom = vp.zoom * s;
            const newZoom = Math.min(Math.max(0.1, targetZoom), 3.0);

            const rect = canvasRef.current?.getBoundingClientRect();
            if (rect) {
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                let anchorX = mouseX;
                let anchorY = mouseY;

                if (hoveredNode) {
                    const isVideo = hoveredNode.type === NodeType.VIDEO;
                    const nodeWidth = isVideo ? 385 : 365;
                    const nodeHeight = 400;

                    const nodeCenterX = hoveredNode.x + nodeWidth / 2;
                    const nodeCenterY = hoveredNode.y + nodeHeight / 2;

                    anchorX = nodeCenterX * vp.zoom + vp.x;
                    anchorY = nodeCenterY * vp.zoom + vp.y;
                }

                let newX = anchorX - (anchorX - vp.x) * (newZoom / vp.zoom);
                let newY = anchorY - (anchorY - vp.y) * (newZoom / vp.zoom);

                if (hoveredNode && newZoom > vp.zoom) {
                    const windowCenterX = window.innerWidth / 2;
                    const windowCenterY = window.innerHeight / 2;
                    const strength = 0.1;
                    newX += (windowCenterX - anchorX) * strength;
                    newY += (windowCenterY - anchorY) * strength;
                }

                const next = { x: newX, y: newY, zoom: newZoom };
                viewportRef.current = next;
                if (wheelRafId.current) cancelAnimationFrame(wheelRafId.current);
                wheelRafId.current = requestAnimationFrame(() => {
                    wheelRafId.current = 0;
                    setViewport(viewportRef.current);
                });
            }
        } else {
            const vp = viewportRef.current;
            const next = { ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY };
            viewportRef.current = next;
            if (wheelRafId.current) cancelAnimationFrame(wheelRafId.current);
            wheelRafId.current = requestAnimationFrame(() => {
                wheelRafId.current = 0;
                setViewport(viewportRef.current);
            });
        }
    }, []);

    /**
     * Handles zoom slider changes
     * Zooms from center of viewport
     */
    const handleSliderZoom = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const newZoom = parseFloat(e.target.value);
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const vp = viewportRef.current;

        const newX = cx - (cx - vp.x) * (newZoom / vp.zoom);
        const newY = cy - (cy - vp.y) * (newZoom / vp.zoom);

        const next = { x: newX, y: newY, zoom: newZoom };
        viewportRef.current = next;
        setViewport(next);
    }, []);

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        viewport,
        setViewport,
        canvasRef,
        handleWheel,
        handleSliderZoom
    };
};
