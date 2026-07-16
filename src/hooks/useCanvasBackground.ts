import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';

export type CanvasBgPattern = 'none' | 'grid' | 'dots' | 'dashed' | 'cross';

interface CanvasBackgroundContextValue {
  pattern: CanvasBgPattern;
  setPattern: (p: CanvasBgPattern) => void;
  bgOpacity: number;
  setBgOpacity: (o: number) => void;
  bgSize: number;
  setBgSize: (s: number) => void;
}

const STORAGE_KEY = 'chuhaibang_canvas_bg';

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    return obj[key] ?? fallback;
  } catch { return fallback; }
}

function saveSetting(key: string, value: unknown) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

const CanvasBackgroundContext = createContext<CanvasBackgroundContextValue | null>(null);

export function useCanvasBackgroundState(): CanvasBackgroundContextValue {
  const [pattern, setPatternRaw] = useState<CanvasBgPattern>(() => loadSetting('pattern', 'none'));
  const [bgOpacity, setBgOpacityRaw] = useState<number>(() => loadSetting('opacity', 0.15));
  const [bgSize, setBgSizeRaw] = useState<number>(() => loadSetting('size', 24));

  const setPattern = useCallback((p: CanvasBgPattern) => {
    saveSetting('pattern', p);
    setPatternRaw(p);
  }, []);

  const setBgOpacity = useCallback((o: number) => {
    saveSetting('opacity', o);
    setBgOpacityRaw(o);
  }, []);

  const setBgSize = useCallback((s: number) => {
    saveSetting('size', s);
    setBgSizeRaw(s);
  }, []);

  return useMemo(() => ({
    pattern, setPattern,
    bgOpacity, setBgOpacity,
    bgSize, setBgSize,
  }), [pattern, setPattern, bgOpacity, setBgOpacity, bgSize, setBgSize]);
}

export const CanvasBackgroundProvider = CanvasBackgroundContext.Provider;

export function useCanvasBackground(): CanvasBackgroundContextValue {
  const ctx = useContext(CanvasBackgroundContext);
  if (!ctx) throw new Error('useCanvasBackground must be used within CanvasBackgroundProvider');
  return ctx;
}
