/**
 * tencent-vod.js
 * 
 * 腾讯云 VOD AIGC 图生视频服务
 * 使用 CreateAigcVideoTask API 生成视频
 */

import crypto from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

const VOD_ENDPOINT = 'vod.tencentcloudapi.com';
const VOD_SERVICE = 'vod';
const VOD_VERSION = '2018-07-17';

// ============================================================================
// SIGNATURE HELPERS (腾讯云 TC3-HMAC-SHA256 签名)
// ============================================================================

function sha256(message, secret = '', encoding = 'hex') {
    return crypto.createHmac('sha256', secret).update(message).digest(encoding);
}

function getHash(message, encoding = 'hex') {
    return crypto.createHash('sha256').update(message).digest(encoding);
}

function getDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toISOString().slice(0, 10);
}

function generateSignature(secretId, secretKey, timestamp, params, action, region) {
    const date = getDate(timestamp);
    const payload = JSON.stringify(params);
    
    // Step 1: Build canonical request
    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${VOD_ENDPOINT}\nx-tc-action:${action.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const hashedRequestPayload = getHash(payload);
    const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;
    
    // Step 2: Build string to sign
    const algorithm = 'TC3-HMAC-SHA256';
    const credentialScope = `${date}/${VOD_SERVICE}/tc3_request`;
    const hashedCanonicalRequest = getHash(canonicalRequest);
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;
    
    // Step 3: Calculate signature
    const secretDate = sha256(date, `TC3${secretKey}`, 'buffer');
    const secretService = sha256(VOD_SERVICE, secretDate, 'buffer');
    const secretSigning = sha256('tc3_request', secretService, 'buffer');
    const signature = sha256(stringToSign, secretSigning, 'hex');
    
    // Step 4: Build authorization header
    const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    
    return authorization;
}

// ============================================================================
// API CALL HELPER
// ============================================================================

async function callVodApi(action, params, secretId, secretKey, region) {
    const timestamp = Math.floor(Date.now() / 1000);
    const authorization = generateSignature(secretId, secretKey, timestamp, params, action, region);
    
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Host': VOD_ENDPOINT,
        'X-TC-Action': action,
        'X-TC-Version': VOD_VERSION,
        'X-TC-Timestamp': timestamp.toString(),
        'X-TC-Region': region,
        'Authorization': authorization
    };
    
    const response = await fetch(`https://${VOD_ENDPOINT}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params)
    });
    
    const result = await response.json();
    
    if (result.Response && result.Response.Error) {
        throw new Error(`腾讯云 API 错误: ${result.Response.Error.Code} - ${result.Response.Error.Message}`);
    }
    
    return result.Response || result;
}

// ============================================================================
// IMAGE UPLOAD TO OSS (阿里云 OSS)
// ============================================================================

async function uploadToOss(base64Data, fileName, ossConfig) {
    const { endpoint, bucket, accessKey, accessSecret, domain } = ossConfig;
    
    console.log(`[OSS Upload] Starting upload, data length: ${base64Data.length}`);
    
    // Parse base64
    let imageBuffer;
    let contentType = 'image/png';
    let ext = 'png';
    
    try {
        if (base64Data.startsWith('data:')) {
            // Parse data URL header manually to avoid regex issues with large strings
            const commaIndex = base64Data.indexOf(',');
            if (commaIndex > 0) {
                const header = base64Data.substring(0, commaIndex);
                const base64Content = base64Data.substring(commaIndex + 1);
                
                if (header.includes('image/jpeg') || header.includes('image/jpg')) {
                    contentType = 'image/jpeg';
                    ext = 'jpg';
                } else if (header.includes('image/png')) {
                    contentType = 'image/png';
                    ext = 'png';
                } else if (header.includes('image/webp')) {
                    contentType = 'image/webp';
                    ext = 'webp';
                }
                
                imageBuffer = Buffer.from(base64Content, 'base64');
            }
        } else {
            imageBuffer = Buffer.from(base64Data, 'base64');
            if (base64Data.startsWith('/9j/')) {
                contentType = 'image/jpeg';
                ext = 'jpg';
            }
        }
    } catch (parseError) {
        console.error('[OSS Upload] Base64 parse error:', parseError.message);
        throw new Error(`Base64 解析失败: ${parseError.message}`);
    }
    
    if (!imageBuffer || imageBuffer.length === 0) {
        throw new Error('无法解析图片数据');
    }
    
    console.log(`[OSS Upload] Parsed image: ${imageBuffer.length} bytes, type: ${contentType}`);
    
    // Compress large images (> 500KB) to improve upload reliability
    const MAX_SIZE = 500 * 1024; // 500KB
    if (imageBuffer.length > MAX_SIZE) {
        try {
            const sharp = (await import('sharp')).default;
            const originalSize = imageBuffer.length;
            
            // Convert to JPEG with quality reduction for better compression
            imageBuffer = await sharp(imageBuffer)
                .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
            
            contentType = 'image/jpeg';
            ext = 'jpg';
            
            console.log(`[OSS Upload] Compressed image: ${originalSize} -> ${imageBuffer.length} bytes (${Math.round(imageBuffer.length / originalSize * 100)}%)`);
        } catch (compressError) {
            console.warn(`[OSS Upload] Compression failed (will use original): ${compressError.message}`);
            // Continue with original image if compression fails
        }
    }
    
    // Generate object key
    const date = new Date();
    const datePath = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    const objectKey = `video-gen/${datePath}/${fileName}.${ext}`;
    
    // Upload to OSS with retry
    const ossUrl = `https://${bucket}.${endpoint}/${objectKey}`;
    console.log(`[OSS Upload] Uploading to: ${ossUrl}`);
    
    let uploadResponse;
    let lastError;
    
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Generate fresh signature for each attempt
            const currentDate = new Date();
            const currentDateStr = currentDate.toUTCString();
            const stringToSign = `PUT\n\n${contentType}\n${currentDateStr}\n/${bucket}/${objectKey}`;
            const signature = crypto.createHmac('sha1', accessSecret).update(stringToSign).digest('base64');

            const controller = new AbortController();
            // Longer timeout for large files (3 min)
            const timeoutMs = Math.max(180000, imageBuffer.length / 1000); // At least 180s or 1ms per byte
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            console.log(`[OSS Upload] Attempt ${attempt}/${maxRetries}: uploading ${imageBuffer.length} bytes, timeout: ${timeoutMs}ms`);

            uploadResponse = await fetch(ossUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': contentType,
                    'Date': currentDateStr,
                    'Authorization': `OSS ${accessKey}:${signature}`,
                    'Content-Length': imageBuffer.length.toString()
                },
                body: imageBuffer,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (uploadResponse.ok) {
                console.log(`[OSS Upload] Attempt ${attempt}: SUCCESS`);
                break;
            } else {
                const errorText = await uploadResponse.text();
                lastError = new Error(`OSS 上传失败: ${uploadResponse.status} - ${errorText}`);
                console.error(`[OSS Upload] Attempt ${attempt} failed:`, lastError.message);
            }
        } catch (fetchError) {
            lastError = fetchError;
            // More detailed error logging
            const errorDetail = fetchError.cause ? ` (cause: ${fetchError.cause.code || fetchError.cause.message})` : '';
            console.error(`[OSS Upload] Attempt ${attempt} error: ${fetchError.message}${errorDetail}`);
            if (attempt < maxRetries) {
                const retryDelay = attempt * 5000; // Exponential backoff: 5s, 10s, 15s, 20s
                console.log(`[OSS Upload] Retrying in ${retryDelay / 1000} seconds...`);
                await new Promise(r => setTimeout(r, retryDelay));
            }
        }
    }
    
    if (!uploadResponse || !uploadResponse.ok) {
        throw lastError || new Error('OSS 上传失败');
    }
    
    // Return public URL
    const publicUrl = domain 
        ? `https://${domain}/${objectKey}`
        : ossUrl;
    
    console.log(`[Tencent VOD] 图片已上传至 OSS: ${publicUrl}`);
    return publicUrl;
}

