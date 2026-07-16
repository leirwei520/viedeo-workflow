import React, { useMemo } from 'react';
import { useCanvasBackground, CanvasBgPattern } from '../../hooks/useCanvasBackground';
import { useTheme } from '../../hooks/useTheme';

interface CanvasBackgroundProps {
  viewport: { x: number; y: number; zoom: number };
}

function buildPatternSvg(
  pattern: CanvasBgPattern,
  size: number,
  color: string,
  opacity: number
): string | null {
  if (pattern === 'none') return null;

  const s = size;
  const c = encodeURIComponent(color);
  const o = opacity;

  switch (pattern) {
    case 'grid':
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'%3E%3Cpath d='M ${s} 0 L 0 0 0 ${s}' fill='none' stroke='${c}' stroke-opacity='${o}' stroke-width='1'/%3E%3C/svg%3E")`;

    case 'dots':
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'%3E%3Ccircle cx='${s / 2}' cy='${s / 2}' r='1.2' fill='${c}' fill-opacity='${o}'/%3E%3C/svg%3E")`;

    case 'dashed': {
      const dashLen = Math.round(s * 0.25);
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'%3E%3Cpath d='M ${s} 0 L 0 0 0 ${s}' fill='none' stroke='${c}' stroke-opacity='${o}' stroke-width='1' stroke-dasharray='${dashLen} ${dashLen}'/%3E%3C/svg%3E")`;
    }

    case 'cross': {
      const half = s / 2;
      const arm = 3;
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'%3E%3Cline x1='${half - arm}' y1='${half}' x2='${half + arm}' y2='${half}' stroke='${c}' stroke-opacity='${o}' stroke-width='1'/%3E%3Cline x1='${half}' y1='${half - arm}' x2='${half}' y2='${half + arm}' stroke='${c}' stroke-opacity='${o}' stroke-width='1'/%3E%3C/svg%3E")`;
    }

    default:
      return null;
  }
}

export const CanvasBackground: React.FC<CanvasBackgroundProps> = React.memo(({ viewport }) => {
  const { pattern, bgOpacity, bgSize } = useCanvasBackground();
  const { isDark } = useTheme();

  const style = useMemo(() => {
    const color = isDark ? '#ffffff' : '#000000';
    const bgImage = buildPatternSvg(pattern, bgSize, color, bgOpacity);
    if (!bgImage) return null;

    const scaledSize = bgSize * viewport.zoom;

    return {
      position: 'absolute' as const,
      inset: 0,
      pointerEvents: 'none' as const,
      backgroundImage: bgImage,
      backgroundSize: `${scaledSize}px ${scaledSize}px`,
      backgroundPosition: `${viewport.x % scaledSize}px ${viewport.y % scaledSize}px`,
    };
  }, [pattern, bgSize, bgOpacity, isDark, viewport.x, viewport.y, viewport.zoom]);

  if (!style) return null;

  return <div style={style} />;
});
