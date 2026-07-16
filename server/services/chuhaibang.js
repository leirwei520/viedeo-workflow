/**
 * chuhaibang.js
 *
 * ChuHaiBang async image generation API service.
 * Submits generation tasks and polls for results with automatic retry.
 */

const DEFAULT_BASE_URL = 'https://your-chb-endpoint.example.com/api';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120; // 6 minutes max
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Submit an async image generation task and poll until completion.
 * Retries the entire flow up to MAX_RETRIES times on failure.
 *
 * @param {Object} options
 * @param {string} options.prompt - Text prompt for image generation
 * @param {string} options.apiKey - Bearer token
 * @param {string} [options.baseUrl] - API base URL
 * @param {string|string[]} [options.imageUrls] - Reference image URL(s) for image-to-image (max 3)
 * @param {string} [options.aspectRatio] - Aspect ratio (1:1, 3:4, 9:16, 4:3, 16:9)
 * @returns {Promise<string>} The generated image URL
 */
export async function generateChuhaibangImage({ prompt, apiKey, baseUrl, imageUrls, aspectRatio }) {
    const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const resultUrl = await _submitAndPoll({ prompt, apiKey, base, imageUrls, aspectRatio });
            return resultUrl;
        } catch (err) {
            console.error(`[ChuHaiBang] Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * attempt;
                console.log(`[ChuHaiBang] Retrying in ${delay}ms...`);
                await sleep(delay);
            } else {
                throw new Error(`ChuHaiBang image generation failed after ${MAX_RETRIES} attempts: ${err.message}`);
            }
        }
    }
}

/**
 * Internal: submit task and poll for result
 */
async function _submitAndPoll({ prompt, apiKey, base, imageUrls, aspectRatio }) {
    const submitUrl = `${base}/v1/images/generations/async`;

    /* Upstream API now expects `image_urls` (plural array) for any reference image input. Single-image call uses a 1-element array; absent → text-to-image. `model` is no longer required in body (the path already encodes it). */
    const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : (imageUrls ? [imageUrls] : []);
    const body = { prompt };
    if (urls.length > 0) body.image_urls = urls;
    if (aspectRatio) body.aspect_ratio = aspectRatio;

    const submitResp = await fetch(submitUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!submitResp.ok) {
        const text = await submitResp.text().catch(() => '');
        throw new Error(`Submit failed (${submitResp.status}): ${text}`);
    }

    const submitData = await submitResp.json();
    const taskId = submitData.task_id;
    if (!taskId) {
        console.error('[ChuHaiBang] Submit response missing task_id:', JSON.stringify(submitData));
        throw new Error('No task_id in submit response');
    }

    const mode = urls.length > 0 ? `img2img(${urls.length})` : 'txt2img';
    console.log(`[ChuHaiBang] Task submitted: ${taskId} (${mode}, ratio: ${aspectRatio || 'default'}, prompt: "${prompt.slice(0, 60)}...")`);

    const pollUrl = `${base}/v1/images/tasks/${taskId}`;

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        await sleep(POLL_INTERVAL_MS);

        const pollResp = await fetch(pollUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        if (!pollResp.ok) {
            console.warn(`[ChuHaiBang] Poll request failed (${pollResp.status}), retrying...`);
            continue;
        }

        const pollData = await pollResp.json();

        if (pollData.status === 'completed') {
            /* Tolerate both legacy `image_url` and array form `image_urls[0]` to track upstream changes. */
            const resultUrl = pollData.image_url
                || (Array.isArray(pollData.image_urls) ? pollData.image_urls[0] : null);
            if (!resultUrl) throw new Error('Task completed but no image_url returned');
            console.log(`[ChuHaiBang] Task ${taskId} completed (poll #${i + 1})`);
            return resultUrl;
        }

        if (pollData.status === 'failed') {
            console.error(`[ChuHaiBang] Task ${taskId} FAILED — full response:`, JSON.stringify(pollData));
            const errMsg = pollData.error_msg || pollData.error || pollData.message || 'unknown error';
            throw new Error(`Task ${taskId} failed: ${errMsg}`);
        }
    }

    throw new Error(`Task ${taskId} timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
}