// ============================================================================
// RESOLVE IMAGE URL
// ============================================================================

async function resolveImageUrl(imageInput, requestId, prefix, ossConfig) {
    if (!imageInput || !imageInput.trim()) {
        return { url: null, error: '图片内容为空' };
    }
    
    let raw = imageInput.trim();

    const inputType = raw.startsWith('data:') ? 'base64' : raw.startsWith('http') ? 'URL' : raw.startsWith('/library/') ? 'local-path' : 'other';
    console.log(`[resolveImageUrl] Input type: ${inputType}, length: ${raw.length}`);

    // Any HTTP/HTTPS URL → return as-is (OSS URLs, CDN URLs, etc.)
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        const cleanUrl = raw.split('?')[0];
        console.log(`[resolveImageUrl] Using URL directly: ${cleanUrl.substring(0, 80)}...`);
        return { url: raw, error: null };
    }

    // Handle local /library/ paths — try local file, then DB lookup for OSS URL
    if (raw.startsWith('/library/') || raw.includes('/library/')) {
        try {
            const { resolveLibraryPathToOss } = await import('./storage.js');
            const resolved = await resolveLibraryPathToOss(raw);
            if (resolved && resolved !== raw) {
                console.log(`[resolveImageUrl] Resolved /library/ path → ${resolved.substring(0, 80)}`);
                if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
                    return { url: resolved, error: null };
                }
                raw = resolved;
            } else {
                // Fallback: try reading from local disk directly
                const fs = await import('fs');
                const path = await import('path');
                const pathWithoutQuery = raw.split('?')[0];
                const libraryDir = process.env.LIBRARY_DIR || path.default.join(process.cwd(), 'library');
                const relativePath = pathWithoutQuery.replace('/library/', '');
                const absolutePath = path.default.join(libraryDir, relativePath);

                if (fs.default.existsSync(absolutePath)) {
                    const fileBuffer = fs.default.readFileSync(absolutePath);
                    const ext = path.default.extname(absolutePath).toLowerCase();
                    const mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'image/png';
                    raw = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
                    console.log(`[resolveImageUrl] Converted local file to base64: ${fileBuffer.length} bytes`);
                } else {
                    const filename = path.default.basename(pathWithoutQuery);
                    return { url: null, error: `图片文件不存在且无法从 OSS 恢复: ${filename}` };
                }
            }
        } catch (e) {
            console.error('[resolveImageUrl] Error resolving /library/ path:', e);
            return { url: null, error: `读取图片失败: ${e.message}` };
        }
    }
    
    // Validate base64 data - minimum size check
    if (raw.startsWith('data:')) {
        const commaIndex = raw.indexOf(',');
        if (commaIndex > 0) {
            const base64Part = raw.substring(commaIndex + 1);
            // A valid image should be at least a few KB
            if (base64Part.length < 100) {
                return { url: null, error: `图片数据太小 (${base64Part.length} bytes)，可能是无效的图片` };
            }
        }
    } else {
        // Raw base64 without data URL prefix
        if (raw.length < 100) {
            return { url: null, error: `图片数据太小 (${raw.length} bytes)，可能是无效的图片` };
        }
    }
    
    // Upload base64 to OSS
    try {
        const fileName = `${prefix}_${requestId}_${Date.now()}`;
        const url = await uploadToOss(raw, fileName, ossConfig);
        return { url, error: null };
    } catch (error) {
        return { url: null, error: error.message };
    }
}

