/**
 * API Configuration
 *
 * Priority (development): VITE_API_BASE_URL env (forced) > localStorage > auto-detect
 * Priority (production):  localStorage manual override > VITE_API_BASE_URL env > auto-detect
 */

export const isElectron = !!window.electronAPI;
export const APP_ENV = import.meta.env.VITE_APP_ENV || 'development';

const STORAGE_KEY = 'chuhaibang_server_url';

/**
 * Optional custom CDN/CNAME domain mapped to the object-storage bucket.
 * Configure via VITE_OSS_CUSTOM_DOMAIN (e.g. "cdn.example.com"). When unset,
 * only standard aliyuncs.com OSS URLs are recognized.
 */
export const OSS_CUSTOM_DOMAIN: string = (import.meta.env.VITE_OSS_CUSTOM_DOMAIN as string) || '';

/** Whether a URL points to the configured object storage (standard OSS host or custom domain). */
export function isOssUrl(url: string): boolean {
    if (!url) return false;
    if (/\.oss[-.].*aliyuncs\.com\//.test(url)) return true;
    return !!OSS_CUSTOM_DOMAIN && url.includes(OSS_CUSTOM_DOMAIN);
}

function getDefaultServer(): string {
    const envUrl = import.meta.env.VITE_API_BASE_URL;
    if (envUrl) return envUrl.replace(/\/+$/, '');

    if (typeof window !== 'undefined' && window.location) {
        return window.location.origin;
    }
    return '';
}

function resolveBaseUrl(): string {
    // In development, use empty base so requests go through the Vite proxy (/api -> localhost:3001)
    if (import.meta.env.DEV) return '';

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored.replace(/\/+$/, '');
    return getDefaultServer();
}

const _base = resolveBaseUrl();

export const API_BASE_URL: string = _base;
export const API_URL: string = _base ? `${_base}/api` : '/api';

/** Read the current server URL (for display in settings) */
export function getServerUrl(): string {
    return localStorage.getItem(STORAGE_KEY) || '';
}

/**
 * Persist a new server URL and reload the app so all modules
 * pick up the updated API_URL / API_BASE_URL on next import.
 */
export function setServerUrl(url: string) {
    const clean = url.replace(/\/+$/, '');
    localStorage.setItem(STORAGE_KEY, clean);
    if (window.electronAPI) {
        window.electronAPI.setServerUrl(clean);
    }
    window.location.reload();
}

/**
 * One-time init on app startup: sync electron-store -> localStorage
 * so that resolveBaseUrl() picks it up on next page load.
 */
export async function initServerUrl(): Promise<string> {
    if (window.electronAPI) {
        const stored = await window.electronAPI.getServerUrl();
        if (stored) {
            localStorage.setItem(STORAGE_KEY, stored.replace(/\/+$/, ''));
        }
    }
    return resolveBaseUrl();
}

/** Build full API endpoint URL. Handles both browser and Electron/file:// */
export function apiEndpoint(path: string): string {
    const base = API_URL || '/api';
    const cleanPath = path.startsWith('/api') ? path.slice(4) : path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
}

/**
 * Convert a server-relative asset path (e.g. /library/images/foo.png)
 * to a full URL. In browser mode the browser resolves it automatically;
 * in Electron file:// mode we must prepend the server origin.
 */
/**
 * Rewrite URLs that point to a stale backend IP so they use the
 * current API_BASE_URL instead.  Handles stored node data that was
 * persisted with a previous server address.
 */
function rewriteStaleHost(url: string): string {
    const m = url.match(/^https?:\/\/[\d.]+:3001(\/.*)/);
    if (m) {
        const currentHost = API_BASE_URL.replace(/\/+$/, '');
        if (!url.startsWith(currentHost)) {
            return `${currentHost}${m[1]}`;
        }
    }
    return url;
}

export function assetUrl(path: string | undefined): string {
    if (!path) return '';
    if (path.startsWith('data:') || path.startsWith('blob:')) return path;
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return rewriteStaleHost(path);
    }
    return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('access_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

/**
 * Global auth expiry event.
 * When any API call receives a 401, this event fires to trigger logout + redirect.
 */
export const AUTH_EXPIRED_EVENT = 'auth:session-expired';

let _refreshing: Promise<boolean> | null = null;

export const AUTH_TOKENS_REFRESHED_EVENT = 'auth:tokens-refreshed';

export async function tryRefreshToken(): Promise<boolean> {
    const rt = localStorage.getItem('refresh_token');
    if (!rt) return false;
    try {
        const authApi = API_URL ? `${API_URL}/auth` : '/api/auth';
        const res = await fetch(`${authApi}/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: rt }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);
        window.dispatchEvent(new CustomEvent(AUTH_TOKENS_REFRESHED_EVENT, {
            detail: { accessToken: data.access_token, refreshToken: data.refresh_token }
        }));
        return true;
    } catch {
        return false;
    }
}

/**
 * Auth-aware fetch wrapper. On 401:
 *   1. Attempt to refresh the access token
 *   2. If refresh succeeds, retry the original request once
 *   3. If refresh fails, fire AUTH_EXPIRED_EVENT → useAuth clears tokens → redirect to login
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const base = getAuthHeaders();
    if (init?.body instanceof FormData) {
        delete base['Content-Type'];
    }
    const headers = { ...base, ...(init?.headers as Record<string, string> || {}) };
    const res = await fetch(input, { ...init, headers });

    if (res.status === 401) {
        if (!_refreshing) {
            _refreshing = tryRefreshToken().finally(() => { _refreshing = null; });
        }
        const refreshed = await _refreshing;
        if (refreshed) {
            const retryBase = getAuthHeaders();
            if (init?.body instanceof FormData) delete retryBase['Content-Type'];
            const retryHeaders = { ...retryBase, ...(init?.headers as Record<string, string> || {}) };
            return fetch(input, { ...init, headers: retryHeaders });
        }
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }

    return res;
}

/**
 * Append Alibaba OSS image processing params for thumbnails.
 * Returns the original URL unchanged if it's not an OSS image URL.
 */
export function ossThumb(url: string | undefined, size: number): string {
    if (!url) return '';
    const px = size * (window.devicePixelRatio || 2);
    if (isOssUrl(url)) {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}x-oss-process=image/resize,m_fill,w_${Math.round(px)},h_${Math.round(px)}/quality,Q_90`;
    }
    return url;
}

/**
 * Resize an OSS image to fit within maxWidth while preserving aspect ratio.
 * Uses lfit mode (no crop). Returns original URL for non-OSS images.
 */
export function ossResize(url: string | undefined, maxWidth: number): string {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const px = Math.round(maxWidth * (window.devicePixelRatio || 2));
    if (isOssUrl(url)) {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}x-oss-process=image/resize,m_lfit,w_${px}/quality,Q_85`;
    }
    return url;
}

/**
 * Generate a poster image (first-frame snapshot) for an OSS video.
 * Uses OSS video snapshot processing. Returns empty string for non-OSS URLs.
 */
export function ossVideoPoster(url: string | undefined, width = 500): string {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('blob:')) return '';
    const px = Math.round(width * (window.devicePixelRatio || 2));
    if (isOssUrl(url)) {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}x-oss-process=video/snapshot,t_0,f_jpg,w_${px},m_fast`;
    }
    return '';
}
