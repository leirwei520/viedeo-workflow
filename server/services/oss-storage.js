/**
 * oss-storage.js
 *
 * Generic Aliyun OSS upload/download helper.
 * Reuses OSS V1 signature logic extracted from tencent-vod.js.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function getOssConfig() {
    const endpoint = process.env.OSS_ENDPOINT;
    const internalEndpoint = process.env.OSS_INTERNAL_ENDPOINT || '';
    const bucket = process.env.OSS_BUCKET;
    const accessKey = process.env.OSS_ACCESS_KEY;
    const accessSecret = process.env.OSS_ACCESS_SECRET;
    const domain = process.env.OSS_DOMAIN || '';

    if (!endpoint || !bucket || !accessKey || !accessSecret) {
        return null;
    }

    return { endpoint, internalEndpoint, bucket, accessKey, accessSecret, domain };
}

function buildPublicUrl(config, objectKey) {
    if (config.domain) {
        return `${config.domain.replace(/\/$/, '')}/${objectKey}`;
    }
    return `https://${config.bucket}.${config.endpoint}/${objectKey}`;
}

/**
 * Upload a buffer to OSS and return the public URL.
 */
export async function uploadBuffer(buffer, objectKey, contentType = 'application/octet-stream') {
    const config = getOssConfig();
    if (!config) throw new Error('OSS not configured');

    const { endpoint, internalEndpoint, bucket, accessKey, accessSecret } = config;
    const uploadEndpoint = internalEndpoint || endpoint;
    const ossUrl = `https://${bucket}.${uploadEndpoint}/${objectKey}`;
    const cacheControl = 'public, max-age=31536000, immutable';

    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const dateStr = new Date().toUTCString();
            const stringToSign = `PUT\n\n${contentType}\n${dateStr}\n/${bucket}/${objectKey}`;
            const signature = crypto.createHmac('sha1', accessSecret).update(stringToSign).digest('base64');

            const controller = new AbortController();
            const timeoutMs = Math.max(60000, buffer.length / 500);
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            const res = await fetch(ossUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': contentType,
                    'Cache-Control': cacheControl,
                    'Date': dateStr,
                    'Authorization': `OSS ${accessKey}:${signature}`,
                    'Content-Length': buffer.length.toString()
                },
                body: buffer,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (res.ok) {
                return buildPublicUrl(config, objectKey);
            }

            const errText = await res.text();
            lastError = new Error(`OSS upload failed: ${res.status} - ${errText}`);
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
        }
    }

    throw lastError;
}

/**
 * Upload a local file to OSS.
 */
export async function uploadFile(localFilePath, objectKey) {
    const buffer = fs.readFileSync(localFilePath);
    const ext = path.extname(localFilePath).toLowerCase();
    const mimeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.json': 'application/json',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    return uploadBuffer(buffer, objectKey, contentType);
}

/**
 * Build an OSS object key for user assets.
 * Structure: user-assets/{userId}/{type}/{filename}
 */
export function buildObjectKey(userId, type, filename) {
    return `user-assets/${userId}/${type}/${filename}`;
}

/**
 * Check if OSS is configured.
 */
export function isOssConfigured() {
    return getOssConfig() !== null;
}

/**
 * Rewrite a public OSS URL to use the internal endpoint for server-side access.
 * Returns the original URL unchanged if not an OSS URL or no internal endpoint configured.
 */
export function toInternalOssUrl(url) {
    if (!url) return url;
    const config = getOssConfig();
    if (!config || !config.internalEndpoint) return url;
    const publicHost = `${config.bucket}.${config.endpoint}`;
    const internalHost = `${config.bucket}.${config.internalEndpoint}`;
    if (url.includes(publicHost)) {
        return url.replace(publicHost, internalHost);
    }
    return url;
}
