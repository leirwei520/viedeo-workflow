/**
 * useAutoSave.ts
 * 
 * Debounced auto-save: triggers a save a few seconds after the last change.
 * Also saves immediately when the user leaves the page or switches away.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { NodeData } from '../types';

interface UseAutoSaveOptions {
    isDirty: boolean;
    nodes: NodeData[];
    onSave: () => Promise<boolean | void>;
    /** Returns { url, body } for navigator.sendBeacon on page unload. If omitted, falls back to fire-and-forget onSave. */
    getBeaconPayload?: () => { url: string; body: string } | null;
    /** Debounce delay in ms after the last change (default 5 000) */
    delay?: number;
    /** Fallback periodic interval in ms (default 60 000) */
    interval?: number;
}

export const useAutoSave = ({
    isDirty,
    nodes,
    onSave,
    getBeaconPayload,
    delay = 5_000,
    interval = 60_000,
}: UseAutoSaveOptions) => {
    const lastSaveTimeRef = useRef<number>(Date.now());
    const [lastSaveTime, setLastSaveTime] = useState<number>(Date.now());
    const isSavingRef = useRef(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const isDirtyRef = useRef(isDirty);
    isDirtyRef.current = isDirty;
    const getBeaconRef = useRef(getBeaconPayload);
    getBeaconRef.current = getBeaconPayload;

    const doSave = useCallback(async () => {
        if (!isDirtyRef.current || isSavingRef.current) return;
        try {
            isSavingRef.current = true;
            console.log('[Auto-Save] Saving…');
            const result = await onSaveRef.current();
            if (result === false) {
                console.warn('[Auto-Save] Save returned false — not updating timestamp');
                return;
            }
            const now = Date.now();
            lastSaveTimeRef.current = now;
            setLastSaveTime(now);
        } catch (error) {
            console.error('[Auto-Save] Failed:', error);
        } finally {
            isSavingRef.current = false;
        }
    }, []);

    // Debounced save: restart timer on every change
    useEffect(() => {
        if (!isDirty || nodes.length === 0) return;

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(doSave, delay);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [isDirty, nodes, delay, doSave]);

    // Fallback periodic save (in case debounce keeps resetting)
    useEffect(() => {
        const timer = setInterval(() => {
            if (isDirtyRef.current) doSave();
        }, interval);
        return () => clearInterval(timer);
    }, [interval, doSave]);

    // Save on page leave / tab switch using sendBeacon for reliability
    useEffect(() => {
        const handleBeforeUnload = () => {
            if (!isDirtyRef.current || isSavingRef.current) return;
            const beacon = getBeaconRef.current?.();
            if (beacon) {
                const blob = new Blob([beacon.body], { type: 'application/json' });
                navigator.sendBeacon(beacon.url, blob);
                return;
            }
            try { onSaveRef.current(); } catch { /* best-effort */ }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                handleBeforeUnload();
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    return {
        lastSaveTime,
    };
};
