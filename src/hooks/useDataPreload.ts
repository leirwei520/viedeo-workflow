/**
 * Preloads panel data (library, history first page, workflows) after login.
 *
 * Data is stored in the centralized DataCache (memory + sessionStorage)
 * so that panels open instantly from cache without showing a loading spinner.
 */

import { useEffect, useRef } from 'react';
import { API_URL, authFetch } from '../config/api';
import { dataCache, CACHE_KEYS } from '../services/dataCache';

const HISTORY_PRELOAD_LIMIT = 18;

async function preloadLibrary(): Promise<void> {
    try {
        const res = await authFetch(`${API_URL}/library`);
        if (res.ok) dataCache.set(CACHE_KEYS.LIBRARY, await res.json());
    } catch { /* ignore */ }
}

async function preloadHistoryCounts(): Promise<void> {
    try {
        const [imgRes, vidRes] = await Promise.all([
            authFetch(`${API_URL}/assets/images?limit=1`),
            authFetch(`${API_URL}/assets/videos?limit=1`),
        ]);
        const counts: { images: number; videos: number } = { images: 0, videos: 0 };
        if (imgRes.ok) counts.images = (await imgRes.json()).total;
        if (vidRes.ok) counts.videos = (await vidRes.json()).total;
        dataCache.set(CACHE_KEYS.HISTORY_COUNTS, counts);
    } catch { /* ignore */ }
}

async function preloadHistoryImages(): Promise<void> {
    try {
        const res = await authFetch(`${API_URL}/assets/images?limit=${HISTORY_PRELOAD_LIMIT}&offset=0`);
        if (res.ok) dataCache.set(CACHE_KEYS.HISTORY_IMAGES, await res.json());
    } catch { /* ignore */ }
}

async function preloadHistoryVideos(): Promise<void> {
    try {
        const res = await authFetch(`${API_URL}/assets/videos?limit=${HISTORY_PRELOAD_LIMIT}&offset=0`);
        if (res.ok) dataCache.set(CACHE_KEYS.HISTORY_VIDEOS, await res.json());
    } catch { /* ignore */ }
}

async function preloadWorkflows(): Promise<void> {
    try {
        const [myRes, pubRes] = await Promise.all([
            authFetch(`${API_URL}/workflows`),
            authFetch(`${API_URL}/public-workflows`),
        ]);
        if (myRes.ok) dataCache.set(CACHE_KEYS.WORKFLOWS, await myRes.json());
        if (pubRes.ok) dataCache.set(CACHE_KEYS.PUBLIC_WORKFLOWS, await pubRes.json());
    } catch { /* ignore */ }
}

export function useDataPreload(token: string | null): void {
    const preloaded = useRef(false);

    useEffect(() => {
        if (!token) {
            dataCache.clear();
            preloaded.current = false;
            return;
        }

        if (preloaded.current) return;
        preloaded.current = true;

        Promise.all([
            preloadLibrary(),
            preloadHistoryCounts(),
            preloadHistoryImages(),
            preloadHistoryVideos(),
            preloadWorkflows(),
        ]);
    }, [token]);
}
