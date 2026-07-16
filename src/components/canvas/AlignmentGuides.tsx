import React from 'react';
import { AlignGuide } from '../../hooks/useNodeDragging';
import { useTheme } from '../../hooks/useTheme';

interface AlignmentGuidesProps {
  guides: AlignGuide[];
}

export const AlignmentGuides: React.FC<AlignmentGuidesProps> = ({ guides }) => {
  const { isDark } = useTheme();
  if (guides.length === 0) return null;

  const color = isDark ? '#c084fc' : '#c084fc';

  return (
    <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-[5]">
      {guides.map((g, i) =>
        g.type === 'vertical' ? (
          <line
            key={`v-${i}`}
            x1={g.pos}
            y1={-100000}
            x2={g.pos}
            y2={100000}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.7}
          />
        ) : (
          <line
            key={`h-${i}`}
            x1={-100000}
            y1={g.pos}
            x2={100000}
            y2={g.pos}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.7}
          />
        )
      )}
    </svg>
  );
};
