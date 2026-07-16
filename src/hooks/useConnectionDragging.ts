/**
 * useConnectionDragging.ts
 * 
 * Custom hook for managing connection dragging between nodes.
 * Handles drag-to-connect functionality with visual feedback.
 */

import React, { useState, useRef, useCallback } from 'react';
import { NodeData, NodeType, Viewport } from '../types';
import { isValidConnectionByType } from '../utils/connectionRules';

interface ConnectionStart {
    nodeId: string;
    handle: 'left' | 'right';
}

export const useConnectionDragging = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [isDraggingConnection, setIsDraggingConnection] = useState(false);
    const [connectionStart, setConnectionStart] = useState<ConnectionStart | null>(null);
    const [tempConnectionEnd, setTempConnectionEnd] = useState<{ x: number; y: number } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [selectedConnection, setSelectedConnection] = useState<{ parentId: string; childId: string } | null>(null);
    const [showDragLine, setShowDragLine] = useState(false);
    const [connectionSourceGroup, setConnectionSourceGroup] = useState<string[] | null>(null);
    const [groupBBoxOrigin, setGroupBBoxOrigin] = useState<{ x: number; y: number } | null>(null);
    const [pendingMenuLine, setPendingMenuLine] = useState<{
        nodeId: string;
        handle: 'left' | 'right';
        endPoint: { x: number; y: number };
    } | null>(null);
    const [pendingGroupMenuLine, setPendingGroupMenuLine] = useState<{
        origin: { x: number; y: number };
        handle: 'left' | 'right';
        endPoint: { x: number; y: number };
    } | null>(null);
    const dragLineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Checks if mouse is hovering over a node (for connection target)
     * Also determines which side (left or right connector) is being hovered
     * @param mouseX - Screen X coordinate
     * @param mouseY - Screen Y coordinate
     * @param nodes - Array of all nodes
     * @param viewport - Current viewport
     */
    const checkHoveredNode = (
        mouseX: number,
        mouseY: number,
        nodes: NodeData[],
        viewport: Viewport
    ) => {
        const canvasX = (mouseX - viewport.x) / viewport.zoom;
        const canvasY = (mouseY - viewport.y) / viewport.zoom;

        const NODE_W = 340;
        const NODE_H = 400;
        const SNAP_PADDING = 60;
        const GROUP_SNAP_PADDING = 120;

        const skipIds = new Set<string>();
        if (connectionSourceGroup) {
            connectionSourceGroup.forEach(id => skipIds.add(id));
        } else if (connectionStart?.nodeId) {
            skipIds.add(connectionStart.nodeId);
        }

        let found = nodes.find(n => {
            if (skipIds.has(n.id)) return false;
            return (
                canvasX >= n.x && canvasX <= n.x + NODE_W &&
                canvasY >= n.y && canvasY <= n.y + NODE_H
            );
        });

        if (!found) {
            let minDist = Infinity;
            for (const n of nodes) {
                if (skipIds.has(n.id)) continue;
                const inPadded = (
                    canvasX >= n.x - SNAP_PADDING && canvasX <= n.x + NODE_W + SNAP_PADDING &&
                    canvasY >= n.y - SNAP_PADDING && canvasY <= n.y + NODE_H + SNAP_PADDING
                );
                if (!inPadded) continue;
                const cx = n.x + NODE_W / 2;
                const cy = n.y + NODE_H / 2;
                const dist = Math.hypot(canvasX - cx, canvasY - cy);
                if (dist < minDist) {
                    minDist = dist;
                    found = n;
                }
            }
        }

        // For group drags: also detect nodes via their group's extended bbox
        // (the + buttons sit ~100px beyond node edges, so normal snap won't reach)
        if (!found && connectionSourceGroup) {
            const groupMap = new Map<string, NodeData[]>();
            for (const n of nodes) {
                if (skipIds.has(n.id) || !n.groupId) continue;
                const arr = groupMap.get(n.groupId) || [];
                arr.push(n);
                groupMap.set(n.groupId, arr);
            }
            for (const members of groupMap.values()) {
                if (members.length < 2) continue;
                let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
                for (const m of members) {
                    if (m.x < gMinX) gMinX = m.x;
                    if (m.y < gMinY) gMinY = m.y;
                    if (m.x + NODE_W > gMaxX) gMaxX = m.x + NODE_W;
                    if (m.y + NODE_H > gMaxY) gMaxY = m.y + NODE_H;
                }
                const inGroupBBox = (
                    canvasX >= gMinX - GROUP_SNAP_PADDING && canvasX <= gMaxX + GROUP_SNAP_PADDING &&
                    canvasY >= gMinY - GROUP_SNAP_PADDING && canvasY <= gMaxY + GROUP_SNAP_PADDING
                );
                if (!inGroupBBox) continue;
                let closestDist = Infinity;
                for (const m of members) {
                    const cx = m.x + NODE_W / 2;
                    const cy = m.y + NODE_H / 2;
                    const dist = Math.hypot(canvasX - cx, canvasY - cy);
                    if (dist < closestDist) {
                        closestDist = dist;
                        found = m;
                    }
                }
                if (found) break;
            }
        }

        if (found) {
            setHoveredNodeId(found.id);
        } else {
            setHoveredNodeId(null);
        }
    };

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    const resetDragState = useCallback(() => {
        setIsDraggingConnection(false);
        setShowDragLine(false);
        setConnectionStart(null);
        setTempConnectionEnd(null);
        setHoveredNodeId(null);
        setConnectionSourceGroup(null);
        setGroupBBoxOrigin(null);
        if (dragLineTimer.current) { clearTimeout(dragLineTimer.current); dragLineTimer.current = null; }
    }, []);

    const clearPendingLine = useCallback(() => {
        setPendingMenuLine(null);
        setPendingGroupMenuLine(null);
    }, []);

    /**
     * Starts connection dragging from a connector button
     */
    const handleConnectorPointerDown = (
        e: React.PointerEvent,
        nodeId: string,
        side: 'left' | 'right'
    ) => {
        e.stopPropagation();
        e.preventDefault();
        setIsDraggingConnection(true);
        setShowDragLine(false);
        setConnectionStart({ nodeId, handle: side });
        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
        if (dragLineTimer.current) clearTimeout(dragLineTimer.current);
        dragLineTimer.current = setTimeout(() => setShowDragLine(true), 200);

        // Global safety: guarantee cleanup even if pointerUp never reaches canvas
        const cleanup = () => {
            document.removeEventListener('pointerup', cleanup, true);
            document.removeEventListener('pointercancel', cleanup, true);
            // Small delay so the React pointerUp handler fires first if it can
            setTimeout(() => resetDragState(), 50);
        };
        document.addEventListener('pointerup', cleanup, true);
        document.addEventListener('pointercancel', cleanup, true);
    };

    /**
     * Starts connection dragging from a group bounding box connector button.
     * The bboxEdge is the canvas-space coordinate of the midpoint of the bbox edge the drag started from.
     */
    const handleGroupConnectorPointerDown = (
        e: React.PointerEvent,
        groupNodeIds: string[],
        side: 'left' | 'right',
        bboxEdge: { x: number; y: number }
    ) => {
        e.stopPropagation();
        e.preventDefault();
        setIsDraggingConnection(true);
        setShowDragLine(false);
        setConnectionSourceGroup(groupNodeIds);
        setGroupBBoxOrigin(bboxEdge);
        setConnectionStart({ nodeId: groupNodeIds[0], handle: side });
        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
        if (dragLineTimer.current) clearTimeout(dragLineTimer.current);
        dragLineTimer.current = setTimeout(() => setShowDragLine(true), 200);

        const cleanup = () => {
            document.removeEventListener('pointerup', cleanup, true);
            document.removeEventListener('pointercancel', cleanup, true);
            setTimeout(() => resetDragState(), 50);
        };
        document.addEventListener('pointerup', cleanup, true);
        document.addEventListener('pointercancel', cleanup, true);
    };

    /**
     * Updates temporary connection end point during drag
     */
    const updateConnectionDrag = (
        e: React.PointerEvent,
        nodes: NodeData[],
        viewport: Viewport
    ) => {
        if (!isDraggingConnection) return false;

        // Safety: if no buttons are pressed the user already released — reset stale drag
        if (e.buttons === 0) {
            resetDragState();
            return false;
        }

        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
        checkHoveredNode(e.clientX, e.clientY, nodes, viewport);
        return true;
    };

    /**
     * Completes connection drag and creates connection if valid
     * Returns true if connection was handled, false otherwise
     * @param nodes - All nodes for validation
     * @param onConnectionMade - Optional callback called with (parentId, childId) when connection is created
     */
    const completeConnectionDrag = (
        onAddNext: (nodeId: string, direction: 'left' | 'right', x?: number, y?: number) => void,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        nodes: NodeData[],
        onConnectionMade?: (parentId: string, childId: string) => void,
        onGroupAddNext?: (groupNodeIds: string[], direction: 'left' | 'right', x?: number, y?: number) => void,
        getGroupMemberIds?: (nodeId: string) => string[] | undefined
    ): boolean => {
        if (!isDraggingConnection || !connectionStart) return false;

        const isValidConnection = (parentId: string, childId: string): boolean => {
            const parentNode = nodes.find(n => n.id === parentId);
            const childNode = nodes.find(n => n.id === childId);
            if (!parentNode || !childNode) return false;
            return isValidConnectionByType(parentNode.type, childNode.type);
        };

        const sortByPosition = (ids: string[]): string[] => {
            return [...ids].sort((a, b) => {
                const na = nodes.find(n => n.id === a);
                const nb = nodes.find(n => n.id === b);
                if (!na || !nb) return 0;
                return na.x !== nb.x ? na.x - nb.x : na.y - nb.y;
            });
        };

        const isGroupDrag = connectionSourceGroup && connectionSourceGroup.length > 0;

        if (hoveredNodeId) {
            if (isGroupDrag) {
                const side = connectionStart.handle;
                const targetGroupIds = getGroupMemberIds?.(hoveredNodeId);

                if (targetGroupIds && targetGroupIds.length > 1) {
                    // Group → Group: 1:1 connections by position order
                    const sortedSource = sortByPosition(connectionSourceGroup!);
                    const sortedTarget = sortByPosition(targetGroupIds);
                    const pairCount = Math.min(sortedSource.length, sortedTarget.length);

                    const madeConnections1: [string, string][] = [];
                    onUpdateNodes(prev => {
                        let updated = [...prev];
                        for (let i = 0; i < pairCount; i++) {
                            const parentId = side === 'right' ? sortedSource[i] : sortedTarget[i];
                            const childId = side === 'right' ? sortedTarget[i] : sortedSource[i];
                            if (!isValidConnection(parentId, childId)) continue;
                            updated = updated.map(n => {
                                if (n.id === childId) {
                                    const existingParents = n.parentIds || [];
                                    if (!existingParents.includes(parentId)) {
                                        return { ...n, parentIds: [...existingParents, parentId] };
                                    }
                                }
                                return n;
                            });
                            madeConnections1.push([parentId, childId]);
                        }
                        return updated;
                    });
                    madeConnections1.forEach(([p, c]) => onConnectionMade?.(p, c));
                } else {
                    // Group → single node: connect ALL group members to the target
                    const madeConnections2: [string, string][] = [];
                    onUpdateNodes(prev => {
                        let updated = [...prev];
                        for (const memberId of connectionSourceGroup!) {
                            const parentId = side === 'right' ? memberId : hoveredNodeId;
                            const childId = side === 'right' ? hoveredNodeId : memberId;
                            if (!isValidConnection(parentId, childId)) continue;
                            updated = updated.map(n => {
                                if (n.id === childId) {
                                    const existingParents = n.parentIds || [];
                                    if (!existingParents.includes(parentId)) {
                                        return { ...n, parentIds: [...existingParents, parentId] };
                                    }
                                }
                                return n;
                            });
                            madeConnections2.push([parentId, childId]);
                        }
                        return updated;
                    });
                    madeConnections2.forEach(([p, c]) => onConnectionMade?.(p, c));
                }
            } else {
                // Single node drag — original logic
                const parentId = connectionStart.handle === 'right' ? connectionStart.nodeId : hoveredNodeId;
                const childId = connectionStart.handle === 'right' ? hoveredNodeId : connectionStart.nodeId;

                if (!isValidConnection(parentId, childId)) {
                    resetDragState();
                    return true;
                }

                onUpdateNodes(prev => prev.map(n => {
                    if (n.id === childId) {
                        const existingParents = n.parentIds || [];
                        if (!existingParents.includes(parentId)) {
                            return { ...n, parentIds: [...existingParents, parentId] };
                        }
                    }
                    return n;
                }));
                onConnectionMade?.(parentId, childId);
            }
        } else {
            // Released without connecting to any node — open connector context menu
            const menuX = tempConnectionEnd?.x ?? 0;
            const menuY = tempConnectionEnd?.y ?? 0;

            if (isGroupDrag) {
                if (groupBBoxOrigin) {
                    setPendingGroupMenuLine({
                        origin: groupBBoxOrigin,
                        handle: connectionStart.handle,
                        endPoint: { x: menuX, y: menuY }
                    });
                }
                if (onGroupAddNext) {
                    onGroupAddNext(connectionSourceGroup!, connectionStart.handle, menuX, menuY);
                } else {
                    onAddNext(connectionStart.nodeId, connectionStart.handle, menuX, menuY);
                }
            } else {
                setPendingMenuLine({
                    nodeId: connectionStart.nodeId,
                    handle: connectionStart.handle,
                    endPoint: { x: menuX, y: menuY }
                });
                onAddNext(connectionStart.nodeId, connectionStart.handle, menuX, menuY);
            }
        }

        // Reset state
        setIsDraggingConnection(false);
        setShowDragLine(false);
        setConnectionStart(null);
        setTempConnectionEnd(null);
        setHoveredNodeId(null);
        setConnectionSourceGroup(null);
        setGroupBBoxOrigin(null);
        if (dragLineTimer.current) { clearTimeout(dragLineTimer.current); dragLineTimer.current = null; }
        return true;
    };

    /**
     * Handles clicking on a connection line to select it
     */
    const handleEdgeClick = (e: React.MouseEvent, parentId: string, childId: string) => {
        e.stopPropagation();
        setSelectedConnection({ parentId, childId });
    };

    /**
     * Deletes the currently selected connection.
     * If both parent and child belong to different groups, removes all connections between those groups.
     */
    const deleteSelectedConnection = (
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        nodes?: NodeData[]
    ) => {
        if (!selectedConnection) return false;

        const parent = nodes?.find(n => n.id === selectedConnection.parentId);
        const child = nodes?.find(n => n.id === selectedConnection.childId);
        const parentGroupId = parent?.groupId;
        const childGroupId = child?.groupId;
        const isCrossGroup = nodes && (parentGroupId || childGroupId)
            && parentGroupId !== childGroupId;

        if (isCrossGroup) {
            const parentMemberIds = parentGroupId
                ? new Set(nodes!.filter(n => n.groupId === parentGroupId).map(n => n.id))
                : new Set([selectedConnection.parentId]);
            const childMemberIds = childGroupId
                ? new Set(nodes!.filter(n => n.groupId === childGroupId).map(n => n.id))
                : new Set([selectedConnection.childId]);
            onUpdateNodes(prev => prev.map(n => {
                if (childMemberIds.has(n.id) && n.parentIds) {
                    const filtered = n.parentIds.filter(pid => !parentMemberIds.has(pid));
                    return { ...n, parentIds: filtered };
                }
                return n;
            }));
        } else {
            onUpdateNodes(prev => prev.map(n => {
                if (n.id === selectedConnection.childId) {
                    const existingParents = n.parentIds || [];
                    return { ...n, parentIds: existingParents.filter(pid => pid !== selectedConnection.parentId) };
                }
                return n;
            }));
        }
        setSelectedConnection(null);
        return true;
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        isDraggingConnection,
        showDragLine,
        connectionStart,
        tempConnectionEnd,
        hoveredNodeId,
        selectedConnection,
        pendingMenuLine,
        pendingGroupMenuLine,
        connectionSourceGroup,
        groupBBoxOrigin,
        setSelectedConnection,
        handleConnectorPointerDown,
        handleGroupConnectorPointerDown,
        updateConnectionDrag,
        completeConnectionDrag,
        handleEdgeClick,
        deleteSelectedConnection,
        clearPendingLine
    };
};
