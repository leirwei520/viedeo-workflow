/**
 * imageHelpers.js
 * 
 * Utility functions for image/video processing and base64 conversion.
 */

import fs from 'fs';
import path from 'path';
import { toInternalOssUrl } from '../services/oss-storage.js';

// ============================================================================
// BASE64 HELPERS
// ============================================================================

/**
 * Resolve image to base64 - handles data URLs, OSS/HTTP URLs, and local file paths.
 * For remote URLs, fetches the content and converts to base64 data URL.
 * @param {string} input - Base64 data URL, HTTP URL, or local file path
 * @returns {string|null} Base64 data URL
 */
export function resolveImageToBase64(input) {
    if (!input) return null;
    if (input.startsWith('data:')) return input;

    // Remote URL (OSS or any HTTP) — fetch synchronously via sync XMLHttpRequest workaround
    // Since this function is called synchronously in many places, we use a sync fetch approach
    const cleanUrl = input.split('?')[0];

    if (input.startsWith('http://') || input.startsWith('https://')) {
        // Check if it's an OSS URL or external URL — try to extract pathname for /library/ fallback
        try {
            const url = new URL(input);
            const pathname = url.pathname;

            // If it's a /library/ path on local server, try local file first
            if (pathname.startsWith('/library/')) {
                const localResult = resolveLocalLibraryFile(pathname);
                if (localResult) return localResult;
            }
        } catch {}

        // For remote URLs, we can't do sync fetch. Return the URL as-is
        // and let the caller handle it (most AI APIs accept URLs directly)
        return input;
    }

    // Local /library/ path
    if (input.startsWith('/library/')) {
        const localResult = resolveLocalLibraryFile(cleanUrl);
        if (localResult) return localResult;
    }

    console.warn('Could not resolve image to base64:', input.substring(0, 100));
    return null;
}

function resolveLocalLibraryFile(filePath) {
    try {
        const pathWithoutQuery = filePath.split('?')[0];
        const libraryDir = process.env.LIBRARY_DIR || path.join(process.cwd(), 'library');
        const relativePath = pathWithoutQuery.replace('/library/', '');
        const absolutePath = path.join(libraryDir, relativePath);

        if (fs.existsSync(absolutePath)) {
            const fileBuffer = fs.readFileSync(absolutePath);
            const ext = path.extname(absolutePath).toLowerCase();
            const mimeType = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.webp': 'image/webp',
                '.mp4': 'video/mp4', '.webm': 'video/webm'
            }[ext] || 'image/png';
            return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
        }
    } catch (error) {
        console.error('Error resolving local file to base64:', error);
    }
    return null;
}

/**
 * Async version of resolveImageToBase64 that can fetch remote URLs.
 */
export async function resolveImageToBase64Async(input) {
    if (!input) return null;
    if (input.startsWith('data:')) return input;

    if (input.startsWith('http://') || input.startsWith('https://')) {
        try {
            const resp = await fetch(toInternalOssUrl(input.split('?')[0]));
            if (!resp.ok) {
                console.warn(`Failed to fetch remote image (${resp.status}): ${input.substring(0, 100)}`);
                return input;
            }
            const buffer = Buffer.from(await resp.arrayBuffer());
            const contentType = resp.headers.get('content-type') || 'image/png';
            return `data:${contentType};base64,${buffer.toString('base64')}`;
        } catch (err) {
            console.warn('Failed to fetch remote image:', err.message);
            return input;
        }
    }

    return resolveImageToBase64(input);
}

/**
 * Extract raw base64 from data URL (removes data:image/xxx;base64, prefix)
 * @param {string} dataUrl - Base64 data URL
 * @returns {string|null} Raw base64 string
 */
export function extractRawBase64(dataUrl) {
    if (!dataUrl) return null;
    if (dataUrl.startsWith('data:')) {
        return dataUrl.replace(/^data:[^;]+;base64,/, '');
    }
    return dataUrl;
}

// ============================================================================
// ASPECT RATIO MAPPING
// ============================================================================

/**
 * Map frontend aspect ratio to API-compatible format
 * @param {string} ratio - Frontend aspect ratio string
 * @returns {string} API-compatible aspect ratio
 */
export function mapAspectRatio(ratio) {
    const mapping = {
        'Auto': '1:1',
        '1:1': '1:1',
        '16:9': '16:9',
        '9:16': '9:16',
        '4:3': '4:3',
        '3:4': '3:4',
        '3:2': '3:2',
        '2:3': '2:3',
        '21:9': '21:9',
        '5:4': '5:4',
        '4:5': '4:5'
    };
    return mapping[ratio] || '1:1';
}

// ============================================================================
// FILE SAVING
// ============================================================================

/**
 * Save buffer to file and return URL
 * @param {Buffer} buffer - Data buffer
 * @param {string} dir - Directory to save to
 * @param {string} prefix - Filename prefix (e.g., 'img', 'vid')
 * @param {string} extension - File extension (e.g., 'png', 'mp4')
 * @param {string} [customId] - Optional custom ID to use instead of generating one
 * @returns {{ id: string, path: string, url: string }}
 */
export function saveBufferToFile(buffer, dir, prefix, extension, customId) {
    const id = customId || `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filename = `${id}.${extension}`;
    const filePath = path.join(dir, filename);

    fs.writeFileSync(filePath, buffer);

    // Determine URL path based on directory name
    const dirName = path.basename(dir);
    const url = `/library/${dirName}/${filename}`;

    return { id, path: filePath, url, filename };
}

/**
 * Save base64 data URL to file and return library URL
 * Used to sanitize workflow nodes before saving
 * 
 * @param {string} dataUrl - Base64 data URL (data:image/png;base64,...)
 * @param {string} imagesDir - Directory for saving images
 * @param {string} videosDir - Directory for saving videos
 * @returns {string} File URL or original value if not a data URL
 */
export function saveBase64ToFile(dataUrl, imagesDir, videosDir) {
    if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;

    // Skip if already a file URL
    if (!dataUrl.startsWith('data:')) return dataUrl;

    // Match image data URLs
    const imageMatch = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
    if (imageMatch) {
        const ext = imageMatch[1] === 'jpeg' ? 'jpg' : imageMatch[1];
        const base64Data = imageMatch[2];
        const buffer = Buffer.from(base64Data, 'base64');
        const saved = saveBufferToFile(buffer, imagesDir, 'wf_img', ext);
        console.log(`  Workflow sanitize: saved image ${saved.filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
        return saved.url;
    }

    // Match video data URLs
    const videoMatch = dataUrl.match(/^data:video\/(mp4|webm);base64,(.+)$/);
    if (videoMatch) {
        const ext = videoMatch[1];
        const base64Data = videoMatch[2];
        const buffer = Buffer.from(base64Data, 'base64');
        const saved = saveBufferToFile(buffer, videosDir, 'wf_vid', ext);
        console.log(`  Workflow sanitize: saved video ${saved.filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
        return saved.url;
    }

    return dataUrl;
}
