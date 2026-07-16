/**
 * storage.js
 *
 * Unified storage service. All file persistence goes through here.
 * Uploads to Aliyun OSS and records URLs in MySQL.
 * Provides a temp-cache directory for ffmpeg / sharp intermediates.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { uploadBuffer, buildObjectKey, isOssConfigured } from './oss-storage.js';
import { getPool } from '../db/pool.js';

const TEMP_DIR = path.join(os.tmpdir(), 'chb-cache');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const MIME_MAP = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
};

function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function toMysqlDatetime(isoStr) {
    if (!isoStr) return new Date().toISOString().slice(0, 19).replace('T', ' ');
    return new Date(isoStr).toISOString().slice(0, 19).replace('T', ' ');
}

// ============================================================================
// TEMP CACHE
// ============================================================================

export function getTempDir() { return TEMP_DIR; }

export function getTempPath(filename) {
    return path.join(TEMP_DIR, filename);
}

export function writeTempFile(buffer, filename) {
    const p = path.join(TEMP_DIR, filename);
    fs.writeFileSync(p, buffer);
    return p;
}

export function removeTempFile(filePath) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
}

export function cleanupTempFiles(maxAgeMs = 3600_000) {
    try {
        const now = Date.now();
        for (const file of fs.readdirSync(TEMP_DIR)) {
            const fp = path.join(TEMP_DIR, file);
            try {
                const stat = fs.statSync(fp);
                if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(fp);
                }
            } catch { /* skip */ }
        }
    } catch { /* ignore */ }
}

// ============================================================================
// CORE: Upload buffer to OSS + record in DB
// ============================================================================

/**
 * Save an image buffer to OSS and write a row into the `images` table.
 * @returns {{ id, ossUrl, filename }}
 */
export async function saveImage(buffer, { userId, prompt, model, ext = 'png', customId, nodeId, metadata: extraMeta } = {}) {
    const id = customId || generateId('img');
    const filename = `${id}.${ext}`;
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    const effectiveUserId = String(userId || '0');
    const objectKey = buildObjectKey(effectiveUserId, 'images', filename);
    const ossUrl = await uploadBuffer(buffer, objectKey, contentType);

    const fileSize = buffer.length;
    const metadata = {
        id,
        filename,
        userId: effectiveUserId,
        nodeId: nodeId || null,
        prompt: prompt || '',
        model: model || '',
        createdAt: new Date().toISOString(),
        type: 'images',
        fileSize,
        ...extraMeta,
    };

    await dbInsertImage(metadata, ossUrl, fileSize);

    console.log(`[Storage] Image saved → OSS ${objectKey}`);
    return { id, ossUrl, filename, metadata };
}

/**
 * Save a video buffer to OSS and write a row into the `videos` table.
 * @returns {{ id, ossUrl, filename }}
 */
export async function saveVideo(buffer, { userId, prompt, model, aspectRatio, resolution, duration, ext = 'mp4', customId, nodeId, metadata: extraMeta } = {}) {
    const id = customId || generateId('vid');
    const filename = `${id}.${ext}`;
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    const effectiveUserId = String(userId || '0');
    const objectKey = buildObjectKey(effectiveUserId, 'videos', filename);
    const ossUrl = await uploadBuffer(buffer, objectKey, contentType);

    const fileSize = buffer.length;
    const metadata = {
        id,
        filename,
        userId: effectiveUserId,
        nodeId: nodeId || null,
        prompt: prompt || '',
        model: model || '',
        aspectRatio: aspectRatio || null,
        resolution: resolution || null,
        duration: duration || null,
        createdAt: new Date().toISOString(),
        type: 'videos',
        fileSize,
        ...extraMeta,
    };

    await dbInsertVideo(metadata, ossUrl, fileSize);

    console.log(`[Storage] Video saved → OSS ${objectKey}`);
    return { id, ossUrl, filename, metadata };
}

/**
 * Save an audio buffer to OSS (no DB record, just file storage).
 * @returns {{ id, ossUrl, filename }}
 */
export async function saveAudioFile(buffer, { userId, ext = 'wav' } = {}) {
    const id = generateId('aud');
    const filename = `${id}.${ext}`;
    const mimeMap = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac' };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    const effectiveUserId = String(userId || '0');
    const objectKey = buildObjectKey(effectiveUserId, 'audios', filename);
    const ossUrl = await uploadBuffer(buffer, objectKey, contentType);

    console.log(`[Storage] Audio saved → OSS ${objectKey}`);
    return { id, ossUrl, filename };
}

