/**
 * volcengine.js
 *
 * Volcengine Ark Content Generation API — Doubao Seedance 2.0 video generation.
 *
 * Async lifecycle: POST task → poll GET until succeeded/failed → return video URL.
 * API docs: https://www.volcengine.com/docs/82379/1543418
 */

import crypto from 'crypto';
import { uploadBuffer, buildObjectKey } from './oss-storage.js';

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

/**
 * Ensure a media input is a public URL.
 * If the input is base64 (raw or data-URI), upload it to OSS and return the URL.
 * If it is already an HTTP(S) URL, return as-is.
 */
async function ensureUrl(input, index = 0) {
    if (!input) return null;
    if (input.startsWith('http://') || input.startsWith('https://')) return input;

    let buffer;
    let ext = 'png';
    let contentType = 'image/png';

    if (input.startsWith('data:')) {
        const match = input.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) {
            const mime = match[1];
            const b64 = match[2];
            buffer = Buffer.from(b64, 'base64');
            if (mime.includes('jpeg') || mime.includes('jpg')) { ext = 'jpg'; contentType = 'image/jpeg'; }
            else if (mime.includes('webp')) { ext = 'webp'; contentType = 'image/webp'; }
            else if (mime.includes('png')) { ext = 'png'; contentType = 'image/png'; }
        }
    }

    if (!buffer) {
        buffer = Buffer.from(input, 'base64');
    }

    const filename = `volcengine-tmp-${Date.now()}-${index}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const objectKey = buildObjectKey('system', 'volcengine-tmp', filename);
    const url = await uploadBuffer(buffer, objectKey, contentType);
    console.log(`[Volcengine] Uploaded base64 → ${url} (${Math.round(buffer.length / 1024)} KB)`);
    return url;
}

/**
 * Build the `content` array for the Volcengine task request.
 * API constraint: first_frame/last_frame mode and reference_image mode are mutually exclusive.
 *   - 1 image  → "first_frame" (I2V)
 *   - 2 images → "first_frame" + "last_frame" (FL2V)
 *   - 3+ images → all "reference_image" (reference mode, no frame roles)
 */
async function buildContentArray(prompt, frameImages = []) {
    const content = [];

    if (prompt) {
        content.push({ type: 'text', text: prompt });
    }

    const resolvedImages = [];
    for (let i = 0; i < frameImages.length; i++) {
        const url = await ensureUrl(frameImages[i], i);
        if (url) resolvedImages.push(url);
    }

    for (let i = 0; i < resolvedImages.length; i++) {
        let role;
        if (resolvedImages.length === 1) {
            role = 'first_frame';
        } else if (resolvedImages.length === 2) {
            role = i === 0 ? 'first_frame' : 'last_frame';
        } else {
            role = 'reference_image';
        }
        content.push({ type: 'image_url', image_url: { url: resolvedImages[i] }, role });
    }

    return content;
}

/**
 * Map frontend aspect ratio to Volcengine `ratio` parameter.
 */
function mapRatio(aspectRatio) {
    const supported = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'];
    if (supported.includes(aspectRatio)) return aspectRatio;
    return '16:9';
}

/**
 * Map frontend resolution string to Volcengine `resolution` parameter.
 */
function mapResolution(resolution) {
    if (!resolution) return '1080p';
    const lower = resolution.toLowerCase();
    if (lower.includes('720')) return '720p';
    if (lower.includes('1080')) return '1080p';
    if (lower.includes('2k') || lower.includes('1440')) return '2k';
    if (lower.includes('480')) return '480p';
    return '1080p';
}

/**
 * Generate a video using the Volcengine Ark Content Generation API (Doubao Seedance 2.0).
 *
 * @returns {Promise<string>} The download URL of the generated video.
 */
export async function generateVolcengineVideo({
    prompt,
    frameImages = [],
    aspectRatio = '16:9',
    resolution = '1080p',
    duration = 5,
    generateAudio = true,
    model,
    apiKey,
}) {
    if (!apiKey) {
        console.error('[Volcengine] ARK_API_KEY not configured. Add ARK_API_KEY to .env');
        throw new Error('当前视频模型暂不可用，请稍后再试或选择其他模型。');
    }

    const content = await buildContentArray(prompt, frameImages);

    if (content.length === 0) {
        throw new Error('Volcengine video generation requires at least a text prompt or image.');
    }

    const body = {
        model,
        content,
        ratio: mapRatio(aspectRatio),
        duration: Number(duration) || 5,
        resolution: mapResolution(resolution),
        watermark: false,
        generate_audio: generateAudio !== false,
    };

    const mode = frameImages.length >= 2 ? 'FL2V (First+Last Frame)' :
        frameImages.length === 1 ? 'I2V (Image-to-Video)' : 'T2V (Text-to-Video)';

    console.log('=== Volcengine Seedance Video Generation ===');
    console.log('Model:', model);
    console.log('Mode:', mode);
    console.log('Prompt:', (prompt || '').substring(0, 100) + (prompt?.length > 100 ? '...' : ''));
    console.log('Duration:', body.duration, 'Resolution:', body.resolution, 'Ratio:', body.ratio, 'Audio:', body.generate_audio);
    console.log('Content items:', content.length, `(${content.map(c => c.type).join(', ')})`);

    // 1. Create task
    const createUrl = `${ARK_BASE_URL}/contents/generations/tasks`;
    const createRes = await fetch(createUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!createRes.ok) {
        const errText = await createRes.text().catch(() => '');
        let parsed;
        try { parsed = JSON.parse(errText); } catch { /* ignore */ }
        const code = parsed?.error?.code || '';

        if (code.includes('SensitiveContent') || code.includes('PolicyViolation')) {
            throw new Error('输入图片未通过内容审核（可能涉及版权），请更换图片后重试。');
        }
        if (code === 'InvalidParameter') {
            const detail = parsed?.error?.message || '';
            throw new Error(`请求参数有误：${detail}`);
        }

        throw new Error(`Volcengine task creation failed (${createRes.status}): ${errText}`);
    }

    const createData = await createRes.json();
    const taskId = createData.id;
    if (!taskId) {
        throw new Error(`Volcengine returned no task ID: ${JSON.stringify(createData)}`);
    }

    console.log(`[Volcengine] Task created: ${taskId}`);

    // 2. Poll for completion (exponential backoff: 10s → 60s cap, 20 min max)
    const maxWaitMs = 20 * 60 * 1000;
    const startTime = Date.now();
    let wait = 10_000;

    while (Date.now() - startTime < maxWaitMs) {
        await new Promise(r => setTimeout(r, wait));

        const pollUrl = `${ARK_BASE_URL}/contents/generations/tasks/${taskId}`;
        const pollRes = await fetch(pollUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        if (!pollRes.ok) {
            const errText = await pollRes.text().catch(() => '');
            console.error(`[Volcengine] Poll error (${pollRes.status}): ${errText}`);
            wait = Math.min(wait * 2, 60_000);
            continue;
        }

        const pollData = await pollRes.json();
        const status = pollData.status;

        if (status === 'succeeded') {
            const videoUrl = pollData.content?.video_url;
            if (!videoUrl) {
                throw new Error(`Volcengine task succeeded but no video_url found: ${JSON.stringify(pollData)}`);
            }
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`[Volcengine] Task ${taskId} succeeded in ${elapsed}s → ${videoUrl}`);
            return videoUrl;
        }

        if (status === 'failed' || status === 'expired' || status === 'cancelled') {
            const errorMsg = pollData.error?.message || pollData.error || status;
            throw new Error(`Volcengine task ${status}: ${errorMsg}`);
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const remaining = Math.round((maxWaitMs - (Date.now() - startTime)) / 1000);
        console.log(`[Volcengine] ${taskId} status=${status} (${elapsed}s elapsed, ${remaining}s remaining)`);

        wait = Math.min(wait * 1.5, 60_000);
    }

    throw new Error(`Volcengine video generation timed out after ${Math.round(maxWaitMs / 60_000)} minutes`);
}
