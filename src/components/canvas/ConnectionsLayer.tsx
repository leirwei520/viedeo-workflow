/**
 * ConnectionsLayer.tsx
 * 
 * Renders the SVG connections between nodes on the canvas.
 * Includes permanent connections and temporary drag connections.
 */

import React from 'react';
import { NodeData, NodeStatus, NodeType, Viewport } from '../../types';
import { calculateConnectionPath } from '../../utils/connectionHelpers';
import { useTheme } from '../../hooks/useTheme';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the width of a node based on its type and content
 * @param node - The node to calculate width for
 * @param parentNode - Optional parent node (used for Editor nodes to determine width when they have input content)
 */
const getNodeWidth = (node: NodeData, parentNode?: NodeData): number => {
    // Image Editor with input from parent: width depends on aspect ratio
    if (node.type === NodeType.IMAGE_EDITOR) {
        const hasInput = parentNode && parentNode.status === NodeStatus.SUCCESS && parentNode.resultUrl;
        if (hasInput && parentNode.resultAspectRatio) {
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait images: height=500px, width=500*aspectRatio
                // For landscape images: width is capped at 500px
                if (aspectRatio < 1) {
                    return 500 * aspectRatio;
                } else {
                    return 500;
                }
            }
        }
        // Empty: width 340px
        return 340;
    }

    // Video Editor with input: uses 16:9 aspect ratio with maxWidth 500px
    if (node.type === NodeType.VIDEO_EDITOR) {
        const hasInput = parentNode && parentNode.status === NodeStatus.SUCCESS && parentNode.resultUrl;
        if (hasInput) {
            // Video uses 16:9, and width is capped at 500px
            // height = width / (16/9), maxHeight = 500px
            // So width = min(500, height * 16/9) where height is capped at 500
            // Result: width = min(500, 500 * 16/9) = min(500, 888) = 500
            return 500;
        }
        // Empty: width 340px
        return 340;
    }

    // Video nodes are wider
    if (node.type === NodeType.VIDEO) return 385;
    // Camera Angle nodes have fixed width
    if (node.type === NodeType.CAMERA_ANGLE) return 340;
    // Image and other nodes
    return 365;
};

/**
 * Estimate the height of a node based on its type and aspect ratio.
 * The node card height is determined by the content's aspect ratio or min-height for empty states.
 * Note: The title label is positioned ABOVE the card (-top-8), not inside it.
 * @param node - The node to calculate height for
 * @param parentNode - Optional parent node (used for Editor nodes to determine if they have input content)
 */
const getNodeHeight = (node: NodeData, parentNode?: NodeData): number => {
    const baseWidth = getNodeWidth(node, parentNode);
    const hasContent = node.status === NodeStatus.SUCCESS && node.resultUrl;

    // Handle Image Editor nodes
    if (node.type === NodeType.IMAGE_EDITOR) {
        // Check if has input from parent
        const hasInput = parentNode && parentNode.status === NodeStatus.SUCCESS && parentNode.resultUrl;
        if (hasInput && parentNode.resultAspectRatio) {
            // Use parent's aspect ratio to calculate actual dimensions
            // Image Editor with content: width=auto maxWidth=500px, image has maxHeight=500px
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait images (aspectRatio < 1): height is capped at 500px
                // For landscape images (aspectRatio >= 1): width is capped at 500px
                if (aspectRatio < 1) {
                    // Portrait: height = 500px, width = 500 * aspectRatio
                    return 500;
                } else {
                    // Landscape: width = 500px, height = 500 / aspectRatio
                    return 500 / aspectRatio;
                }
            }
        }
        // Empty: minHeight 380px
        return 380;
    }

    // Handle Video Editor nodes
    if (node.type === NodeType.VIDEO_EDITOR) {
        // Check if has input from parent
        const hasInput = parentNode && parentNode.status === NodeStatus.SUCCESS && parentNode.resultUrl;
        if (hasInput) {
            // Video editor shows 16:9 when has content (line 301 in CanvasNode.tsx)
            return Math.min(baseWidth / (16 / 9), 500);
        }
        // Empty: minHeight 380px
        return 380;
    }

    // Handle Camera Angle nodes
    if (node.type === NodeType.CAMERA_ANGLE) {
        const hasContent = node.status === NodeStatus.SUCCESS && node.resultUrl;
        if (hasContent && node.resultAspectRatio) {
            // Use actual result dimensions when content exists
            const parts = node.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                return 340 / aspectRatio; // width is 340px
            }
        }
        // Loading/empty state: minHeight 340px (see CanvasNode.tsx Camera Angle section)
        return 340;
    }

    // Parse aspect ratio to calculate content height for Image/Video nodes
    let aspectRatio: number;

    if (hasContent && node.resultAspectRatio) {
        // Use actual result dimensions when content exists
        const parts = node.resultAspectRatio.split('/');
        if (parts.length === 2) {
            aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
        } else {
            aspectRatio = 16 / 9;
        }
    } else if (hasContent && node.aspectRatio && node.aspectRatio !== 'Auto') {
        // Use selected aspect ratio for content
        const parts = node.aspectRatio.split(':');
        if (parts.length === 2) {
            aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
        } else {
            aspectRatio = 16 / 9;
        }
    } else {
        // Empty/placeholder state: Both Image and Video use 4/3 (see NodeContent.tsx line 307)
        aspectRatio = 4 / 3;
    }

    // Calculate content height from aspect ratio
    return baseWidth / aspectRatio;
};

