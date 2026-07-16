/**
 * useHistory.ts
 * 
 * Custom hook for managing undo/redo history.
 * Uses useReducer for atomic state transitions.
 * Undo/redo directly applies state via onApply callback.
 * Push is debounced: only the final settled state after cascading
 * effects gets recorded as a single history entry.
 */

import { useReducer, useCallback, useRef, useEffect } from 'react';

interface HistoryState<T> {
    past: T[];
    present: T;
    future: T[];
}

type HistoryAction<T> =
    | { type: 'UNDO' }
    | { type: 'REDO' }
    | { type: 'PUSH'; newState: T; maxSize: number }
    | { type: 'RESET'; newState: T };

function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
    switch (action.type) {
        case 'UNDO': {
            if (state.past.length === 0) return state;
            const previous = state.past[state.past.length - 1];
            return {
                past: state.past.slice(0, -1),
                present: previous,
                future: [state.present, ...state.future]
            };
        }
        case 'REDO': {
            if (state.future.length === 0) return state;
            const next = state.future[0];
            return {
                past: [...state.past, state.present],
                present: next,
                future: state.future.slice(1)
            };
        }
        case 'PUSH': {
            if (action.newState === state.present) return state;
            if (typeof action.newState === 'object' && action.newState !== null &&
                typeof state.present === 'object' && state.present !== null) {
                const keys = Object.keys(action.newState) as (keyof T)[];
                if (keys.every(k => action.newState[k] === state.present[k])) return state;
            }
            return {
                past: [...state.past.slice(-action.maxSize + 1), state.present],
                present: action.newState,
                future: []
            };
        }
        case 'RESET': {
            return { past: [], present: action.newState, future: [] };
        }
        default:
            return state;
    }
}

interface UseHistoryOptions<T> {
    initialState: T;
    maxHistorySize?: number;
    onApply: (state: T) => void;
}

export const useHistory = <T>({ initialState, maxHistorySize = 50, onApply }: UseHistoryOptions<T>) => {
    const [state, dispatch] = useReducer(historyReducer<T>, {
        past: [],
        present: initialState,
        future: []
    });

    const onApplyRef = useRef(onApply);
    onApplyRef.current = onApply;

    const stateRef = useRef(state);
    stateRef.current = state;

    // Skip counter: how many pushHistory calls to skip after undo/redo.
    // Set to a high number, then cleared after a stable timeout.
    const skipPushRef = useRef(false);
    const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const undo = useCallback(() => {
        const current = stateRef.current;
        if (current.past.length === 0) return;

        // Block all pushes until we're sure the state has settled
        skipPushRef.current = true;
        if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
        skipTimerRef.current = setTimeout(() => { skipPushRef.current = false; }, 150);

        dispatch({ type: 'UNDO' });

        const previous = current.past[current.past.length - 1];
        onApplyRef.current(previous);
    }, []);

    const redo = useCallback(() => {
        const current = stateRef.current;
        if (current.future.length === 0) return;

        skipPushRef.current = true;
        if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
        skipTimerRef.current = setTimeout(() => { skipPushRef.current = false; }, 150);

        dispatch({ type: 'REDO' });

        const next = current.future[0];
        onApplyRef.current(next);
    }, []);

    // Debounced push: collects the latest state and pushes after settling
    const pendingPushRef = useRef<T | null>(null);
    const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const pushHistory = useCallback((newState: T) => {
        if (skipPushRef.current) return;

        // Store the latest state; reset the debounce timer
        pendingPushRef.current = newState;

        if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
        pushTimerRef.current = setTimeout(() => {
            pushTimerRef.current = null;
            if (pendingPushRef.current !== null && !skipPushRef.current) {
                dispatch({ type: 'PUSH', newState: pendingPushRef.current, maxSize: maxHistorySize });
                pendingPushRef.current = null;
            }
        }, 50);
    }, [maxHistorySize]);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
            if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
        };
    }, []);

    const reset = useCallback((newState: T) => {
        dispatch({ type: 'RESET', newState });
    }, []);

    return {
        undo,
        redo,
        pushHistory,
        reset,
        canUndo: state.past.length > 0,
        canRedo: state.future.length > 0
    };
};
