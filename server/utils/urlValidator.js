/**
 * URL validation utility to prevent SSRF attacks.
 * Blocks requests to private/internal networks and metadata endpoints.
 */

const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'metadata.google.internal',
    'instance-data',
]);

const PRIVATE_IP_RANGES = [
    /^127\./,                       // loopback
    /^10\./,                        // Class A private
    /^172\.(1[6-9]|2\d|3[01])\./,  // Class B private
    /^192\.168\./,                  // Class C private
    /^169\.254\./,                  // link-local
    /^0\./,                         // 0.0.0.0/8
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
    /^::1$/,                        // IPv6 loopback
    /^fd/i,                         // IPv6 ULA
    /^fe80/i,                       // IPv6 link-local
];

function isPrivateIp(hostname) {
    return PRIVATE_IP_RANGES.some(re => re.test(hostname));
}

/**
 * Validate that a URL is safe to fetch from the server.
 * @param {string} url - The URL to validate
 * @param {object} options
 * @param {string[]} options.allowedDomains - Optional whitelist of allowed domains
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateExternalUrl(url, { allowedDomains, allowPrivate = false } = {}) {
    if (!url || typeof url !== 'string') {
        return { valid: false, reason: 'URL is required' };
    }

    if (url.startsWith('data:')) {
        return { valid: true };
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { valid: false, reason: 'Invalid URL format' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, reason: `Blocked protocol: ${parsed.protocol}` };
    }

    const hostname = parsed.hostname.toLowerCase();

    if (!allowPrivate) {
        if (BLOCKED_HOSTNAMES.has(hostname)) {
            return { valid: false, reason: `Blocked hostname: ${hostname}` };
        }

        if (isPrivateIp(hostname)) {
            return { valid: false, reason: 'Private/internal IP addresses are not allowed' };
        }
    }

    if (allowedDomains && allowedDomains.length > 0) {
        const matched = allowedDomains.some(domain =>
            hostname === domain || hostname.endsWith(`.${domain}`)
        );
        if (!matched) {
            return { valid: false, reason: `Domain not in whitelist: ${hostname}` };
        }
    }

    return { valid: true };
}

/**
 * Safe fetch wrapper with timeout and size limit.
 * @param {string} url
 * @param {object} options
 * @param {number} options.timeoutMs - Abort after N ms (default 60s)
 * @param {number} options.maxBytes - Max response body size (default 200MB)
 * @param {object} options.fetchOptions - Extra fetch options
 */
export async function safeFetch(url, { timeoutMs = 60_000, maxBytes = 200 * 1024 * 1024, fetchOptions = {} } = {}) {
    const validation = validateExternalUrl(url);
    if (!validation.valid) {
        throw new Error(`SSRF blocked: ${validation.reason}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
            redirect: 'follow',
        });

        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > maxBytes) {
            throw new Error(`Response too large: ${contentLength} bytes (max: ${maxBytes})`);
        }

        return response;
    } finally {
        clearTimeout(timer);
    }
}
