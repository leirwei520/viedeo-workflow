/**
 * sync.js
 *
 * Cloud sync service: orchestrates DB writes and OSS uploads.
 * All public methods are fire-and-forget safe — errors are logged, never thrown to callers.
 */

import fs from 'fs';
import path from 'path';
import { getPool } from '../db/pool.js';
import { uploadFile, buildObjectKey, isOssConfigured } from './oss-storage.js';

function requireUserId(userId, caller) {
    if (!userId || userId === 'default') {
        console.error(`[Sync] ${caller} called without valid userId (got: ${userId})`);
        return null;
    }
    return String(userId);
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function toMysqlDatetime(isoStr) {
    if (!isoStr) return new Date().toISOString().slice(0, 19).replace('T', ' ');
    return new Date(isoStr).toISOString().slice(0, 19).replace('T', ' ');
}

async function logSync(pool, userId, entityType, entityId, action, ossKey = null) {
    try {
        await pool.execute(
            'INSERT INTO sync_log (user_id, entity_type, entity_id, action, oss_key) VALUES (?, ?, ?, ?, ?)',
            [userId, entityType, entityId, action, ossKey]
        );
    } catch (e) {
        console.warn(`[Sync] Failed to write sync_log: ${e.message}`);
    }
}

// ============================================================================
// WORKFLOW SYNC
// ============================================================================

export async function syncWorkflow(workflowData, userId) {
    const uid = requireUserId(userId, 'syncWorkflow');
    if (!uid) return;
    const pool = getPool();
    if (!pool) return;

    try {
        const id = workflowData.id;
        const title = workflowData.title || null;
        const data = JSON.stringify(workflowData);
        const coverUrl = workflowData.coverUrl || null;
        const nodeCount = workflowData.nodes?.length || 0;
        const createdAt = toMysqlDatetime(workflowData.createdAt);
        const updatedAt = toMysqlDatetime(workflowData.updatedAt);

        await pool.execute(
            `INSERT INTO workflows (id, user_id, title, data, cover_url, node_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                title = VALUES(title),
                data = VALUES(data),
                cover_url = VALUES(cover_url),
                node_count = VALUES(node_count),
                updated_at = VALUES(updated_at)`,
            [id, uid, title, data, coverUrl, nodeCount, createdAt, updatedAt]
        );

        await logSync(pool, uid, 'workflow', id, 'upload');
        console.log(`[Sync] Workflow ${id} synced to DB (user=${uid}).`);
    } catch (err) {
        console.error(`[Sync] Workflow sync failed: ${err.message}`);
    }
}

// ============================================================================
// IMAGE SYNC
// ============================================================================

export async function syncImage(metadata, localFilePath, userId) {
    const uid = requireUserId(userId, 'syncImage');
    if (!uid) return;
    const pool = getPool();
    if (!pool) return;

    try {
        const id = metadata.id;
        const filename = metadata.filename;
        const localUrl = `/library/images/${filename}`;

        let ossUrl = null;
        if (isOssConfigured() && fs.existsSync(localFilePath)) {
            try {
                const objectKey = buildObjectKey(uid, 'images', filename);
                ossUrl = await uploadFile(localFilePath, objectKey);
                console.log(`[Sync] Image ${filename} uploaded to OSS.`);
            } catch (ossErr) {
                console.warn(`[Sync] OSS upload for image ${filename} failed: ${ossErr.message}`);
            }
        }

        await pool.execute(
            `INSERT INTO images (id, user_id, filename, prompt, model, oss_url, local_url, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                oss_url = COALESCE(VALUES(oss_url), oss_url),
                metadata = VALUES(metadata),
                prompt = VALUES(prompt),
                model = VALUES(model)`,
            [
                id, uid, filename,
                metadata.prompt || null,
                metadata.model || null,
                ossUrl, localUrl,
                JSON.stringify(metadata),
                toMysqlDatetime(metadata.createdAt)
            ]
        );

        await logSync(pool, uid, 'image', id, 'upload', ossUrl ? buildObjectKey(uid, 'images', filename) : null);
        console.log(`[Sync] Image ${id} synced to DB (user=${uid}).`);
    } catch (err) {
        console.error(`[Sync] Image sync failed: ${err.message}`);
    }
}

// ============================================================================
// VIDEO SYNC
// ============================================================================

export async function syncVideo(metadata, localFilePath, userId) {
    const uid = requireUserId(userId, 'syncVideo');
    if (!uid) return;
    const pool = getPool();
    if (!pool) return;

    try {
        const id = metadata.id;
        const filename = metadata.filename;
        const localUrl = `/library/videos/${filename}`;

        let ossUrl = null;
        if (isOssConfigured() && fs.existsSync(localFilePath)) {
            try {
                const objectKey = buildObjectKey(uid, 'videos', filename);
                ossUrl = await uploadFile(localFilePath, objectKey);
                console.log(`[Sync] Video ${filename} uploaded to OSS.`);
            } catch (ossErr) {
                console.warn(`[Sync] OSS upload for video ${filename} failed: ${ossErr.message}`);
            }
        }

        await pool.execute(
            `INSERT INTO videos (id, user_id, filename, prompt, model, aspect_ratio, resolution, duration, oss_url, local_url, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                oss_url = COALESCE(VALUES(oss_url), oss_url),
                metadata = VALUES(metadata),
                prompt = VALUES(prompt),
                model = VALUES(model)`,
            [
                id, uid, filename,
                metadata.prompt || null,
                metadata.model || null,
                metadata.aspectRatio || null,
                metadata.resolution || null,
                metadata.duration || null,
                ossUrl, localUrl,
                JSON.stringify(metadata),
                toMysqlDatetime(metadata.createdAt)
            ]
        );

        await logSync(pool, uid, 'video', id, 'upload', ossUrl ? buildObjectKey(uid, 'videos', filename) : null);
        console.log(`[Sync] Video ${id} synced to DB (user=${uid}).`);
    } catch (err) {
        console.error(`[Sync] Video sync failed: ${err.message}`);
    }
}

// ============================================================================
// DELETE SYNC
// ============================================================================

export async function syncDelete(entityType, entityId, userId) {
    const uid = requireUserId(userId, 'syncDelete');
    if (!uid) return;
    const pool = getPool();
    if (!pool) return;

    try {
        const table = entityType === 'workflow' ? 'workflows' : entityType === 'image' ? 'images' : 'videos';
        await pool.execute(`DELETE FROM \`${table}\` WHERE id = ? AND user_id = ?`, [entityId, uid]);
        await logSync(pool, uid, entityType, entityId, 'delete');
        console.log(`[Sync] ${entityType} ${entityId} deleted from DB (user=${uid}).`);
    } catch (err) {
        console.error(`[Sync] Delete sync failed: ${err.message}`);
    }
}

// ============================================================================
// CLOUD LOAD (for cross-device restore)
// ============================================================================

export async function loadWorkflows(userId) {
    const pool = getPool();
    if (!pool) return [];

    try {
        const [rows] = await pool.execute(
            'SELECT id, title, cover_url, node_count, created_at, updated_at FROM workflows WHERE user_id = ? ORDER BY updated_at DESC',
            [userId]
        );
        return rows;
    } catch (err) {
        console.error(`[Sync] Load workflows failed: ${err.message}`);
        return [];
    }
}

export async function loadWorkflowById(workflowId, userId) {
    const pool = getPool();
    if (!pool) return null;

    try {
        const [rows] = await pool.execute(
            'SELECT * FROM workflows WHERE id = ? AND user_id = ?',
            [workflowId, userId]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch (err) {
        console.error(`[Sync] Load workflow failed: ${err.message}`);
        return null;
    }
}

export async function loadAssets(type, userId, limit = 50, offset = 0) {
    const pool = getPool();
    if (!pool) return { assets: [], total: 0 };

    try {
        const table = type === 'images' ? 'images' : 'videos';
        const [countRows] = await pool.execute(
            `SELECT COUNT(*) as total FROM \`${table}\` WHERE user_id = ?`,
            [userId]
        );
        const total = countRows[0].total;

        const [rows] = await pool.execute(
            `SELECT * FROM \`${table}\` WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [userId, limit, offset]
        );

        return { assets: rows, total };
    } catch (err) {
        console.error(`[Sync] Load ${type} failed: ${err.message}`);
        return { assets: [], total: 0 };
    }
}

// ============================================================================
// SYNC STATUS
// ============================================================================

export async function getSyncStatus(userId) {
    const pool = getPool();
    if (!pool) return { connected: false, workflows: 0, images: 0, videos: 0 };

    try {
        const [[wf]] = await pool.execute('SELECT COUNT(*) as c FROM workflows WHERE user_id = ?', [userId]);
        const [[img]] = await pool.execute('SELECT COUNT(*) as c FROM images WHERE user_id = ?', [userId]);
        const [[vid]] = await pool.execute('SELECT COUNT(*) as c FROM videos WHERE user_id = ?', [userId]);

        return {
            connected: true,
            workflows: wf.c,
            images: img.c,
            videos: vid.c
        };
    } catch (err) {
        return { connected: false, workflows: 0, images: 0, videos: 0 };
    }
}
