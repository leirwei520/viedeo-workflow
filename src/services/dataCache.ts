/**
 * Two-tier data cache: in-memory (instant) + sessionStorage (survives refresh).
 *
 * Used to preload and cache panel data (library, history, workflows)
 * so panels open instantly from cache while refreshing in the background.
 */

interface CacheEntry<T = unknown> {
    data: T;
    timestamp: number;
    ttl: number;
}

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const STORAGE_PREFIX = 'dc:';

export const CACHE_KEYS = {
    LIBRARY: 'library',
    HISTORY_IMAGES: 'history:images',
    HISTORY_VIDEOS: 'history:videos',
    HISTORY_COUNTS: 'history:counts',
    WORKFLOWS: 'workflows',
    PUBLIC_WORKFLOWS: 'public-workflows',
} as const;

class DataCacheService {
    private store = new Map<string, CacheEntry>();

    get<T>(key: string): T | null {
        let entry = this.store.get(key);

        if (!entry) {
            entry = this.readStorage<T>(key);
            if (entry) this.store.set(key, entry);
        }

        if (!entry) return null;

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.store.delete(key);
            this.removeStorage(key);
            return null;
        }
        return entry.data as T;
    }

    set<T>(key: string, data: T, ttl = DEFAULT_TTL): void {
        const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl };
        this.store.set(key, entry);
        this.writeStorage(key, entry);
    }

    has(key: string): boolean {
        return this.get(key) !== null;
    }

    invalidate(key: string): void {
        this.store.delete(key);
        this.removeStorage(key);
    }

    clear(): void {
        this.store.clear();
        try {
            const keys: string[] = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
            }
            keys.forEach(k => sessionStorage.removeItem(k));
        } catch { /* sessionStorage unavailable */ }
    }

    private writeStorage<T>(key: string, entry: CacheEntry<T>): void {
        try {
            sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
        } catch { /* quota exceeded or unavailable — ignore */ }
    }

    private readStorage<T>(key: string): CacheEntry<T> | null {
        try {
            const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
            if (!raw) return null;
            return JSON.parse(raw) as CacheEntry<T>;
        } catch { return null; }
    }

    private removeStorage(key: string): void {
        try { sessionStorage.removeItem(STORAGE_PREFIX + key); } catch { /* noop */ }
    }
}

export const dataCache = new DataCacheService();