interface Connection {
    parentId: string;
    childId: string;
}

interface ConnectionsLayerProps {
    nodes: NodeData[];
    nodeMap: Map<string, NodeData>;
    viewport: Viewport;
    // Connection dragging state
    isDraggingConnection: boolean;
    showDragLine: boolean;
    connectionStart: { nodeId: string; handle: 'left' | 'right' } | null;
    tempConnectionEnd: { x: number; y: number } | null;
    // Selection
    selectedConnection: Connection | null;
    onEdgeClick: (e: React.MouseEvent, parentId: string, childId: string) => void;
    // Pending menu line (stays visible while context menu is open)
    pendingMenuLine?: {
        nodeId: string;
        handle: 'left' | 'right';
        endPoint: { x: number; y: number };
    } | null;
    // Group drag state
    connectionSourceGroup?: string[] | null;
    groupBBoxOrigin?: { x: number; y: number } | null;
    pendingGroupMenuLine?: {
        origin: { x: number; y: number };
        handle: 'left' | 'right';
        endPoint: { x: number; y: number };
    } | null;
}

export const ConnectionsLayer: React.FC<ConnectionsLayerProps> = React.memo(({
    nodes,
    nodeMap,
    viewport,
    isDraggingConnection,
    showDragLine,
    connectionStart,
    tempConnectionEnd,
    selectedConnection,
    onEdgeClick,
    pendingMenuLine,
    connectionSourceGroup,
    groupBBoxOrigin,
    pendingGroupMenuLine,
}) => {
    const { isDark } = useTheme();
    const connections: React.ReactNode[] = [];

    // Pre-compute group bounding boxes (right-edge for outgoing, left-edge for incoming)
    const groupBBoxCache = new Map<string, { rightX: number; rightY: number; leftX: number; leftY: number }>();
    const getGroupBBox = (groupId: string) => {
        if (groupBBoxCache.has(groupId)) return groupBBoxCache.get(groupId)!;
        const members = nodes.filter(n => n.groupId === groupId);
        if (members.length === 0) return null;
        let maxX = -Infinity, minX = Infinity, minY = Infinity, maxY = -Infinity;
        for (const m of members) {
            const right = m.x + getNodeWidth(m);
            const bottom = m.y + getNodeHeight(m);
            if (right > maxX) maxX = right;
            if (m.x < minX) minX = m.x;
            if (m.y < minY) minY = m.y;
            if (bottom > maxY) maxY = bottom;
        }
        const PADDING_X = 50;
        const bbox = {
            rightX: maxX + PADDING_X,
            rightY: (minY + maxY) / 2,
            leftX: minX - PADDING_X,
            leftY: (minY + maxY) / 2
        };
        groupBBoxCache.set(groupId, bbox);
        return bbox;
    };

    // Separate cross-group connections (deduplicate to one visual line) from normal ones
    interface CrossGroupBundle {
        representative: { parentId: string; childId: string };
        edges: { parentId: string; childId: string }[];
        startX: number; startY: number; endX: number; endY: number;
    }
    const crossGroupMap = new Map<string, CrossGroupBundle>();
    const normalEdges: { parentId: string; childId: string }[] = [];

    nodes.forEach(node => {
        if (!node.parentIds || node.parentIds.length === 0) return;
        node.parentIds.forEach(parentId => {
            const parent = nodeMap.get(parentId);
            if (!parent) return;
            const isCrossGroup = (parent.groupId || node.groupId) && parent.groupId !== node.groupId;
            if (isCrossGroup) {
                // Visual key: (sourceGroupOrNodeId, targetGroupOrNodeId)
                const srcKey = parent.groupId || parent.id;
                const tgtKey = node.groupId || node.id;
                const visualKey = `${srcKey}::${tgtKey}`;
                const existing = crossGroupMap.get(visualKey);
                if (existing) {
                    existing.edges.push({ parentId, childId: node.id });
                } else {
                    let startX: number, startY: number, endX: number, endY: number;
                    if (parent.groupId) {
                        const bbox = getGroupBBox(parent.groupId);
                        startX = bbox!.rightX; startY = bbox!.rightY;
                    } else {
                        startX = parent.x + getNodeWidth(parent);
                        startY = parent.y + getNodeHeight(parent) / 2;
                    }
                    if (node.groupId) {
                        const bbox = getGroupBBox(node.groupId);
                        endX = bbox!.leftX; endY = bbox!.leftY;
                    } else {
                        endX = node.x;
                        endY = node.y + getNodeHeight(node, parent) / 2;
                    }
                    crossGroupMap.set(visualKey, {
                        representative: { parentId, childId: node.id },
                        edges: [{ parentId, childId: node.id }],
                        startX, startY, endX, endY
                    });
                }
            } else {
                normalEdges.push({ parentId, childId: node.id });
            }
        });
    });

    const renderConnection = (
        key: string,
        pathD: string,
        _isLoading: boolean,
        _isSuccess: boolean,
        isSelected: boolean,
        clickParentId: string,
        clickChildId: string
    ) => {
        connections.push(
            <g
                key={key}
                onClick={(e) => onEdgeClick(e, clickParentId, clickChildId)}
                className="cursor-pointer group pointer-events-auto"
            >
                <path d={pathD} stroke="transparent" strokeWidth="20" fill="none" />
                <path
                    d={pathD}
                    stroke="url(#rainbowGrad)"
                    strokeWidth="2.5"
                    fill="none"
                    strokeDasharray="6 14"
                    opacity={isSelected ? 1 : 0.7}
                    className={`connection-flow ${!isSelected ? 'group-hover:opacity-100' : ''}`}
                />
                {[0, 1, 2, 3, 4].map(i => (
                    <circle key={i} r="3" fill="url(#rainbowGrad)" opacity={1 - i * 0.12}>
                        <animateMotion dur="14s" repeatCount="indefinite" path={pathD} begin={`${i * 2.8}s`} />
                    </circle>
                ))}
            </g>
        );
    };

    // Render cross-group bundles as single visual lines
    crossGroupMap.forEach((bundle, visualKey) => {
        const path = calculateConnectionPath(bundle.startX, bundle.startY, bundle.endX, bundle.endY, 'right');
        const hasLoading = bundle.edges.some(e => nodeMap.get(e.childId)?.status === NodeStatus.LOADING);
        const allSuccess = bundle.edges.every(e => nodeMap.get(e.childId)?.status === NodeStatus.SUCCESS);
        const isSelected = bundle.edges.some(e =>
            selectedConnection?.parentId === e.parentId && selectedConnection?.childId === e.childId
        );
        const rep = bundle.representative;
        renderConnection(`xg-${visualKey}`, path, hasLoading, allSuccess, isSelected, rep.parentId, rep.childId);
    });

    // Render normal (non-cross-group) connections
    normalEdges.forEach(({ parentId, childId }) => {
        const parent = nodeMap.get(parentId);
        const child = nodeMap.get(childId);
        if (!parent || !child) return;

        const startX = parent.x + getNodeWidth(parent);
        const startY = parent.y + getNodeHeight(parent) / 2;
        const endX = child.x;
        const endY = child.y + getNodeHeight(child, parent) / 2;

        const path = calculateConnectionPath(startX, startY, endX, endY, 'right');
        const isSelected = selectedConnection?.parentId === parentId && selectedConnection?.childId === childId;
        const isLoading = child.status === NodeStatus.LOADING;
        const isSuccess = child.status === NodeStatus.SUCCESS;
        renderConnection(`${parentId}-${childId}`, path, isLoading, isSuccess, isSelected, parentId, childId);
    });

    let tempLine = null;
    if (isDraggingConnection && showDragLine && connectionStart && tempConnectionEnd) {
        const isGroupDrag = connectionSourceGroup && connectionSourceGroup.length > 0 && groupBBoxOrigin;
        let startX: number;
        let startY: number;

        if (isGroupDrag) {
            startX = groupBBoxOrigin!.x;
            startY = groupBBoxOrigin!.y;
        } else {
            const startNode = nodeMap.get(connectionStart.nodeId);
            if (!startNode) {
                // fallback: skip
                startX = 0; startY = 0;
            } else {
                startX = connectionStart.handle === 'right' ? startNode.x + getNodeWidth(startNode) : startNode.x;
                startY = startNode.y + getNodeHeight(startNode) / 2;
            }
        }

        if (startX !== 0 || startY !== 0 || isGroupDrag) {
            const endX = (tempConnectionEnd.x - viewport.x) / viewport.zoom;
            const endY = (tempConnectionEnd.y - viewport.y) / viewport.zoom;

            const path = calculateConnectionPath(
                startX,
                startY,
                endX,
                endY,
                connectionStart.handle
            );

            tempLine = (
                <path
                    d={path}
                    stroke="url(#rainbowGrad)"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                    fill="none"
                    className="pointer-events-none opacity-50"
                />
            );
        }
    }

    let pendingLine = null;
    if (!tempLine && pendingMenuLine) {
        const startNode = nodeMap.get(pendingMenuLine.nodeId);
        if (startNode) {
            const startX = pendingMenuLine.handle === 'right' ? startNode.x + getNodeWidth(startNode) : startNode.x;
            const startY = startNode.y + getNodeHeight(startNode) / 2;
            const endX = (pendingMenuLine.endPoint.x - viewport.x) / viewport.zoom;
            const endY = (pendingMenuLine.endPoint.y - viewport.y) / viewport.zoom;

            const path = calculateConnectionPath(startX, startY, endX, endY, pendingMenuLine.handle);

            pendingLine = (
                <path
                    d={path}
                    stroke="url(#rainbowGrad)"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                    fill="none"
                    className="pointer-events-none opacity-50"
                />
            );
        }
    }

    let pendingGroupLine = null;
    if (!tempLine && !pendingLine && pendingGroupMenuLine) {
        const startX = pendingGroupMenuLine.origin.x;
        const startY = pendingGroupMenuLine.origin.y;
        const endX = (pendingGroupMenuLine.endPoint.x - viewport.x) / viewport.zoom;
        const endY = (pendingGroupMenuLine.endPoint.y - viewport.y) / viewport.zoom;
        const path = calculateConnectionPath(startX, startY, endX, endY, pendingGroupMenuLine.handle);
        pendingGroupLine = (
            <path
                d={path}
                stroke="url(#rainbowGrad)"
                strokeWidth="2"
                strokeDasharray="5,5"
                fill="none"
                className="pointer-events-none opacity-50"
            />
        );
    }

    return (
        <>
            <defs>
                <linearGradient id="rainbowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#fda4af" />
                    <stop offset="33%" stopColor="#e0b0ff" />
                    <stop offset="66%" stopColor="#60a5fa" />
                    <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
                <linearGradient id="pulseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#fda4af">
                        <animate attributeName="stop-color" values="#fda4af;#60a5fa;#fda4af" dur="1.5s" repeatCount="indefinite" />
                    </stop>
                    <stop offset="100%" stopColor="#60a5fa">
                        <animate attributeName="stop-color" values="#60a5fa;#34d399;#60a5fa" dur="1.5s" repeatCount="indefinite" />
                    </stop>
                </linearGradient>
            </defs>
            {connections}
            {tempLine}
            {pendingLine}
            {pendingGroupLine}
        </>
    );
}, (prev, next) => {
    if (prev.nodes !== next.nodes || prev.selectedConnection !== next.selectedConnection) return false;
    if (prev.isDraggingConnection !== next.isDraggingConnection
        || prev.showDragLine !== next.showDragLine
        || prev.connectionStart !== next.connectionStart
        || prev.tempConnectionEnd !== next.tempConnectionEnd
        || prev.pendingMenuLine !== next.pendingMenuLine
        || prev.pendingGroupMenuLine !== next.pendingGroupMenuLine
        || prev.connectionSourceGroup !== next.connectionSourceGroup
        || prev.groupBBoxOrigin !== next.groupBBoxOrigin) return false;
    return true;
});