// ============================================================================
// IMAGE GENERATION (CreateAigcImageTask)
// ============================================================================

/**
 * 提交腾讯云 VOD 图片生成任务
 * GEM 模型：2.5 (nano banana), 3.0 (nano banana pro), 3.1 (nano2)
 */
export async function submitImageTask({
    prompt,
    fileInfos = [],
    modelName = 'GEM',
    modelVersion = '3.0',
    resolution = '1080P',
    aspectRatio = '16:9',
    secretId,
    secretKey,
    subAppId,
    region = 'ap-guangzhou'
}) {
    const params = {
        SubAppId: parseInt(subAppId),
        ModelName: modelName,
        ModelVersion: modelVersion,
        Prompt: prompt || '根据图片生成',
        OutputConfig: {
            StorageMode: 'Temporary',
        }
    };

    if (resolution) {
        params.OutputConfig.Resolution = resolution;
    }

    if (aspectRatio && aspectRatio !== 'Auto') {
        params.OutputConfig.AspectRatio = aspectRatio;
    }

    if (fileInfos.length > 0) {
        params.FileInfos = fileInfos;
    }

    console.log('[Tencent Image] CreateAigcImageTask 参数:', JSON.stringify(params, null, 2));

    const result = await callVodApi('CreateAigcImageTask', params, secretId, secretKey, region);

    const taskId = result.TaskId;
    if (!taskId) {
        throw new Error(`腾讯云未返回 TaskId: ${JSON.stringify(result)}`);
    }

    console.log(`[Tencent Image] 任务已提交: TaskId=${taskId}`);
    return { success: true, taskId };
}

