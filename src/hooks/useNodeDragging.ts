/**
 * useNodeDragging.ts
 * 
 * Custom hook for managing node dragging functionality.
 * Handles pointer events for dragging nodes around the canvas.
 * Includes snap-to-alignment guides when dragging near other nodes.
 */

import React, { useRef, useState, useCallback } from 'react';
import { NodeData, Viewport } from '../types';

interface DragNode {
    id: string;
}

export interface AlignGuide {
    type: 'horizontal' | 'vertical';
    pos: number; // canvas coordinate of the guide line
}

const NODE_W = 365;
const NODE_H = 400;
const SNAP_THRESHOLD = 6; // px in canvas coords

function getNodeEdges(n: NodeData) {
    return {
        left: n.x,
        right: n.x + NODE_W,
        centerX: n.x + NODE_W / 2,
        top: n.y,
        bottom: n.y + NODE_H,
        centerY: n.y + NODE_H / 2,
    };
}

export const useNodeDragging = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const dragNodeRef = useRef<DragNode | null>(null);
    const isPanning = useRef<boolean>(false);
    const panMoved = useRef<boolean>(false);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [isPanningState, setIsPanningState] = useState<boolean>(false);
    const [alignGuides, setAlignGuides] = useState<AlignGuide[]>([]);

    // RAF throttle accumulators
    const dragRafId = useRef<number>(0);
    const dragAccum = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
    const panRafId = useRef<number>(0);
    const panAccum = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    const handleNodePointerDown = (
        e: React.PointerEvent,
        id: string,
        onSelect?: (id: string) => void
    ) => {
        e.stopPropagation();
        dragNodeRef.current = { id };
        setIsDragging(true);

        if (onSelect) {
            onSelect(id);
        }

        if (e.target instanceof HTMLElement) {
            e.target.setPointerCapture(e.pointerId);
        }
    };

    const applyNodeDrag = (
        accDx: number,
        accDy: number,
        viewport: Viewport,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        selectedNodeIds: string[],
        allNodes: NodeData[],
        nodeId: string
    ) => {
        const dx = accDx / viewport.zoom;
        const dy = accDy / viewport.zoom;

        const nodesToMove = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1
            ? selectedNodeIds
            : [nodeId];

        const movingNodes = allNodes.filter(n => nodesToMove.includes(n.id));
        const staticNodes = allNodes.filter(n => !nodesToMove.includes(n.id));

        if (movingNodes.length === 0 || staticNodes.length === 0) {
            onUpdateNodes(prev => prev.map(n => {
                if (nodesToMove.includes(n.id)) {
                    return { ...n, x: n.x + dx, y: n.y + dy };
                }
                return n;
            }));
            setAlignGuides([]);
            return;
        }

        let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
        for (const n of movingNodes) {
            const nx = n.x + dx;
            const ny = n.y + dy;
            if (nx < bMinX) bMinX = nx;
            if (ny < bMinY) bMinY = ny;
            if (nx + NODE_W > bMaxX) bMaxX = nx + NODE_W;
            if (ny + NODE_H > bMaxY) bMaxY = ny + NODE_H;
        }
        const bCenterX = (bMinX + bMaxX) / 2;
        const bCenterY = (bMinY + bMaxY) / 2;

        const staticXEdges: number[] = [];
        const staticYEdges: number[] = [];
        for (const s of staticNodes) {
            const se = getNodeEdges(s);
            staticXEdges.push(se.left, se.right, se.centerX);
            staticYEdges.push(se.top, se.bottom, se.centerY);
        }

        const movingXEdges = [bMinX, bMaxX, bCenterX];
        const movingYEdges = [bMinY, bMaxY, bCenterY];

        let bestSnapX: number | null = null;
        let bestDistX = SNAP_THRESHOLD + 1;
        let snapGuideX: number | null = null;
        for (const mx of movingXEdges) {
            for (const sx of staticXEdges) {
                const dist = Math.abs(mx - sx);
                if (dist < bestDistX) {
                    bestDistX = dist;
                    bestSnapX = sx - mx;
                    snapGuideX = sx;
                }
            }
        }

        let bestSnapY: number | null = null;
        let bestDistY = SNAP_THRESHOLD + 1;
        let snapGuideY: number | null = null;
        for (const my of movingYEdges) {
            for (const sy of staticYEdges) {
                const dist = Math.abs(my - sy);
                if (dist < bestDistY) {
                    bestDistY = dist;
                    bestSnapY = sy - my;
                    snapGuideY = sy;
                }
            }
        }

        const snapDx = bestSnapX !== null && bestDistX <= SNAP_THRESHOLD ? bestSnapX : 0;
        const snapDy = bestSnapY !== null && bestDistY <= SNAP_THRESHOLD ? bestSnapY : 0;

        const finalDx = dx + snapDx;
        const finalDy = dy + snapDy;

        const guides: AlignGuide[] = [];
        if (snapDx !== 0 && snapGuideX !== null) {
            guides.push({ type: 'vertical', pos: snapGuideX });
        }
        if (snapDy !== 0 && snapGuideY !== null) {
            guides.push({ type: 'horizontal', pos: snapGuideY });
        }
        setAlignGuides(guides);

        onUpdateNodes(prev => prev.map(n => {
            if (nodesToMove.includes(n.id)) {
                return { ...n, x: n.x + finalDx, y: n.y + finalDy };
            }
            return n;
        }));
    };

    const updateNodeDrag = (
        e: React.PointerEvent,
        viewport: Viewport,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        selectedNodeIds: string[] = [],
        allNodes: NodeData[] = []
    ): boolean => {
        if (!dragNodeRef.current) return false;

        const nodeId = dragNodeRef.current.id;
        dragAccum.current.dx += e.movementX;
        dragAccum.current.dy += e.movementY;

        if (!dragRafId.current) {
            dragRafId.current = requestAnimationFrame(() => {
                dragRafId.current = 0;
                const { dx, dy } = dragAccum.current;
                dragAccum.current.dx = 0;
                dragAccum.current.dy = 0;
                applyNodeDrag(dx, dy, viewport, onUpdateNodes, selectedNodeIds, allNodes, nodeId);
            });
        }

        return true;
    };

    const endNodeDrag = useCallback(() => {
        if (dragRafId.current) {
            cancelAnimationFrame(dragRafId.current);
            dragRafId.current = 0;
        }
        dragAccum.current.dx = 0;
        dragAccum.current.dy = 0;
        dragNodeRef.current = null;
        setIsDragging(false);
        setAlignGuides([]);
    }, []);

    /**
     * Start canvas panning. Accepts either a React.PointerEvent (from a direct
     * pointer-down handler) or a minimal `{ target, pointerId }` object so that
     * deferred activations (e.g. right-click long-press timers) can still
     * properly capture the pointer.
     */
    const startPanning = (
        e: React.PointerEvent | { target: EventTarget | null; pointerId: number }
    ) => {
        isPanning.current = true;
        panMoved.current = false;
        setIsPanningState(true);
        if (e.target instanceof HTMLElement) {
            try { e.target.setPointerCapture(e.pointerId); } catch { /* may already be captured / element gone */ }
        }
    };

    const updatePanning = (
        e: React.PointerEvent,
        onUpdateViewport: (updater: (prev: Viewport) => Viewport) => void
    ): boolean => {
        if (!isPanning.current) return false;

        if (Math.abs(e.movementX) > 1 || Math.abs(e.movementY) > 1) {
            panMoved.current = true;
        }

        panAccum.current.dx += e.movementX;
        panAccum.current.dy += e.movementY;

        if (!panRafId.current) {
            panRafId.current = requestAnimationFrame(() => {
                panRafId.current = 0;
                const { dx, dy } = panAccum.current;
                panAccum.current.dx = 0;
                panAccum.current.dy = 0;
                onUpdateViewport(prev => ({
                    ...prev,
                    x: prev.x + dx,
                    y: prev.y + dy
                }));
            });
        }

        return true;
    };

    const endPanning = () => {
        if (panRafId.current) {
            cancelAnimationFrame(panRafId.current);
            panRafId.current = 0;
        }
        panAccum.current.dx = 0;
        panAccum.current.dy = 0;
        isPanning.current = false;
        setIsPanningState(false);
    };

    const releasePointerCapture = (e: React.PointerEvent) => {
        if (e.target instanceof HTMLElement && e.target.hasPointerCapture(e.pointerId)) {
            try {
                e.target.releasePointerCapture(e.pointerId);
            } catch (err) {
                // Ignore errors
            }
        }
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleNodePointerDown,
        updateNodeDrag,
        endNodeDrag,
        startPanning,
        updatePanning,
        endPanning,
        isDragging,
        isPanning: isPanningState,
        wasPanning: panMoved,
        releasePointerCapture,
        alignGuides
    };
};