/**
 * Upload an arbitrary buffer (e.g. workflow-sanitized base64) to OSS.
 * Records in DB as image or video depending on type.
 */
export async function saveBase64Asset(dataUrl, userId) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl;

    const imageMatch = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
    if (imageMatch) {
        const ext = imageMatch[1] === 'jpeg' ? 'jpg' : imageMatch[1];
        const buffer = Buffer.from(imageMatch[2], 'base64');
        const result = await saveImage(buffer, { userId, ext });
        return result.ossUrl;
    }

    const videoMatch = dataUrl.match(/^data:video\/(mp4|webm);base64,(.+)$/);
    if (videoMatch) {
        const ext = videoMatch[1];
        const buffer = Buffer.from(videoMatch[2], 'base64');
        const result = await saveVideo(buffer, { userId, ext });
        return result.ossUrl;
    }

    return dataUrl;
}

/**
 * Resolve a /library/ path to an OSS URL.
 * Tries local file first (reads + uploads to OSS), then DB lookup by filename.
 * Returns the original path unchanged if resolution fails.
 */
export async function resolveLibraryPathToOss(libraryPath, userId) {
    if (!libraryPath || typeof libraryPath !== 'string') return libraryPath;
    if (!libraryPath.includes('/library/')) return libraryPath;
    if (libraryPath.startsWith('http://') || libraryPath.startsWith('https://')) return libraryPath;
    if (libraryPath.startsWith('data:')) return libraryPath;

    const cleanPath = libraryPath.split('?')[0];
    const filename = path.basename(cleanPath);

    const libraryDir = path.resolve(process.env.LIBRARY_DIR || path.join(process.cwd(), 'library'));
    const relativePath = cleanPath.replace(/^.*\/library\//, '');
    const absolutePath = path.resolve(path.join(libraryDir, relativePath));

    if (!absolutePath.startsWith(libraryDir + path.sep) && absolutePath !== libraryDir) {
        console.warn(`[Storage] Path traversal blocked: ${libraryPath}`);
        return libraryPath;
    }

    if (fs.existsSync(absolutePath)) {
        try {
            const buffer = fs.readFileSync(absolutePath);
            const ext = path.extname(absolutePath).replace('.', '') || 'png';
            const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
            const result = isVideo
                ? await saveVideo(buffer, { userId, ext })
                : await saveImage(buffer, { userId, ext });
            console.log(`[Storage] Migrated local file to OSS: ${filename} → ${result.ossUrl}`);
            return result.ossUrl;
        } catch (err) {
            console.warn(`[Storage] Failed to migrate local file ${filename}:`, err.message);
        }
    }

    const pool = getPool();
    if (pool) {
        try {
            const userFilter = userId ? ' AND user_id = ?' : '';
            const params = userId ? [filename, userId] : [filename];
            const [rows] = await pool.execute(
                `SELECT oss_url FROM images WHERE filename = ? AND oss_url IS NOT NULL${userFilter} LIMIT 1`,
                params
            );
            if (rows.length > 0 && rows[0].oss_url) {
                console.log(`[Storage] Resolved ${filename} from DB → ${rows[0].oss_url}`);
                return rows[0].oss_url;
            }
            const [vRows] = await pool.execute(
                `SELECT oss_url FROM videos WHERE filename = ? AND oss_url IS NOT NULL${userFilter} LIMIT 1`,
                params
            );
            if (vRows.length > 0 && vRows[0].oss_url) {
                console.log(`[Storage] Resolved ${filename} from DB → ${vRows[0].oss_url}`);
                return vRows[0].oss_url;
            }
        } catch (err) {
            console.warn(`[Storage] DB lookup for ${filename} failed:`, err.message);
        }
    }

    return libraryPath;
}

/**
 * Upload a local temp file to OSS, record in DB, then remove local file.
 */
export async function uploadTempFileAsImage(localPath, { userId, prompt, model, customId } = {}) {
    const buffer = fs.readFileSync(localPath);
    const ext = path.extname(localPath).replace('.', '') || 'png';
    const result = await saveImage(buffer, { userId, prompt, model, ext, customId });
    removeTempFile(localPath);
    return result;
}

export async function uploadTempFileAsVideo(localPath, { userId, prompt, model, aspectRatio, resolution, duration, customId } = {}) {
    const buffer = fs.readFileSync(localPath);
    const ext = path.extname(localPath).replace('.', '') || 'mp4';
    const result = await saveVideo(buffer, { userId, prompt, model, aspectRatio, resolution, duration, ext, customId });
    removeTempFile(localPath);
    return result;
}

// ============================================================================
// DB READ helpers
// ============================================================================

export async function listImages(userId, { limit = 50, offset = 0 } = {}) {
    const pool = getPool();
    if (!pool) return { assets: [], total: 0, hasMore: false };
    try {
        const uid = Number(userId);
        const lim = Math.max(1, Math.min(200, parseInt(limit) || 50));
        const off = Math.max(0, parseInt(offset) || 0);
        const [countRows] = await pool.query('SELECT COUNT(*) as total FROM images WHERE user_id = ?', [uid]);
        const total = countRows[0].total;
        const [rows] = await pool.query(
            `SELECT id, filename, prompt, model, oss_url, local_url, metadata, created_at FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`,
            [uid]
        );
        const assets = rows.map(r => ({
            id: r.id, filename: r.filename, prompt: r.prompt, model: r.model,
            url: r.oss_url || r.local_url,
            createdAt: r.created_at, type: 'images',
            ...(r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {}),
        }));
        return { assets, total, hasMore: offset + assets.length < total };
    } catch (err) {
        console.error('[Storage] listImages failed:', err.message);
        return { assets: [], total: 0, hasMore: false };
    }
}

export async function listVideos(userId, { limit = 50, offset = 0 } = {}) {
    const pool = getPool();
    if (!pool) return { assets: [], total: 0, hasMore: false };
    try {
        const uid = Number(userId);
        const lim = Math.max(1, Math.min(200, parseInt(limit) || 50));
        const off = Math.max(0, parseInt(offset) || 0);
        const [countRows] = await pool.query('SELECT COUNT(*) as total FROM videos WHERE user_id = ?', [uid]);
        const total = countRows[0].total;
        const [rows] = await pool.query(
            `SELECT id, filename, prompt, model, oss_url, local_url, metadata, created_at FROM videos WHERE user_id = ? ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`,
            [uid]
        );
        const assets = rows.map(r => ({
            id: r.id, filename: r.filename, prompt: r.prompt, model: r.model,
            url: r.oss_url || r.local_url,
            createdAt: r.created_at, type: 'videos',
            ...(r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {}),
        }));
        return { assets, total, hasMore: offset + assets.length < total };
    } catch (err) {
        console.error('[Storage] listVideos failed:', err.message);
        return { assets: [], total: 0, hasMore: false };
    }
}

export async function getAssetById(type, id) {
    const pool = getPool();
    if (!pool) return null;
    const table = type === 'images' ? 'images' : 'videos';
    try {
        const [rows] = await pool.execute(`SELECT * FROM \`${table}\` WHERE id = ?`, [id]);
        if (rows.length === 0) return null;
        const r = rows[0];
        return { ...r, url: r.oss_url || r.local_url };
    } catch { return null; }
}

export async function deleteAsset(type, id, userId) {
    const pool = getPool();
    if (!pool) return false;
    const table = type === 'images' ? 'images' : 'videos';
    try {
        await pool.execute(`DELETE FROM \`${table}\` WHERE id = ? AND user_id = ?`, [Number(id), Number(userId)]);
        return true;
    } catch (err) {
        console.error(`[Storage] deleteAsset failed: ${err.message}`);
        return false;
    }
}

export async function getStorageStats(userId) {
    const pool = getPool();
    if (!pool) return null;
    try {
        const uid = Number(userId);
        const [[row]] = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM images WHERE user_id = ?) AS img_count,
                (SELECT COALESCE(SUM(file_size), 0) FROM images WHERE user_id = ?) AS img_size,
                (SELECT COUNT(*) FROM videos WHERE user_id = ?) AS vid_count,
                (SELECT COALESCE(SUM(file_size), 0) FROM videos WHERE user_id = ?) AS vid_size,
                (SELECT COUNT(*) FROM workflows WHERE user_id = ?) AS wf_count,
                (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM workflows WHERE user_id = ?) AS wf_size,
                (SELECT COUNT(*) FROM chat_sessions WHERE user_id = ?) AS ch_count,
                (SELECT COALESCE(SUM(LENGTH(messages)), 0) FROM chat_sessions WHERE user_id = ?) AS ch_size,
                (SELECT COUNT(*) FROM library_assets WHERE user_id = ?) AS lib_count
        `, [uid, uid, uid, uid, uid, uid, uid, uid, uid]);

        const imgSize = Number(row.img_size) || 0;
        const vidSize = Number(row.vid_size) || 0;
        const wfSize = Number(row.wf_size) || 0;
        const chSize = Number(row.ch_size) || 0;
        return {
            images: { count: row.img_count, size: imgSize },
            videos: { count: row.vid_count, size: vidSize },
            workflows: { count: row.wf_count, size: wfSize },
            chats: { count: row.ch_count, size: chSize },
            libraryAssets: { count: row.lib_count, size: 0 },
            totalSize: imgSize + vidSize + wfSize + chSize,
        };
    } catch { return null; }
}

// ============================================================================
// GENERATION RECOVERY (replaces local metadata .json lookup)
// ============================================================================

export async function getGenerationStatus(nodeId, userId) {
    const pool = getPool();
    if (!pool) return null;
    try {
        const userFilter = userId ? ' AND user_id = ?' : '';
        const params = userId ? [nodeId, userId] : [nodeId];

        const [imgRows] = await pool.execute(
            `SELECT oss_url, local_url, created_at FROM images WHERE node_id = ?${userFilter} ORDER BY created_at DESC LIMIT 1`,
            params
        );
        if (imgRows.length > 0) {
            const r = imgRows[0];
            return { status: 'success', resultUrl: r.oss_url || r.local_url, type: 'image', createdAt: r.created_at };
        }
        const [vidRows] = await pool.execute(
            `SELECT oss_url, local_url, created_at FROM videos WHERE node_id = ?${userFilter} ORDER BY created_at DESC LIMIT 1`,
            params
        );
        if (vidRows.length > 0) {
            const r = vidRows[0];
            return { status: 'success', resultUrl: r.oss_url || r.local_url, type: 'video', createdAt: r.created_at };
        }
        const [legacyImg] = await pool.execute(
            `SELECT oss_url, local_url, created_at FROM images WHERE id = ?${userFilter}`,
            params
        );
        if (legacyImg.length > 0) {
            const r = legacyImg[0];
            return { status: 'success', resultUrl: r.oss_url || r.local_url, type: 'image', createdAt: r.created_at };
        }
        const [legacyVid] = await pool.execute(
            `SELECT oss_url, local_url, created_at FROM videos WHERE id = ?${userFilter}`,
            params
        );
        if (legacyVid.length > 0) {
            const r = legacyVid[0];
            return { status: 'success', resultUrl: r.oss_url || r.local_url, type: 'video', createdAt: r.created_at };
        }
        return null;
    } catch { return null; }
}

// ============================================================================
// PRIVATE DB INSERT helpers
// ============================================================================

async function dbInsertImage(metadata, ossUrl, fileSize = 0) {
    const pool = getPool();
    if (!pool) return;
    try {
        await pool.execute(
            `INSERT INTO images (id, user_id, node_id, filename, prompt, model, oss_url, local_url, file_size, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
            [
                metadata.id, metadata.userId, metadata.nodeId || null,
                metadata.filename,
                metadata.prompt || null, metadata.model || null,
                ossUrl, fileSize, JSON.stringify(metadata),
                toMysqlDatetime(metadata.createdAt),
            ]
        );
    } catch (err) {
        console.error(`[Storage] DB insert image failed: ${err.message}`);
    }
}

async function dbInsertVideo(metadata, ossUrl, fileSize = 0) {
    const pool = getPool();
    if (!pool) return;
    try {
        await pool.execute(
            `INSERT INTO videos (id, user_id, node_id, filename, prompt, model, aspect_ratio, resolution, duration, oss_url, local_url, file_size, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
            [
                metadata.id, metadata.userId, metadata.nodeId || null,
                metadata.filename,
                metadata.prompt || null, metadata.model || null,
                metadata.aspectRatio || null, metadata.resolution || null,
                metadata.duration || null,
                ossUrl, fileSize, JSON.stringify(metadata),
                toMysqlDatetime(metadata.createdAt),
            ]
        );
    } catch (err) {
        console.error(`[Storage] DB insert video failed: ${err.message}`);
    }
}