/**
 * 完整的图片生成流程（提交 + 轮询）
 */
export async function generateTencentImage({
    prompt,
    inputImages = [],
    modelName = 'GEM',
    modelVersion = '3.0',
    aspectRatio = '16:9',
    resolution = '1080P',
    secretId,
    secretKey,
    subAppId,
    region = 'ap-guangzhou',
    ossEndpoint,
    ossBucket,
    ossAccessKey,
    ossAccessSecret,
    ossDomain
}) {
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const ossConfig = {
        endpoint: ossEndpoint,
        bucket: ossBucket,
        accessKey: ossAccessKey,
        accessSecret: ossAccessSecret,
        domain: ossDomain
    };

    // Upload input images to OSS (GEM supports up to 3 reference images)
    const fileInfos = [];
    if (inputImages.length > 0) {
        const maxImages = 3;
        const toUpload = inputImages.slice(0, maxImages);
        console.log(`[Tencent Image] 上传 ${toUpload.length} 张参考图到 OSS...`);

        for (let i = 0; i < toUpload.length; i++) {
            const result = await resolveImageUrl(toUpload[i], requestId, `img_ref_${i}`, ossConfig);
            if (result.url) {
                fileInfos.push({ Type: 'Url', Url: result.url });
            } else {
                console.warn(`[Tencent Image] 参考图 ${i + 1} 上传失败: ${result.error}`);
            }
        }
    }

    // Map resolution (null means model doesn't support Resolution param)
    const resMap = { 'Auto': '1080P', '1K': '1080P', '2K': '2048P', '3K': '2048P', '4K': '2048P', '512': '512' };
    const mappedResolution = resolution ? (resMap[resolution] || resolution) : null;

    // Map aspect ratio (null means model doesn't support AspectRatio param)
    const mappedRatio = aspectRatio ? (aspectRatio === 'Auto' ? null : aspectRatio) : null;

    const submitResult = await submitImageTask({
        prompt,
        fileInfos,
        modelName,
        modelVersion,
        resolution: mappedResolution,
        aspectRatio: mappedRatio,
        secretId,
        secretKey,
        subAppId,
        region
    });

    const taskId = submitResult.taskId;

    // Poll for completion (max 5 minutes for images)
    const maxWaitMs = 300000;
    const pollInterval = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        await new Promise(r => setTimeout(r, pollInterval));

        const params = {
            TaskId: taskId,
            SubAppId: parseInt(subAppId)
        };
        const result = await callVodApi('DescribeTaskDetail', params, secretId, secretKey, region);

        const imageTask = result.AigcImageTask;
        const status = imageTask?.Status || result.Status || '';

        console.log(`[Tencent Image] 查询任务 ${taskId}: status=${status}, progress=${imageTask?.Progress || ''}`);

        if (status === 'FINISH') {
            const fileInfosOut = imageTask?.Output?.FileInfos || [];
            const imageUrl = fileInfosOut[0]?.FileUrl;
            if (imageUrl) {
                console.log(`[Tencent Image] 图片生成完成: ${imageUrl}`);
                return imageUrl;
            }
            throw new Error('腾讯云图片生成完成但未返回图片URL');
        }

        if (status === 'FAIL') {
            const errMsg = imageTask?.Message || '未知错误';
            throw new Error(`腾讯云图片生成失败: ${errMsg}`);
        }
    }

    throw new Error('腾讯云图片生成超时');
}

