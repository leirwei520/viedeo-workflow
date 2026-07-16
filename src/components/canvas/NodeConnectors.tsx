/**
 * NodeConnectors.tsx
 * 
 * Renders the left and right connector buttons for a node.
 * Handles pointer events for drag-to-connect functionality.
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { useTheme } from '../../hooks/useTheme';

interface NodeConnectorsProps {
    nodeId: string;
    onConnectorDown: (e: React.PointerEvent, id: string, side: 'left' | 'right') => void;
}

export const NodeConnectors: React.FC<NodeConnectorsProps> = ({
    nodeId,
    onConnectorDown,
}) => {
    const { isDark } = useTheme();

    const sharedOuter = "absolute opacity-0 group-hover/node:opacity-100 z-10 rounded-lg";

    const handleLeft = (e: React.PointerEvent) => {
        e.stopPropagation();
        onConnectorDown(e, nodeId, 'left');
    };
    const handleRight = (e: React.PointerEvent) => {
        e.stopPropagation();
        onConnectorDown(e, nodeId, 'right');
    };

    return (
        <>
            {/* Left Connector */}
            <HoverBorderGradient
                as="button"
                containerClassName={`-left-12 top-1/2 -translate-y-1/2 ${sharedOuter}`}
                className={`w-10 h-10 rounded-lg flex items-center justify-center cursor-crosshair transition-all hover:scale-110 ${isDark ? 'bg-[var(--sf-bg-card)]' : 'bg-white text-gray-600'}`}
                fillClassName={isDark ? undefined : 'bg-white'}
                duration={2}
                onPointerDown={handleLeft}
            >
                <Plus size={18} />
            </HoverBorderGradient>

            {/* Right Connector */}
            <HoverBorderGradient
                as="button"
                containerClassName={`-right-12 top-1/2 -translate-y-1/2 ${sharedOuter}`}
                className={`w-10 h-10 rounded-lg flex items-center justify-center cursor-crosshair transition-all hover:scale-110 ${isDark ? 'bg-[var(--sf-bg-card)]' : 'bg-white text-gray-600'}`}
                fillClassName={isDark ? undefined : 'bg-white'}
                duration={2}
                onPointerDown={handleRight}
            >
                <Plus size={18} />
            </HoverBorderGradient>
        </>
    );
};
