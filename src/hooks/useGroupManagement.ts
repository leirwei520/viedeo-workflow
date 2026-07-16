/**
 * useGroupManagement.ts
 * 
 * Custom hook for managing node groups.
 * Handles grouping/ungrouping nodes and group state management.
 */

import { useState } from 'react';
import { NodeGroup, NodeData } from '../types';
import { generateUUID } from '../utils/uuid';

export const useGroupManagement = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [groups, setGroups] = useState<NodeGroup[]>([]);

    // ============================================================================
    // GROUP OPERATIONS
    // ============================================================================

    /**
     * Creates a new group from selected node IDs
     * @param nodeIds - Array of node IDs to group
     * @param label - Label for the group (default: "New Group")
     * @param onUpdateNodes - Callback to update nodes with groupId
     * @returns The created group ID
     */
    const groupNodes = (
        nodeIds: string[],
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        label: string = 'New Group' // caller should pass translated label; fallback handled in display
    ): string => {
        const groupId = generateUUID();

        const newGroup: NodeGroup = {
            id: groupId,
            nodeIds,
            label
        };

        setGroups(prev => [...prev, newGroup]);

        // Update nodes with groupId
        onUpdateNodes(prev => prev.map(node =>
            nodeIds.includes(node.id) ? { ...node, groupId } : node
        ));

        return groupId;
    };

    /**
     * Removes a group and clears groupId from its nodes
     * @param groupId - ID of the group to ungroup
     * @param onUpdateNodes - Callback to update nodes
     */
    const ungroupNodes = (
        groupId: string,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void
    ): void => {
        setGroups(prev => prev.filter(g => g.id !== groupId));

        onUpdateNodes(prev => {
            const memberIds = new Set(prev.filter(n => n.groupId === groupId).map(n => n.id));
            return prev.map(node => {
                let updated = node;
                if (node.groupId === groupId) {
                    updated = { ...updated, groupId: undefined };
                }
                // Remove cross-group connections involving this group's members
                if (node.parentIds && node.parentIds.length > 0) {
                    const isMember = memberIds.has(node.id);
                    const filtered = node.parentIds.filter(pid => {
                        const parentIsMember = memberIds.has(pid);
                        // Keep intra-group connections (both in this group)
                        if (isMember && parentIsMember) return true;
                        // Remove: member child ← external parent, or external child ← member parent
                        if (isMember && !parentIsMember) return false;
                        if (!isMember && parentIsMember) return false;
                        // Neither involved: keep
                        return true;
                    });
                    if (filtered.length !== node.parentIds.length) {
                        updated = { ...updated, parentIds: filtered };
                    }
                }
                return updated;
            });
        });
    };

    /**
     * Cleans up invalid groups (groups with less than 2 nodes)
     * and clears groupId from orphaned nodes
     * @param nodes - Current nodes array
     * @param onUpdateNodes - Callback to update nodes
     */
    const cleanupInvalidGroups = (
        nodes: NodeData[],
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void
    ): void => {
        // Find groups with less than 2 nodes
        const invalidGroupIds: string[] = [];

        groups.forEach(group => {
            const groupNodeCount = nodes.filter(n => n.groupId === group.id).length;
            if (groupNodeCount < 2) {
                invalidGroupIds.push(group.id);
            }
        });

        if (invalidGroupIds.length > 0) {
            // Remove invalid groups
            setGroups(prev => prev.filter(g => !invalidGroupIds.includes(g.id)));

            // Clear groupId from orphaned nodes
            onUpdateNodes(prev => prev.map(node =>
                invalidGroupIds.includes(node.groupId || '') ? { ...node, groupId: undefined } : node
            ));
        }
    };

    /**
     * Gets the group that contains the specified node
     * @param nodeId - ID of the node to find group for
     * @returns The group or undefined if not found
     */
    const getGroupByNodeId = (nodeId: string): NodeGroup | undefined => {
        return groups.find(group => group.nodeIds.includes(nodeId));
    };

    /**
     * Gets a group by its ID
     * @param groupId - ID of the group to find
     * @returns The group or undefined if not found
     */
    const getGroupById = (groupId: string): NodeGroup | undefined => {
        return groups.find(group => group.id === groupId);
    };

    /**
     * Checks if any of the selected nodes are grouped
     * @param nodeIds - Array of node IDs to check
     * @returns The group if all nodes belong to the same group, undefined otherwise
     */
    const getCommonGroup = (nodeIds: string[]): NodeGroup | undefined => {
        if (nodeIds.length === 0) return undefined;

        const firstNodeGroup = getGroupByNodeId(nodeIds[0]);
        if (!firstNodeGroup) return undefined;

        // Check if all nodes belong to the same group
        const allInSameGroup = nodeIds.every(id =>
            getGroupByNodeId(id)?.id === firstNodeGroup.id
        );

        return allInSameGroup ? firstNodeGroup : undefined;
    };

    /**
     * Sorts nodes in a group horizontally or vertically
     * @param groupId - ID of the group to sort
     * @param direction - 'horizontal' or 'vertical'
     * @param nodes - Current nodes array
     * @param onUpdateNodes - Callback to update nodes
     */
    const sortGroupNodes = (
        groupId: string,
        direction: 'horizontal' | 'vertical' | 'grid',
        nodes: NodeData[],
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void
    ): void => {
        // Get nodes in this group
        const groupNodesList = nodes.filter(n => n.groupId === groupId);
        if (groupNodesList.length < 2) return;

        // Sort nodes by their current title (Scene 1, Scene 2, etc.)
        const sortedNodes = [...groupNodesList].sort((a, b) => {
            const titleA = a.title || a.type;
            const titleB = b.title || b.type;
            // Extract numbers from titles for proper numeric sorting
            const numA = parseInt(titleA.match(/\d+/)?.[0] || '0');
            const numB = parseInt(titleB.match(/\d+/)?.[0] || '0');
            return numA - numB;
        });

        // Calculate the starting position (use the leftmost/topmost position)
        const minX = Math.min(...sortedNodes.map(n => n.x));
        const minY = Math.min(...sortedNodes.map(n => n.y));

        // Define spacing
        const horizontalGap = 500; // horizontal spacing between nodes (wider to prevent + overlap)
        const verticalGap = 350; // vertical spacing between nodes
        const gridColumns = 3; // number of columns for grid layout

        // Create position updates
        const updates: { id: string; x: number; y: number }[] = [];

        sortedNodes.forEach((node, index) => {
            if (direction === 'horizontal') {
                updates.push({
                    id: node.id,
                    x: minX + index * horizontalGap,
                    y: minY
                });
            } else if (direction === 'vertical') {
                updates.push({
                    id: node.id,
                    x: minX,
                    y: minY + index * verticalGap
                });
            } else if (direction === 'grid') {
                const col = index % gridColumns;
                const row = Math.floor(index / gridColumns);
                updates.push({
                    id: node.id,
                    x: minX + col * horizontalGap,
                    y: minY + row * verticalGap
                });
            }
        });

        // Apply position updates
        onUpdateNodes(prev => prev.map(node => {
            const update = updates.find(u => u.id === node.id);
            if (update) {
                return { ...node, x: update.x, y: update.y };
            }
            return node;
        }));
    };

    /**
     * Renames a group
     * @param groupId - ID of the group to rename
     * @param newLabel - New label for the group
     */
    const renameGroup = (groupId: string, newLabel: string): void => {
        setGroups(prev => prev.map(g =>
            g.id === groupId ? { ...g, label: newLabel } : g
        ));
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        groups,
        setGroups, // Expose for workflow loading
        groupNodes,
        ungroupNodes,
        cleanupInvalidGroups,
        getGroupByNodeId,
        getGroupById,
        getCommonGroup,
        sortGroupNodes,
        renameGroup
    };
};