// ============================================================================
// VIDEO GENERATION
// ============================================================================

/**
 * 提交腾讯云 VOD 视频生成任务
 * 
 * 三种输入模式：
 * 1. 首尾帧模式（mode='first-last'）：FileInfos放首帧，LastFrameUrl放尾帧
 * 2. 多图参考模式（mode='reference'）：FileInfos放多张参考图，Usage='Reference'
 * 3. 支持参考视频：referenceVideoUrls 会添加到 FileInfos 中
 * 
 * 支持参考视频的模型：
 * - 可灵3.0-Omni: 有参考视频时，图片+主体不超过4
 * - Vidu Q2/Q2-pro: 最多4张图片+2个视频
 * - Vidu Q3: 最多5张图片+2个视频
 * - Sora 2.0: 有参考视频时最多4张图
 */
export async function submitVideoTask({
    prompt,
    firstFrameUrl,           // 首帧图片URL（首尾帧模式）
    lastFrameUrl,            // 尾帧图片URL（首尾帧模式，可选）
    referenceUrls = [],      // 参考图片URLs（多图参考模式）
    referenceVideoUrls = [], // 参考视频URLs（支持的模型可用）
    imageMode = 'first-last', // 'first-last' | 'reference'
    duration = 5,
    ratio = '16:9',
    resolution = '720P',
    generateAudio = true,
    modelName = 'Kling',
    modelVersion = '3.0',
    secretId,
    secretKey,
    subAppId,
    region = 'ap-guangzhou'
}) {
    const resolutionVal = resolution.toUpperCase().endsWith('P') ? resolution : `${resolution}P`;
    const audioGen = generateAudio ? 'Enabled' : 'Disabled';
    
    const params = {
        SubAppId: parseInt(subAppId),
        ModelName: modelName,
        ModelVersion: modelVersion,
        Prompt: prompt || '根据图片生成视频',
        EnhancePrompt: 'Enabled',
        OutputConfig: {
            StorageMode: 'Temporary',
            Resolution: resolutionVal,
            Duration: duration,
            AudioGeneration: audioGen
        }
    };
    
    // Add aspect ratio if specified
    if (ratio && ratio !== 'Auto' && ratio !== 'adaptive') {
        params.OutputConfig.AspectRatio = ratio;
    }
    
    // 初始化 FileInfos 数组
    params.FileInfos = [];
    
    // 根据模式设置图片参数
    if (imageMode === 'reference' && referenceUrls.length > 0) {
        // 多图参考模式：所有图片作为参考，Usage='Reference'
        params.FileInfos = referenceUrls.map(url => ({
            Type: 'Url',
            Url: url,
            Usage: 'Reference'
        }));
        console.log(`[Tencent VOD] 多图参考模式: ${referenceUrls.length} 张参考图`);
    } else {
        // 首尾帧模式（默认）
        if (firstFrameUrl) {
            // 首帧：FileInfos 只放一张图片，Usage='FirstFrame'
            params.FileInfos.push({ Type: 'Url', Url: firstFrameUrl, Usage: 'FirstFrame' });
        }
        
        // 尾帧：使用 LastFrameUrl 参数
        if (lastFrameUrl) {
            params.LastFrameUrl = lastFrameUrl;
        }
        console.log(`[Tencent VOD] 首尾帧模式: 首帧=${!!firstFrameUrl}, 尾帧=${!!lastFrameUrl}`);
    }
    
    // 添加参考视频（支持的模型：可灵3.0-Omni, Vidu Q2/Q2-pro/Q3, Sora 2.0）
    if (referenceVideoUrls.length > 0) {
        for (const videoUrl of referenceVideoUrls) {
            params.FileInfos.push({
                Type: 'Url',
                Url: videoUrl,
                Usage: 'Reference'
            });
        }
        console.log(`[Tencent VOD] 参考视频: ${referenceVideoUrls.length} 个`);
    }
    
    // 如果没有任何输入，删除空的 FileInfos
    if (params.FileInfos.length === 0) {
        delete params.FileInfos;
    }
    
    console.log('[Tencent VOD] CreateAigcVideoTask 参数:', JSON.stringify(params, null, 2));
    
    const result = await callVodApi('CreateAigcVideoTask', params, secretId, secretKey, region);
    
    const taskId = result.TaskId;
    if (!taskId) {
        throw new Error(`腾讯云未返回 TaskId: ${JSON.stringify(result)}`);
    }
    
    console.log(`[Tencent VOD] 任务已提交: TaskId=${taskId}`);
    return { success: true, taskId };
}

