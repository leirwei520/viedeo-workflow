/**
 * worker.js
 *
 * Standalone worker process that consumes generation tasks from RabbitMQ.
 * Runs independently from the API server. Can be scaled horizontally.
 *
 * Usage:  node server/worker.js
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { connectRabbitMQ, QUEUES, onReconnect } from './services/rabbitmq.js';
import { updateTaskStatus, decrementUserConcurrency } from './services/taskQueue.js';
import { persistDeduction } from './services/balance.js';
import { saveImage, saveVideo, resolveLibraryPathToOss } from './services/storage.js';
import { resolveImageToBase64 } from './utils/imageHelpers.js';
import { testConnection } from './db/pool.js';
import { testRedisConnection, getRedis as getRedisClient } from './db/redis.js';

async function logUsage(data) {
    await persistDeduction(data);
}

// Provider imports
import { generateKlingVideo, generateKlingImage, generateKlingMultiImage } from './services/kling.js';
import { generateHailuoVideo } from './services/hailuo.js';
import { generateVolcengineVideo } from './services/volcengine.js';
import { generateTencentVideo, generateTencentImage } from './services/tencent-vod.js';
import { generateChuhaibangImage } from './services/chuhaibang.js';

const IMAGE_CONCURRENCY = parseInt(process.env.RABBITMQ_IMAGE_CONCURRENCY) || 10;
const VIDEO_CONCURRENCY = parseInt(process.env.RABBITMQ_VIDEO_CONCURRENCY) || 5;

// Environment config (same as index.js but read directly from process.env)
const ENV = {
    KLING_ACCESS_KEY: process.env.KLING_ACCESS_KEY,
    KLING_SECRET_KEY: process.env.KLING_SECRET_KEY,
    HAILUO_API_KEY: process.env.HAILUO_API_KEY,
    FAL_API_KEY: process.env.FAL_API_KEY,
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_MODEL_ID: process.env.ARK_MODEL_ID || 'doubao-seedance-2-0-260128',
    CHB_API_KEY: process.env.CHB_API_KEY,
    CHB_BASE_URL: process.env.CHB_BASE_URL || 'https://your-chb-endpoint.example.com/api',
    TENCENT_SECRET_ID: process.env.TENCENT_SECRET_ID,
    TENCENT_SECRET_KEY: process.env.TENCENT_SECRET_KEY,
    TENCENT_SUB_APP_ID: process.env.TENCENT_SUB_APP_ID,
    TENCENT_REGION: process.env.TENCENT_REGION || 'ap-guangzhou',
    OSS_ENDPOINT: process.env.OSS_ENDPOINT,
    OSS_BUCKET: process.env.OSS_BUCKET,
    OSS_ACCESS_KEY: process.env.OSS_ACCESS_KEY,
    OSS_ACCESS_SECRET: process.env.OSS_ACCESS_SECRET,
    OSS_DOMAIN: process.env.OSS_DOMAIN || '',
};

// ============================================================================
// VIDEO NORMALIZATION (H.264 + AAC + yuv420p for QQ / WeChat compatibility)
// ============================================================================

function runWorkerFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => code === 0 ? resolve(stderr) : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-500)}`)));
        proc.on('error', reject);
    });
}

function ffprobe(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffprobe', args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`ffprobe exit ${code}: ${stderr.slice(-300)}`)));
        proc.on('error', reject);
    });
}

async function needsNormalization(filePath) {
    try {
        const codec = await ffprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath]);
        const pixFmt = await ffprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', filePath]);
        const isH264 = codec.toLowerCase().includes('h264');
        const is420 = pixFmt.toLowerCase().includes('yuv420p');
        return !isH264 || !is420;
    } catch {
        return true;
    }
}

/**
 * Normalize a video buffer to H.264 + AAC + yuv420p + faststart MP4.
 * Returns the original buffer unchanged if already compatible.
 */
