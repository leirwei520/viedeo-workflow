/**
 * generation-direct.js
 *
 * Fallback direct execution when RabbitMQ is unavailable.
 * Extracted from the original generation.js inline handlers.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { generateKlingVideo, generateKlingImage, generateKlingMultiImage } from '../services/kling.js';
import { generateHailuoVideo } from '../services/hailuo.js';
import { generateVolcengineVideo } from '../services/volcengine.js';
import { generateTencentVideo, generateTencentImage } from '../services/tencent-vod.js';
import { generateChuhaibangImage } from '../services/chuhaibang.js';
import { resolveImageToBase64 } from '../utils/imageHelpers.js';
import { saveImage, saveVideo, resolveLibraryPathToOss } from '../services/storage.js';

function _runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-500)}`)));
        proc.on('error', reject);
    });
}

function _ffprobe(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffprobe', args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`ffprobe exit ${code}`)));
        proc.on('error', reject);
    });
}

async function normalizeVideoBuffer(buffer) {
    const tmpDir = os.tmpdir();
    const id = `norm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const inputPath = path.join(tmpDir, `${id}_in.mp4`);
    const outputPath = path.join(tmpDir, `${id}_out.mp4`);
    try {
        fs.writeFileSync(inputPath, buffer);
        let needsNorm = true;
        try {
            const codec = await _ffprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', inputPath]);
            const pixFmt = await _ffprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', inputPath]);
            needsNorm = !codec.toLowerCase().includes('h264') || !pixFmt.toLowerCase().includes('yuv420p');
        } catch {}
        if (!needsNorm) { console.log('[Direct] Video already H.264/yuv420p'); return buffer; }
        console.log('[Direct] Normalizing video to H.264/AAC/yuv420p...');
        await _runFFmpeg(['-y', '-i', inputPath, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath]);
        const normalized = fs.readFileSync(outputPath);
        console.log(`[Direct] Normalized: ${buffer.length} → ${normalized.length} bytes`);
        return normalized;
    } catch (err) {
        console.warn('[Direct] Video normalization failed, using original:', err.message);
        return buffer;
    } finally {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
    }
}

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

export async function directGenerateImage(req, preDeductedCost) {
    const userId = req.userId;
    const { nodeId, prompt, aspectRatio, resolution, imageBase64: rawImageBase64, imageModel,
            klingReferenceMode, klingFaceIntensity, klingSubjectIntensity } = req.body;
    const { KLING_ACCESS_KEY, KLING_SECRET_KEY } = req.app.locals;

    const tencentModel = TENCENT_IMAGE_MODELS[imageModel];
    const isKlingDirectModel = imageModel && imageModel.startsWith('kling-v');
    const isChuhaibangModel = imageModel === 'chuhaibang';

    let imageBuffer;
    let imageFormat = 'png';

    if (isChuhaibangModel) {
        const { CHB_API_KEY, CHB_BASE_URL } = req.app.locals;
        if (!CHB_API_KEY) throw new Error('ChuHaiBang API key not configured');

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
            prompt, apiKey: CHB_API_KEY, baseUrl: CHB_BASE_URL,
            imageUrls: refImageUrls.length > 0 ? refImageUrls : undefined, aspectRatio,
        });

        const resp = await fetch(chbImageUrl);
        if (!resp.ok) throw new Error(`Failed to download image from ChuHaiBang: ${resp.status}`);
        imageBuffer = Buffer.from(await resp.arrayBuffer());
        if (chbImageUrl.includes('.jpg') || chbImageUrl.includes('.jpeg')) imageFormat = 'jpg';

    } else if (tencentModel) {
        const { TENCENT_SECRET_ID, TENCENT_SECRET_KEY, TENCENT_SUB_APP_ID, TENCENT_REGION,
                OSS_ENDPOINT, OSS_BUCKET, OSS_ACCESS_KEY, OSS_ACCESS_SECRET, OSS_DOMAIN } = req.app.locals;

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
            prompt, inputImages, modelName: tencentModel.name, modelVersion: tencentModel.version,
            aspectRatio: tencentModel.supportsRatio ? (aspectRatio || '16:9') : null,
            resolution: tencentModel.supportsRes ? (resolution || '1K') : null,
            secretId: TENCENT_SECRET_ID, secretKey: TENCENT_SECRET_KEY,
            subAppId: TENCENT_SUB_APP_ID, region: TENCENT_REGION || 'ap-guangzhou',
            ossEndpoint: OSS_ENDPOINT, ossBucket: OSS_BUCKET,
            ossAccessKey: OSS_ACCESS_KEY, ossAccessSecret: OSS_ACCESS_SECRET, ossDomain: OSS_DOMAIN,
        });

        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`Failed to download image: ${resp.status}`);
        imageBuffer = Buffer.from(await resp.arrayBuffer());
        if (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg')) imageFormat = 'jpg';

    } else if (isKlingDirectModel) {
        if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) throw new Error('Kling API credentials not configured');

        let resolvedImages = null;
        if (rawImageBase64) {
            const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
            resolvedImages = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
        }

        const isV2Model = ['kling-v2', 'kling-v2-1', 'kling-v2-new'].includes(imageModel);
        const hasRef = resolvedImages && resolvedImages.length > 0;
        let klingImageUrl;

        if (hasRef && (isV2Model || resolvedImages.length > 1)) {
            klingImageUrl = await generateKlingMultiImage({
                prompt, subjectImages: resolvedImages, modelId: imageModel,
                aspectRatio, resolution, accessKey: KLING_ACCESS_KEY, secretKey: KLING_SECRET_KEY,
            });
        } else {
            klingImageUrl = await generateKlingImage({
                prompt, imageBase64: resolvedImages, modelId: imageModel,
                aspectRatio, resolution, klingReferenceMode, klingFaceIntensity, klingSubjectIntensity,
                accessKey: KLING_ACCESS_KEY, secretKey: KLING_SECRET_KEY,
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
        userId: String(userId), prompt, model: imageModel || 'chuhaibang',
        ext: imageFormat, nodeId: nodeId || undefined,
    });

    return saved.ossUrl;
}

export async function directGenerateVideo(req, preDeductedCost) {
    const userId = req.userId;
    const { nodeId, prompt, imageBase64: rawImageBase64, lastFrameBase64: rawLastFrameBase64,
            frameImages: rawFrameImages, motionReferenceUrl: rawMotionReferenceUrl,
            referenceVideoUrls: rawReferenceVideoUrls,
            aspectRatio, resolution, duration, videoModel } = req.body;
    const { KLING_ACCESS_KEY, KLING_SECRET_KEY, HAILUO_API_KEY } = req.app.locals;

    const resolveInput = async (input) => {
        if (!input) return null;
        const resolved = await resolveLibraryPathToOss(input, userId);
        return resolveImageToBase64(resolved) || resolved;
    };

    const imageBase64 = await resolveInput(rawImageBase64);
    const lastFrameBase64 = await resolveInput(rawLastFrameBase64);
    const motionReferenceUrl = await resolveInput(rawMotionReferenceUrl);
    const referenceVideoUrls = Array.isArray(rawReferenceVideoUrls)
        ? rawReferenceVideoUrls.filter(u => u && typeof u === 'string')
        : [];
    const frameImages = rawFrameImages
        ? (await Promise.all(rawFrameImages.map(img => resolveInput(img)))).filter(Boolean)
        : [];

    const isKlingModel = videoModel && videoModel.startsWith('kling-');
    const isHailuoModel = videoModel && videoModel.startsWith('hailuo-');
    const isVolcengineModel = videoModel && videoModel.startsWith('Seedance/2.0');

    let videoBuffer;

    if (isKlingModel) {
        const isKling26 = videoModel === 'kling-v2-6';
        let resultVideoUrl;

        if (isKling26) {
            const { FAL_API_KEY } = req.app.locals;
            if (!FAL_API_KEY) throw new Error('FAL_API_KEY not configured');

            if (isKling26 && motionReferenceUrl) {
                const { generateFalMotionControl } = await import('../services/fal.js');
                resultVideoUrl = await generateFalMotionControl({
                    prompt, characterImageBase64: imageBase64, motionVideoBase64: motionReferenceUrl,
                    characterOrientation: 'video', apiKey: FAL_API_KEY,
                });
            } else {
                const { generateFalImageToVideo } = await import('../services/fal.js');
                resultVideoUrl = await generateFalImageToVideo({
                    prompt, imageBase64, duration: String(duration || 5),
                    generateAudio: req.body.generateAudio !== false, apiKey: FAL_API_KEY,
                });
            }
        } else {
            if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) throw new Error('Kling API credentials not configured');
            resultVideoUrl = await generateKlingVideo({
                prompt, imageBase64, lastFrameBase64, modelId: videoModel,
                aspectRatio, duration: duration || 5, motionReferenceUrl,
                accessKey: KLING_ACCESS_KEY, secretKey: KLING_SECRET_KEY,
            });
        }

        const resp = await fetch(resultVideoUrl);
        if (!resp.ok) throw new Error('Failed to download generated video');
        videoBuffer = Buffer.from(await resp.arrayBuffer());

    } else if (isHailuoModel) {
        if (!HAILUO_API_KEY) throw new Error('Hailuo API key not configured');
        const url = await generateHailuoVideo({
            prompt, imageBase64, lastFrameBase64, modelId: videoModel,
            aspectRatio, resolution, duration: duration || 6, apiKey: HAILUO_API_KEY,
        });
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Failed to download video from Hailuo');
        videoBuffer = Buffer.from(await resp.arrayBuffer());

    } else if (isVolcengineModel) {
        const { ARK_API_KEY, ARK_MODEL_ID } = req.app.locals;
        if (!ARK_API_KEY) throw new Error('ARK_API_KEY not configured');
        const volcFrameImages = frameImages.length > 0 ? frameImages : [imageBase64, lastFrameBase64].filter(Boolean);
        const url = await generateVolcengineVideo({
            prompt, frameImages: volcFrameImages,
            aspectRatio: aspectRatio || '16:9', resolution: resolution || '1080p',
            duration: duration || 5, generateAudio: req.body.generateAudio !== false,
            model: ARK_MODEL_ID, apiKey: ARK_API_KEY,
        });
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Failed to download video from Volcengine');
        videoBuffer = Buffer.from(await resp.arrayBuffer());

    } else {
        const { TENCENT_SECRET_ID, TENCENT_SECRET_KEY, TENCENT_SUB_APP_ID, TENCENT_REGION,
                OSS_ENDPOINT, OSS_BUCKET, OSS_ACCESS_KEY, OSS_ACCESS_SECRET, OSS_DOMAIN } = req.app.locals;

        let modelName = 'Kling', modelVersion = '3.0';
        if (videoModel && videoModel.includes('/')) [modelName, modelVersion] = videoModel.split('/');

        const tencentFrameImages = frameImages.length > 0 ? frameImages :
            [(imageBase64 || rawImageBase64), (lastFrameBase64 || rawLastFrameBase64)].filter(Boolean);

        const url = await generateTencentVideo({
            prompt, frameImages: tencentFrameImages,
            referenceVideos: referenceVideoUrls.length > 0 ? referenceVideoUrls : undefined,
            duration: duration || 5,
            aspectRatio: aspectRatio || '16:9', resolution: resolution || '720P',
            generateAudio: req.body.generateAudio !== false, modelName, modelVersion,
            secretId: TENCENT_SECRET_ID, secretKey: TENCENT_SECRET_KEY,
            subAppId: TENCENT_SUB_APP_ID, region: TENCENT_REGION || 'ap-guangzhou',
            ossEndpoint: OSS_ENDPOINT, ossBucket: OSS_BUCKET,
            ossAccessKey: OSS_ACCESS_KEY, ossAccessSecret: OSS_ACCESS_SECRET, ossDomain: OSS_DOMAIN,
        });

        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Failed to download video from Tencent VOD');
        videoBuffer = Buffer.from(await resp.arrayBuffer());
    }

    videoBuffer = await normalizeVideoBuffer(videoBuffer);

    const saved = await saveVideo(videoBuffer, {
        userId: String(userId), prompt, model: videoModel || 'veo-3.1',
        aspectRatio: aspectRatio || 'Auto', resolution: resolution || 'Auto',
        duration: duration || null, nodeId: nodeId || undefined,
    });

    return saved.ossUrl;
}