/**
 * 查询腾讯云 VOD 任务状态
 */
export async function queryTaskStatus({
    taskId,
    secretId,
    secretKey,
    subAppId,
    region = 'ap-guangzhou'
}) {
    const params = {
        TaskId: taskId,
        SubAppId: parseInt(subAppId)
    };
    
    const result = await callVodApi('DescribeTaskDetail', params, secretId, secretKey, region);
    
    const taskResult = result.AigcVideoTask || result.AigcImageTask;
    const taskStatus = taskResult?.Status || result.Status || '';

    console.log(`[Tencent VOD] 查询任务 TaskId=${taskId}: status=${taskStatus}`);

    // Task completed
    if (taskStatus === 'FINISH') {
        const errCode = taskResult?.ErrCode;
        const taskMessage = taskResult?.Message || result.Message || '';

        // ErrCode !== 0 means the task failed internally despite FINISH status
        // (e.g. content moderation: ErrCode=70000, Message="Failure to pass the risk control system")
        if (errCode && errCode !== 0) {
            const lowerMsg = taskMessage.toLowerCase();
            let friendlyError;
            if (lowerMsg.includes('risk control') || lowerMsg.includes('content moderation') || lowerMsg.includes('审核')) {
                friendlyError = '输入图片未通过内容审核（可能涉及版权），请更换图片后重试。';
            } else {
                friendlyError = `视频生成失败 (${errCode}): ${taskMessage || '未知错误'}`;
            }
            console.error(`[Tencent VOD] ${friendlyError}`);
            return { status: 'failed', error: friendlyError };
        }

        const output = taskResult?.Output || {};
        const fileInfos = output.FileInfos || [];
        
        let videoUrl = null;
        if (fileInfos.length > 0 && fileInfos[0].FileUrl) {
            videoUrl = fileInfos[0].FileUrl;
        } else if (output.VideoUrl) {
            videoUrl = output.VideoUrl;
        } else if (output.Url) {
            videoUrl = output.Url;
        } else if (taskResult?.VideoUrl) {
            videoUrl = taskResult.VideoUrl;
        } else if (taskResult?.FileUrl) {
            videoUrl = taskResult.FileUrl;
        }
        
        if (videoUrl) {
            console.log(`[Tencent VOD] 视频生成完成: ${videoUrl}`);
            return { status: 'completed', videoUrl };
        }

        console.error(`[Tencent VOD] 任务完成但未找到视频URL，返回结构: ${JSON.stringify({ Output: output, FileInfos: fileInfos, Message: taskMessage })}`);
        return { status: 'failed', error: taskMessage || '任务完成但未返回视频URL' };
    }
    
    // Task failed
    if (taskStatus === 'FAIL') {
        const errMsg = taskResult?.Message || result.Message || '未知错误';
        console.error(`[Tencent VOD] 视频生成失败: ${errMsg}`);
        return { status: 'failed', error: errMsg };
    }
    
    // Task processing
    const progress = taskResult?.Progress || '';
    return { status: 'processing', progress };
}