async function normalizeVideoBuffer(buffer) {
    const tmpDir = os.tmpdir();
    const id = `norm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const inputPath = path.join(tmpDir, `${id}_in.mp4`);
    const outputPath = path.join(tmpDir, `${id}_out.mp4`);

    try {
        fs.writeFileSync(inputPath, buffer);

        if (!(await needsNormalization(inputPath))) {
            console.log('[Worker] Video already H.264/yuv420p, skipping normalization');
            return buffer;
        }

        console.log('[Worker] Normalizing video to H.264/AAC/yuv420p for compatibility...');
        await runWorkerFFmpeg([
            '-y', '-i', inputPath,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            outputPath
        ]);

        const normalized = fs.readFileSync(outputPath);
        console.log(`[Worker] Normalized: ${buffer.length} → ${normalized.length} bytes`);
        return normalized;
    } catch (err) {
        console.warn('[Worker] Video normalization failed, using original:', err.message);
        return buffer;
    } finally {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
    }
}

// ============================================================================
// IMAGE GENERATION HANDLER
// ============================================================================

const TENCENT_IMAGE_MODELS = {
    'gem-2.5':             { name: 'GEM', version: '2.5', supportsRatio: true, supportsRes: true },
    'gem-3.0':             { name: 'GEM', version: '3.0', supportsRatio: true, supportsRes: true },
    'gem-3.1':             { name: 'GEM', version: '3.1', supportsRatio: true, supportsRes: true },
    'kling-img-2.1':       { name: 'Kling', version: '2.1', supportsRatio: true, supportsRes: true },
    'kling-img-3.0':       { name: 'Kling', version: '3.0', supportsRatio: true, supportsRes: true },
    'kling-img-3.0-omni':  { name: 'Kling', version: '3.0-Omni', supportsRatio: true, supportsRes: true },
    'vidu-q2':             { name: 'Vidu', version: 'q2', supportsRatio: true, supportsRes: true },
    'si-4.0':              { name: 'SI', version: '4.0', supportsRatio: false, supportsRes: true },
    'si-4.5':              { name: 'SI', version: '4.5', supportsRatio: false, supportsRes: true },
    'si-5.0-lite':         { name: 'SI', version: '5.0-lite', supportsRatio: false, supportsRes: true },
    'jimeng-4.0':          { name: 'Jimeng', version: '4.0', supportsRatio: false, supportsRes: false },
    'hunyuan-3.0':         { name: 'Hunyuan', version: '3.0', supportsRatio: false, supportsRes: false },
    'qwen-0925':           { name: 'Qwen', version: '0925', supportsRatio: false, supportsRes: false },
    'og-image2-low':       { name: 'OG', version: 'image2_low', supportsRatio: true, supportsRes: true },
    'og-image2-medium':    { name: 'OG', version: 'image2_medium', supportsRatio: true, supportsRes: true },
    'og-image2-high':      { name: 'OG', version: 'image2_high', supportsRatio: true, supportsRes: true },
};

async function handleImageTask(task) {
    const { userId, nodeId, payload } = task;
    const { prompt, aspectRatio, resolution, imageBase64: rawImageBase64, imageModel,
            klingReferenceMode, klingFaceIntensity, klingSubjectIntensity } = payload;

    const tencentModel = TENCENT_IMAGE_MODELS[imageModel];
    const isKlingDirectModel = imageModel && imageModel.startsWith('kling-v');
    const isChuhaibangModel = imageModel === 'chuhaibang';

    let imageBuffer;
    let imageFormat = 'png';

    if (isChuhaibangModel) {
        if (!ENV.CHB_API_KEY) throw new Error('ChuHaiBang API key not configured');

        const refImageUrls = [];
        if (rawImageBase64) {
            const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
            for (const raw of rawImages.slice(0, 3)) {
                if (!raw) continue;
                const resolved = await resolveLibraryPathToOss(raw, userId);
                if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
                    refImageUrls.push(resolved);
                } else if (resolved.startsWith('data:')) {
                    const match = resolved.match(/^data:image\/(\w+);base64,(.+)$/);
                    if (match) {
                        const buf = Buffer.from(match[2], 'base64');
                        const saved = await saveImage(buf, { userId: String(userId), ext: match[1], prompt: 'ref' });
                        refImageUrls.push(saved.ossUrl);
                    }
                }
            }
        }

        const chbImageUrl = await generateChuhaibangImage({
            prompt, apiKey: ENV.CHB_API_KEY, baseUrl: ENV.CHB_BASE_URL,
            imageUrls: refImageUrls.length > 0 ? refImageUrls : undefined, aspectRatio,
        });

        const resp = await fetch(chbImageUrl);
        if (!resp.ok) throw new Error(`Failed to download image from ChuHaiBang: ${resp.status}`);
        imageBuffer = Buffer.from(await resp.arrayBuffer());
        if (chbImageUrl.includes('.jpg') || chbImageUrl.includes('.jpeg')) imageFormat = 'jpg';

    } else if (tencentModel) {
        let inputImages = [];
        if (rawImageBase64) {
            const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
            const resolved = await Promise.all(rawImages.map(async (img) => {
                const r = await resolveLibraryPathToOss(img, userId);
                return resolveImageToBase64(r) || r;
            }));
            inputImages = resolved.filter(Boolean);
        }

        const imageUrl = await generateTencentImage({
            prompt, inputImages,
            modelName: tencentModel.name, modelVersion: tencentModel.version,
            aspectRatio: tencentModel.supportsRatio ? (aspectRatio || '16:9') : null,
            resolution: tencentModel.supportsRes ? (resolution || '1K') : null,
            secretId: ENV.TENCENT_SECRET_ID, secretKey: ENV.TENCENT_SECRET_KEY,
            subAppId: ENV.TENCENT_SUB_APP_ID, region: ENV.TENCENT_REGION,
            ossEndpoint: ENV.OSS_ENDPOINT, ossBucket: ENV.OSS_BUCKET,
            ossAccessKey: ENV.OSS_ACCESS_KEY, ossAccessSecret: ENV.OSS_ACCESS_SECRET,
            ossDomain: ENV.OSS_DOMAIN,
        });

        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`Failed to download image: ${resp.status}`);
        imageBuffer = Buffer.from(await resp.arrayBuffer());
        if (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg')) imageFormat = 'jpg';

    } else if (isKlingDirectModel) {
        if (!ENV.KLING_ACCESS_KEY || !ENV.KLING_SECRET_KEY) throw new Error('Kling API credentials not configured');

        let resolvedImages = null;
        if (rawImageBase64) {
            const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
            resolvedImages = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
        }

        let klingImageUrl;
        const isV2Model = imageModel === 'kling-v2' || imageModel === 'kling-v2-1' || imageModel === 'kling-v2-new';
        const hasReferenceImages = resolvedImages && resolvedImages.length > 0;

        if (hasReferenceImages && (isV2Model || resolvedImages.length > 1)) {
            klingImageUrl = await generateKlingMultiImage({
                prompt, subjectImages: resolvedImages, modelId: imageModel,
                aspectRatio, resolution,
                accessKey: ENV.KLING_ACCESS_KEY, secretKey: ENV.KLING_SECRET_KEY,
            });
        } else {
            klingImageUrl = await generateKlingImage({
                prompt, imageBase64: resolvedImages, modelId: imageModel,
                aspectRatio, resolution, klingReferenceMode, klingFaceIntensity, klingSubjectIntensity,
                accessKey: ENV.KLING_ACCESS_KEY, secretKey: ENV.KLING_SECRET_KEY,
            });
        }

        const resp = await fetch(klingImageUrl);
        if (!resp.ok) throw new Error('Failed to download image from Kling');
        imageBuffer = Buffer.from(await resp.arrayBuffer());
        if (klingImageUrl.includes('.jpg') || klingImageUrl.includes('.jpeg')) imageFormat = 'jpg';

    } else {
        throw new Error(`Unsupported image model: ${imageModel}`);
    }

    const saved = await saveImage(imageBuffer, {
        userId: String(userId), prompt,
        model: imageModel || 'chuhaibang', ext: imageFormat,
        nodeId: nodeId || undefined,
    });

    console.log(`[Worker] Image saved: ${saved.ossUrl} (model: ${imageModel})`);
    return saved.ossUrl;
}

// ============================================================================
// VIDEO GENERATION HANDLER
// ============================================================================

async function handleVideoTask(task) {
    const { userId, nodeId, payload } = task;
    const { prompt, imageBase64: rawImageBase64, lastFrameBase64: rawLastFrameBase64,
            frameImages: rawFrameImages, motionReferenceUrl: rawMotionReferenceUrl,
            referenceVideoUrls: rawReferenceVideoUrls,
            aspectRatio, resolution, duration, videoModel, generateAudio } = payload;

    const resolveInput = async (input) => {
        if (!input) return null;
        const resolved = await resolveLibraryPathToOss(input, userId);
        return resolveImageToBase64(resolved) || resolved;
    };

    const imageBase64 = await resolveInput(rawImageBase64);
    const lastFrameBase64 = await resolveInput(rawLastFrameBase64);
    const motionReferenceUrl = await resolveInput(rawMotionReferenceUrl);
    const frameImages = rawFrameImages
        ? (await Promise.all(rawFrameImages.map(img => resolveInput(img)))).filter(Boolean)
        : [];
    const referenceVideoUrls = Array.isArray(rawReferenceVideoUrls)
        ? rawReferenceVideoUrls.filter(u => u && typeof u === 'string')
        : [];

    const isKlingModel = videoModel && videoModel.startsWith('kling-');
    const isHailuoModel = videoModel && videoModel.startsWith('hailuo-');
    const isVolcengineModel = videoModel && videoModel.startsWith('Seedance/2.0');

    let videoBuffer;

    if (isKlingModel) {
        const isKling26 = videoModel === 'kling-v2-6';
        const isMotionControl = isKling26 && motionReferenceUrl;
        let resultVideoUrl;

        if (isKling26) {
            if (!ENV.FAL_API_KEY) throw new Error('FAL_API_KEY not configured for Kling 2.6');

            if (isMotionControl) {
                const { generateFalMotionControl } = await import('./services/fal.js');
                resultVideoUrl = await generateFalMotionControl({
                    prompt, characterImageBase64: imageBase64,
                    motionVideoBase64: motionReferenceUrl, characterOrientation: 'video',
                    apiKey: ENV.FAL_API_KEY,
                });
            } else {
                const { generateFalImageToVideo } = await import('./services/fal.js');
                resultVideoUrl = await generateFalImageToVideo({
                    prompt, imageBase64, duration: String(duration || 5),
                    generateAudio: generateAudio !== false, apiKey: ENV.FAL_API_KEY,
                });
            }
        } else {
            if (!ENV.KLING_ACCESS_KEY || !ENV.KLING_SECRET_KEY) throw new Error('Kling API credentials not configured');
            resultVideoUrl = await generateKlingVideo({
                prompt, imageBase64, lastFrameBase64, modelId: videoModel,
                aspectRatio, duration: duration || 5, motionReferenceUrl,
                accessKey: ENV.KLING_ACCESS_KEY, secretKey: ENV.KLING_SECRET_KEY,
            });
        }

        const resp = await fetch(resultVideoUrl);
        if (!resp.ok) throw new Error('Failed to download generated video');
        videoBuffer = Buffer.from(await resp.arrayBuffer());

    } else if (isHailuoModel) {
        if (!ENV.HAILUO_API_KEY) throw new Error('Hailuo API key not configured');
        const hailuoUrl = await generateHailuoVideo({
            prompt, imageBase64, lastFrameBase64, modelId: videoModel,
            aspectRatio, resolution, duration: duration || 6, apiKey: ENV.HAILUO_API_KEY,
        });
        const resp = await fetch(hailuoUrl);
        if (!resp.ok) throw new Error('Failed to download video from Hailuo');
        videoBuffer = Buffer.from(await resp.arrayBuffer());

    } else if (isVolcengineModel) {
        if (!ENV.ARK_API_KEY) throw new Error('ARK_API_KEY not configured');
        const volcFrameImages = frameImages.length > 0 ? frameImages : [imageBase64, lastFrameBase64].filter(Boolean);
        const volcUrl = await generateVolcengineVideo({
            prompt, frameImages: volcFrameImages,
            aspectRatio: aspectRatio || '16:9', resolution: resolution || '1080p',
            duration: duration || 5, generateAudio: generateAudio !== false,
            model: ENV.ARK_MODEL_ID, apiKey: ENV.ARK_API_KEY,
        });
        const resp = await fetch(volcUrl);
        if (!resp.ok) throw new Error('Failed to download video from Volcengine');
        videoBuffer = Buffer.from(await resp.arrayBuffer());

    } else {
        // Tencent VOD default
        if (!ENV.TENCENT_SECRET_ID || !ENV.TENCENT_SECRET_KEY || !ENV.TENCENT_SUB_APP_ID) {
            throw new Error('Tencent VOD configuration incomplete');
        }
        let modelName = 'Kling', modelVersion = '3.0';
        if (videoModel && videoModel.includes('/')) {
            [modelName, modelVersion] = videoModel.split('/');
        }
        const tencentFrameImages = frameImages.length > 0 ? frameImages :
            [(imageBase64 || rawImageBase64), (lastFrameBase64 || rawLastFrameBase64)].filter(Boolean);

        const videoUrl = await generateTencentVideo({
            prompt, frameImages: tencentFrameImages,
            referenceVideos: referenceVideoUrls.length > 0 ? referenceVideoUrls : undefined,
            duration: duration || 5, aspectRatio: aspectRatio || '16:9',
            resolution: resolution || '720P', generateAudio: generateAudio !== false,
            modelName, modelVersion,
            secretId: ENV.TENCENT_SECRET_ID, secretKey: ENV.TENCENT_SECRET_KEY,
            subAppId: ENV.TENCENT_SUB_APP_ID, region: ENV.TENCENT_REGION,
            ossEndpoint: ENV.OSS_ENDPOINT, ossBucket: ENV.OSS_BUCKET,
            ossAccessKey: ENV.OSS_ACCESS_KEY, ossAccessSecret: ENV.OSS_ACCESS_SECRET,
            ossDomain: ENV.OSS_DOMAIN,
        });

        const resp = await fetch(videoUrl);
        if (!resp.ok) throw new Error('Failed to download video from Tencent VOD');
        videoBuffer = Buffer.from(await resp.arrayBuffer());
    }

    videoBuffer = await normalizeVideoBuffer(videoBuffer);

    const saved = await saveVideo(videoBuffer, {
        userId: String(userId), prompt,
        model: videoModel || 'veo-3.1',
        aspectRatio: aspectRatio || 'Auto', resolution: resolution || 'Auto',
        duration: duration || null, nodeId: nodeId || undefined,
    });

    console.log(`[Worker] Video saved: ${saved.ossUrl} (model: ${videoModel})`);
    return saved.ossUrl;
}

// ============================================================================
// MESSAGE CONSUMER
// ============================================================================

async function processMessage(msg, channel) {
    if (!msg) return;

    let task;
    try {
        task = JSON.parse(msg.content.toString());
    } catch {
        console.error('[Worker] Invalid message payload, discarding');
        channel.ack(msg);
        return;
    }

    const { taskId, type, userId, nodeId, payload } = task;
    const preDeductedCost = payload.preDeductedCost || 0;
    const preDeductSource = payload.preDeductSource || 'redis';
    console.log(`[Worker] Processing ${type} task ${taskId} (user: ${userId}, node: ${nodeId || 'N/A'})`);

    // Idempotency: use a short-lived "processing" lease (5 min). If the worker
    // crashes mid-task the lease expires, allowing redelivery. On completion or
    // failure we extend to 24h to permanently block duplicate billing.
    const redis = getRedisClient();
    if (redis && taskId) {
        const wasSet = await redis.set(`processed:${taskId}`, 'processing', 'EX', 300, 'NX');
        if (!wasSet) {
            const existing = await redis.get(`processed:${taskId}`);
            if (existing === 'done' || existing === 'failed') {
                console.warn(`[Worker] Task ${taskId} already completed (duplicate), skipping`);
                channel.ack(msg);
                return;
            }
            // "processing" by another worker — skip to avoid double-processing
            console.warn(`[Worker] Task ${taskId} already being processed, skipping`);
            channel.ack(msg);
            return;
        }
    }

    try {
        await updateTaskStatus(taskId, { status: 'processing' });
    } catch (statusErr) {
        console.error(`[Worker] Failed to set processing status for ${taskId}:`, statusErr.message);
    }

    const model = type === 'image' ? (payload.imageModel || 'unknown') : (payload.videoModel || 'unknown');

    try {
        const handler = type === 'image' ? handleImageTask : handleVideoTask;
        const resultUrl = await handler(task);

        await updateTaskStatus(taskId, { status: 'completed', resultUrl });
        await logUsage({ userId, type, model, prompt: payload.prompt, cost: preDeductedCost, status: 'success', resultUrl, preDeducted: true, preDeductSource });

        // Mark permanently processed
        if (redis && taskId) await redis.set(`processed:${taskId}`, 'done', 'EX', 86400).catch(() => {});

        channel.ack(msg);
        console.log(`[Worker] ✓ ${type} task ${taskId} completed`);

    } catch (error) {
        console.error(`[Worker] ✗ ${type} task ${taskId} failed:`, error.message);
        await updateTaskStatus(taskId, { status: 'failed', error: error.message });
        await logUsage({ userId, type, model, prompt: payload.prompt, cost: preDeductedCost, status: 'failed', preDeducted: preDeductedCost > 0, preDeductSource });

        // Mark permanently failed — retrying the same task won't help
        if (redis && taskId) await redis.set(`processed:${taskId}`, 'failed', 'EX', 86400).catch(() => {});

        channel.ack(msg);
    } finally {
        await decrementUserConcurrency(userId);
    }
}

// ============================================================================
// STARTUP
// ============================================================================

function registerConsumers(channel) {
    channel.prefetch(IMAGE_CONCURRENCY + VIDEO_CONCURRENCY);
    channel.consume(QUEUES.IMAGE, (msg) => processMessage(msg, channel), { noAck: false });
    channel.consume(QUEUES.VIDEO, (msg) => processMessage(msg, channel), { noAck: false });
    console.log(`[Worker] Listening on queues (image: ${IMAGE_CONCURRENCY}, video: ${VIDEO_CONCURRENCY} concurrency)`);
}

/**
 * On startup, clear stale "processing" idempotency leases left by the previous
 * worker instance that died mid-task. This allows RabbitMQ redelivered messages
 * to be processed normally instead of being skipped.
 */
async function clearStaleProcessingLeases() {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        let cursor = '0';
        let cleared = 0;
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'processed:*', 'COUNT', 200);
            cursor = nextCursor;
            for (const key of keys) {
                const val = await redis.get(key);
                if (val === 'processing') {
                    await redis.del(key);
                    cleared++;
                }
            }
        } while (cursor !== '0');

        if (cleared > 0) {
            console.log(`[Worker] Cleared ${cleared} stale processing lease(s) from previous instance`);
        }
    } catch (err) {
        console.warn('[Worker] Failed to clear stale leases:', err.message);
    }
}

/**
 * Reset tasks stuck in "processing" status in the task queue back to "queued"
 * so the frontend sees them as pending rather than stuck.
 */
async function resetStuckTasks() {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        let cursor = '0';
        let reset = 0;
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'task:*', 'COUNT', 200);
            cursor = nextCursor;
            for (const key of keys) {
                const status = await redis.hget(key, 'status');
                if (status === 'processing') {
                    await redis.hset(key, 'status', 'queued', 'updatedAt', String(Date.now()));
                    reset++;
                }
            }
        } while (cursor !== '0');

        if (reset > 0) {
            console.log(`[Worker] Reset ${reset} stuck task(s) from "processing" → "queued"`);
        }
    } catch (err) {
        console.warn('[Worker] Failed to reset stuck tasks:', err.message);
    }
}

async function start() {
    console.log('[Worker] Starting generation worker...');

    await testConnection();
    await testRedisConnection();

    await clearStaleProcessingLeases();
    await resetStuckTasks();

    const channel = await connectRabbitMQ();
    if (!channel) {
        console.error('[Worker] Failed to connect to RabbitMQ. Exiting.');
        process.exit(1);
    }

    registerConsumers(channel);

    onReconnect((newChannel) => {
        console.log('[Worker] RabbitMQ reconnected, re-registering consumers...');
        registerConsumers(newChannel);
    });

    console.log('[Worker] Ready. Press Ctrl+C to stop.');
}

process.on('SIGINT', () => {
    console.log('[Worker] Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('[Worker] Shutting down...');
    process.exit(0);
});

start().catch(err => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
});
