/**
 * connectionHelpers.ts
 * 
 * Utility functions for calculating and rendering node connections.
 * Handles bezier curve path generation for connection lines.
 */

/**
 * Calculates a bezier curve path for a connection between two points
 * 
 * @param startX - Starting X coordinate
 * @param startY - Starting Y coordinate
 * @param endX - Ending X coordinate
 * @param endY - Ending Y coordinate
 * @param direction - Direction of the connection ('right' or 'left')
 * @returns SVG path string for the bezier curve
 * 
 * @example
 * const path = calculateConnectionPath(100, 200, 500, 200, 'right');
 * // Returns: "M 100 200 C 300 200, 300 200, 500 200"
 */
export const calculateConnectionPath = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    direction: 'left' | 'right' = 'right'
): string => {
    const dx = endX - startX;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(endY - startY);
    const cpDir = direction === 'right' ? 1 : -1;

    // Forward connection (target is in the expected direction)
    const isForward = (direction === 'right' && dx > 0) || (direction === 'left' && dx < 0);

    let cpOffset: number;
    if (isForward) {
        // Smooth horizontal S-curve; offset = half the horizontal gap, capped
        cpOffset = Math.min(absDx * 0.5, 200);
        // Add a little extra for vertical spread so the curve doesn't collapse
        cpOffset = Math.max(cpOffset, Math.min(absDy * 0.25, 80), 30);
    } else {
        // Backward connection — loop out so the line arcs around
        cpOffset = Math.max(absDy * 0.5, 80) + absDx * 0.3;
        cpOffset = Math.min(cpOffset, 250);
    }

    const cp1x = startX + cpOffset * cpDir;
    const cp2x = endX - cpOffset * cpDir;

    return `M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${endY}, ${endX} ${endY}`;
};

/**
 * Gets the connection point coordinates for a node
 * 
 * @param nodeX - Node X position
 * @param nodeY - Node Y position
 * @param side - Which side of the node ('left' or 'right')
 * @param nodeWidth - Width of the node (default: 340)
 * @param nodeHeight - Height of the node (default: 400)
 * @returns Object with x and y coordinates
 */
export const getNodeConnectionPoint = (
    nodeX: number,
    nodeY: number,
    side: 'left' | 'right',
    nodeWidth: number = 340,
    nodeHeight: number = 400
): { x: number; y: number } => {
    const midY = nodeY + nodeHeight / 2;

    return {
        x: side === 'right' ? nodeX + nodeWidth : nodeX,
        y: midY
    };
};