/**
 * 完整的视频生成流程（提交 + 轮询）
 * 
 * 自动判断图片模式：
 * - 首尾帧模式：2张图片，用于生成从A到B的过渡视频
 * - 多图参考模式：3+张图片，用于参考多个主体/风格生成视频
 * - 单图模式：1张图片，作为首帧参考
 * 
 * 支持参考视频（部分模型）：
 * - 可灵3.0-Omni: 有参考视频时图片不超过4
 * - Vidu Q2/Q2-pro: 最多4张图片+2个视频
 * - Vidu Q3: 最多5张图片+2个视频
 * - Sora 2.0: 有参考视频时最多4张图
 */
export async function generateTencentVideo({
    prompt,
    frameImages = [],       // Array of all frame images (base64 or URLs)
    referenceVideos = [],   // Array of reference video URLs (for supported models)
    imageMode,              // 'first-last' | 'reference' | undefined (auto-detect)
    duration = 5,
    aspectRatio = '16:9',
    resolution = '720P',
    generateAudio = true,
    modelName = 'Kling',
    modelVersion = '3.0',
    // Tencent config
    secretId,
    secretKey,
    subAppId,
    region = 'ap-guangzhou',
    // OSS config
    ossEndpoint,
    ossBucket,
    ossAccessKey,
    ossAccessSecret,
    ossDomain
}) {
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    
    const ossConfig = {
        endpoint: ossEndpoint,
        bucket: ossBucket,
        accessKey: ossAccessKey,
        accessSecret: ossAccessSecret,
        domain: ossDomain
    };
    
    // 自动检测图片模式
    // - 可灵1.6、O1、3.0-Omni等支持多图参考（>2张时用Reference模式）
    // - 可灵3.0（最多2张）、Vidu、Hailuo等用首尾帧模式
    const supportsMultiReference = ['1.6', 'O1', '3.0-Omni'].includes(modelVersion) || 
        (modelName === 'Kling' && frameImages.length > 2);
    
    const detectedMode = imageMode || (
        frameImages.length > 2 && supportsMultiReference ? 'reference' : 'first-last'
    );
    
    console.log(`[Tencent VOD] 图片模式: ${detectedMode}, 图片数量: ${frameImages.length}, 模型: ${modelName}/${modelVersion}`);
    frameImages.forEach((img, i) => console.log(`[Tencent VOD] frameImage[${i}]: ${(img || '').substring(0, 100)}`));
    
    let firstFrameUrl = null;
    let lastFrameUrl = null;
    let referenceUrls = [];
    
    if (detectedMode === 'reference') {
        // 多图参考模式：并行上传所有图片
        console.log(`[Tencent VOD] 多图参考模式: 上传 ${frameImages.length} 张参考图...`);
        
        const uploadPromises = frameImages.map((img, i) => 
            resolveImageUrl(img, requestId, `ref_${i + 1}`, ossConfig)
                .then(result => ({ ...result, index: i }))
                .catch(err => ({ url: null, error: err.message, index: i }))
        );
        
        const uploadResults = await Promise.all(uploadPromises);
        
        // 收集成功上传的URL，保持顺序
        const successfulUploads = uploadResults
            .filter(r => r.url && !r.error)
            .sort((a, b) => a.index - b.index);
        
        referenceUrls = successfulUploads.map(r => r.url);
        
        if (referenceUrls.length === 0) {
            const failReasons = uploadResults.map(r => `ref_${r.index + 1}: ${r.error || 'unknown'}`).join('; ');
            console.error(`[Tencent VOD] 所有参考图片失败: ${failReasons}`);
            throw new Error(`所有参考图片上传失败: ${failReasons}`);
        }
        
        console.log(`[Tencent VOD] 成功上传 ${referenceUrls.length}/${frameImages.length} 张参考图`);
    } else {
        // 首尾帧模式：只使用第一张和最后一张图片
        const firstFrameInput = frameImages[0];
        const lastFrameInput = frameImages.length > 1 ? frameImages[frameImages.length - 1] : null;
        
        console.log(`[Tencent VOD] 首尾帧模式: 共 ${frameImages.length} 张图片，使用第1张作为首帧${lastFrameInput ? '，最后1张作为尾帧' : ''}`);
        
        // 并行上传首帧和尾帧
        const uploadPromises = [];
        
        if (firstFrameInput) {
            uploadPromises.push(
                resolveImageUrl(firstFrameInput, requestId, 'first_frame', ossConfig)
                    .then(result => ({ ...result, type: 'first' }))
                    .catch(err => ({ url: null, error: err.message, type: 'first' }))
            );
        }
        
        if (lastFrameInput) {
            uploadPromises.push(
                resolveImageUrl(lastFrameInput, requestId, 'last_frame', ossConfig)
                    .then(result => ({ ...result, type: 'last' }))
                    .catch(err => ({ url: null, error: err.message, type: 'last' }))
            );
        }
        
        const uploadResults = await Promise.all(uploadPromises);
        
        for (const result of uploadResults) {
            if (result.error) {
                console.warn(`[Tencent VOD] 上传${result.type === 'first' ? '首' : '尾'}帧失败: ${result.error}`);
            } else if (result.url) {
                if (result.type === 'first') {
                    firstFrameUrl = result.url;
                } else {
                    lastFrameUrl = result.url;
                }
            }
        }
        
        if (!firstFrameUrl) {
            throw new Error('首帧图片上传失败');
        }
        
        console.log(`[Tencent VOD] 首帧: ${firstFrameUrl}`);
        if (lastFrameUrl) {
            console.log(`[Tencent VOD] 尾帧: ${lastFrameUrl}`);
        }
    }
    
    // 处理参考视频（如果有）
    // 参考视频已经是URL，不需要上传到OSS
    const referenceVideoUrls = referenceVideos.filter(url => url && typeof url === 'string');
    if (referenceVideoUrls.length > 0) {
        console.log(`[Tencent VOD] 参考视频: ${referenceVideoUrls.length} 个`);
    }
    
    // Submit task
    const submitResult = await submitVideoTask({
        prompt,
        firstFrameUrl,
        lastFrameUrl,
        referenceUrls,
        referenceVideoUrls,
        imageMode: detectedMode,
        duration,
        ratio: aspectRatio,
        resolution,
        generateAudio,
        modelName,
        modelVersion,
        secretId,
        secretKey,
        subAppId,
        region
    });
    
    const taskId = submitResult.taskId;
    
    // 4. Poll for completion
    const maxWaitMs = 20 * 60 * 1000;
    const pollInterval = 5000;
    const startTime = Date.now();
    
    console.log(`[Tencent VOD] 轮询超时: ${Math.round(maxWaitMs / 60000)} 分钟 (视频时长: ${duration}s)`);
    
    while (Date.now() - startTime < maxWaitMs) {
        await new Promise(r => setTimeout(r, pollInterval));
        
        const statusResult = await queryTaskStatus({
            taskId,
            secretId,
            secretKey,
            subAppId,
            region
        });
        
        if (statusResult.status === 'completed') {
            return statusResult.videoUrl;
        }
        
        if (statusResult.status === 'failed') {
            throw new Error(statusResult.error);
        }
        
        const elapsed = Math.round((Date.now() - startTime) / 60000);
        const remaining = Math.round((maxWaitMs - (Date.now() - startTime)) / 60000);
        console.log(`[Tencent VOD] 生成中... 进度: ${statusResult.progress || '未知'} (已等待 ${elapsed}min, 剩余 ${remaining}min)`);
    }
    
    throw new Error(`视频生成超时 (等待了 ${Math.round(maxWaitMs / 60000)} 分钟)`);
}
