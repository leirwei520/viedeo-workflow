// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
// GoogleGenAI removed – chat now uses an OpenAI-compatible API (configurable via CHAT_BASE_URL)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { spawn } from 'child_process';
import chatAgent from './agent/index.js';
import generationRoutes from './routes/generation.js';

import localModelsRoutes from './routes/local-models.js';
import storyboardRoutes from './routes/storyboard.js';
import agentRoutes from './routes/agent.js';
import { runMigrations } from './db/migrate.js';
import * as syncService from './services/sync.js';
import { initAuthRoutes } from './routes/auth.js';
import { initUsageRoutes } from './routes/usage.js';
import { initPricingRoutes } from './routes/pricing.js';
import { initAdminRoutes } from './routes/admin.js';
import { getPool } from './db/pool.js';
import { testRedisConnection, getRedis as getRedisClient } from './db/redis.js';
import { authMiddleware, verifyToken } from './middleware/auth.js';
import { errorSanitizerMiddleware, globalErrorHandler } from './middleware/errorSanitizer.js';
import { logUsage, checkBalance } from './routes/generation.js';
import { getModelPrice, calculateCost } from './routes/pricing.js';
import multer from 'multer';
import * as storageService from './services/storage.js';
import { toInternalOssUrl } from './services/oss-storage.js';
import { validateExternalUrl } from './utils/urlValidator.js';
import { connectRabbitMQ } from './services/rabbitmq.js';
import * as volcTts from './services/volcengine-tts.js';
import { Converter as openccTwToCn } from 'opencc-js/t2cn';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Legacy local directories (kept for backward compatibility with existing local files)
const LIBRARY_DIR = process.env.LIBRARY_DIR || path.join(__dirname, '..', 'library');
const IMAGES_DIR = path.join(LIBRARY_DIR, 'images');
const VIDEOS_DIR = path.join(LIBRARY_DIR, 'videos');

// Ensure legacy dirs exist for static serving of old files
[LIBRARY_DIR, IMAGES_DIR, VIDEOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/**
 * Resolve a user-supplied relative path against a base directory safely.
 * Returns null if the resolved path escapes the base directory (path traversal).
 */
function safeLibraryPath(baseDir, relativePath) {
    const resolved = path.resolve(baseDir, relativePath);
    if (!resolved.startsWith(path.resolve(baseDir) + path.sep) && resolved !== path.resolve(baseDir)) {
        return null;
    }
    return resolved;
}

// Enable CORS for all routes (must come before static file serving)
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(errorSanitizerMiddleware);

app.get('/health', async (_req, res) => {
    const status = { status: 'ok', uptime: process.uptime(), timestamp: Date.now() };
    try {
        const pool = getPool();
        if (pool) { await pool.execute('SELECT 1'); status.mysql = 'connected'; }
        else { status.mysql = 'unavailable'; }
    } catch { status.mysql = 'error'; }
    try {
        const redis = getRedisClient();
        if (redis?.status === 'ready') { await redis.ping(); status.redis = 'connected'; }
        else { status.redis = 'unavailable'; }
    } catch { status.redis = 'error'; }
    const overall = (status.mysql === 'error') ? 503 : 200;
    res.status(overall).json(status);
});

app.get('/api/download', authMiddleware, async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url parameter' });

    const allowedPattern = /^https?:\/\/.+\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|ogg)$/i;
    if (!allowedPattern.test(url.split('?')[0])) return res.status(400).json({ error: 'Invalid file URL' });

    try {
        const fetchUrl = toInternalOssUrl(url);
        const upstream = await fetch(fetchUrl, { signal: AbortSignal.timeout(30000) });
        if (!upstream.ok) return res.status(upstream.status).json({ error: 'Upstream fetch failed' });

        const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
        const filename = decodeURIComponent(url.split('?')[0].split('/').pop() || 'download');

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        const contentLength = upstream.headers.get('content-length');
        if (contentLength) res.setHeader('Content-Length', contentLength);

        const reader = upstream.body.getReader();
        const pump = async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) { res.end(); return; }
                if (!res.write(value)) {
                    await new Promise(resolve => res.once('drain', resolve));
                }
            }
        };
        await pump();
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
    }
});

// Legacy: serve local library files for backward compatibility (new files go to OSS)
// Auth required: accepts Bearer token in header or ?token= query param (for <img>/<video> tags)
app.use('/library', (req, res, next) => {
    const header = req.headers.authorization;
    const queryToken = req.query.token;
    const token = (header && header.startsWith('Bearer ')) ? header.slice(7) : queryToken;
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try { verifyToken(token); } catch {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    express.static(LIBRARY_DIR, { maxAge: '1y', immutable: true })(req, res, next);
});


const mergeUpload = multer({ dest: storageService.getTempDir(), limits: { fileSize: 100 * 1024 * 1024 } });

const API_KEY = process.env.CHAT_API_KEY;
const CHAT_BASE_URL = process.env.CHAT_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const CHAT_UTILITY_MODEL = process.env.CHAT_MODEL || 'qwen3.6-plus';
// Lightweight model for low-latency text utility tasks (TTS punctuation cleanup, quick rewrites, etc.).
// Uses Gemini Flash by default — typically 3–6× faster than the heavy `CHAT_MODEL` for short prompts.
const CHAT_FAST_MODEL = process.env.CHAT_FAST_MODEL || 'gemini-2.5-flash';

// ─── Pricing model IDs for non-text providers ───
// These map to rows in the `model_pricing` table. If a row is missing, calculateCost()
// returns 0 (logs a warning) — billing wires up safely either way.
const VOLC_TTS_MODEL_ID = process.env.VOLC_TTS_MODEL_ID || 'volc-tts';
const VOLC_TTS_CLONE_MODEL_ID = process.env.VOLC_TTS_CLONE_MODEL_ID || 'volc-tts-clone';
const INDEX_TTS_MODEL_ID = process.env.INDEX_TTS_MODEL_ID || 'index-tts';
const FASTER_WHISPER_MODEL_ID = process.env.FASTER_WHISPER_MODEL_ID || 'faster-whisper';
const CAMERA_ANGLE_MODEL_ID = process.env.CAMERA_ANGLE_MODEL_ID || 'camera-angle';

if (!API_KEY) {
    console.warn("SERVER WARNING: CHAT_API_KEY is not set in environment or .env file.");
}

/**
 * Call OpenAI-compatible chat API for text (and optionally vision) tasks.
 * Replaces the old Gemini-native callGeminiText.
 */
async function callChatTextWithImages(prompt, imageParts = [], { timeoutMs = 60_000, model, temperature = 0.7, maxTokens = 2048, disableThinking = false } = {}) {
    const content = [];
    content.push({ type: 'text', text: prompt });
    if (Array.isArray(imageParts) && imageParts.length > 0) {
        content.push(...imageParts);
    }

    const body = {
        model: model || CHAT_UTILITY_MODEL,
        messages: [{ role: 'user', content }],
        temperature,
        max_tokens: maxTokens,
    };

    if (disableThinking) {
        // Different vendors expect different signals — send several compatible flags
        // so this works whether the proxy routes to Gemini, GPT-o-series, Claude, etc.
        body.thinking_budget = 0;                       // Gemini-style direct flag
        body.reasoning_effort = 'minimal';              // OpenAI o-series / GPT-5
        body.extra_body = {                             // Generic passthrough most proxies forward
            thinking_config: { thinking_budget: 0 },
            google: { thinking_config: { thinking_budget: 0 } },
            thinking: { type: 'disabled' },
        };
    }

    const response = await fetch(`${CHAT_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Chat API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const totalTokens = data?.usage?.total_tokens || 0;
    return { text, totalTokens };
}

async function callChatText(prompt, imageBase64, mimeType) {
    const imageParts = [];
    if (imageBase64) {
        imageParts.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType || 'image/png'};base64,${imageBase64}` }
        });
    }
    return callChatTextWithImages(prompt, imageParts);
}

async function toChatImagePart(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;

    if (imageUrl.startsWith('data:')) {
        return { type: 'image_url', image_url: { url: imageUrl } };
    }

    if (imageUrl.startsWith('http')) {
        try {
            const cleanUrl = imageUrl.split('?')[0];
            const urlCheck = validateExternalUrl(cleanUrl);
            if (!urlCheck.valid) return null;
            const resp = await fetch(toInternalOssUrl(cleanUrl), { signal: AbortSignal.timeout(30_000) });
            if (!resp.ok) return null;
            const buffer = Buffer.from(await resp.arrayBuffer());
            const contentType = resp.headers.get('content-type') || 'image/png';
            return { type: 'image_url', image_url: { url: `data:${contentType};base64,${buffer.toString('base64')}` } };
        } catch (error) {
            console.warn('[Chat Image] Failed to fetch remote image:', error.message);
            return null;
        }
    }

    if (imageUrl.startsWith('/library/')) {
        const cleanUrl = imageUrl.split('?')[0];
        let fullPath = '';
        if (cleanUrl.startsWith('/library/images/')) fullPath = safeLibraryPath(IMAGES_DIR, cleanUrl.replace('/library/images/', ''));
        if (!fullPath || !fs.existsSync(fullPath)) return null;
        const imageData = fs.readFileSync(fullPath);
        const mimeType = fullPath.endsWith('.png')
            ? 'image/png'
            : fullPath.endsWith('.jpg') || fullPath.endsWith('.jpeg')
                ? 'image/jpeg'
                : 'image/webp';
        return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageData.toString('base64')}` } };
    }

    return null;
}

// ============================================================================
// KLING AI CONFIGURATION
// ============================================================================

const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const KLING_SECRET_KEY = process.env.KLING_SECRET_KEY;
const KLING_BASE_URL = 'https://api-singapore.klingai.com';

// Kling API keys are optional - using Tencent VOD instead

// ============================================================================
// HAILUO AI CONFIGURATION
// ============================================================================

const HAILUO_API_KEY = process.env.HAILUO_API_KEY;

// Hailuo API key is optional - using Tencent VOD instead

// ============================================================================
// OPENAI GPT IMAGE CONFIGURATION
// ============================================================================

// OpenAI GPT Image models removed – using Tencent GEM instead

// ============================================================================
// FAL.AI CONFIGURATION (for Kling 2.6 Motion Control)
// ============================================================================

const FAL_API_KEY = process.env.FAL_API_KEY;

// FAL API key is optional - using Tencent VOD instead

// ============================================================================
// VOLCENGINE ARK CONFIGURATION (for Doubao Seedance 2.0)
// ============================================================================

const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_MODEL_ID = process.env.ARK_MODEL_ID || 'doubao-seedance-2-0-260128';

// ============================================================================
// CHUHAIBANG IMAGE GENERATION CONFIGURATION
// ============================================================================

const CHB_API_KEY = process.env.CHB_API_KEY;
const CHB_BASE_URL = process.env.CHB_BASE_URL || 'https://your-chb-endpoint.example.com/api';

// ============================================================================
// TENCENT VOD CONFIGURATION (for video generation)
// ============================================================================

const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID;
const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY;
const TENCENT_SUB_APP_ID = process.env.TENCENT_SUB_APP_ID;
const TENCENT_REGION = process.env.TENCENT_REGION || 'ap-guangzhou';

if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY || !TENCENT_SUB_APP_ID) {
    console.warn("SERVER WARNING: Tencent VOD credentials not complete. Video generation will not work.");
}

// ============================================================================
// ALIYUN OSS CONFIGURATION (for image upload)
// ============================================================================

const OSS_ENDPOINT = process.env.OSS_ENDPOINT;
const OSS_BUCKET = process.env.OSS_BUCKET;
const OSS_ACCESS_KEY = process.env.OSS_ACCESS_KEY;
const OSS_ACCESS_SECRET = process.env.OSS_ACCESS_SECRET;
const OSS_DOMAIN = process.env.OSS_DOMAIN || '';

if (!OSS_ENDPOINT || !OSS_BUCKET || !OSS_ACCESS_KEY || !OSS_ACCESS_SECRET) {
    console.warn("SERVER WARNING: Aliyun OSS credentials not complete. Image upload for video generation will not work.");
}

// Set up app.locals for sharing config with route modules
app.locals.CHAT_API_KEY = API_KEY;
app.locals.CHAT_BASE_URL = CHAT_BASE_URL;
app.locals.KLING_ACCESS_KEY = KLING_ACCESS_KEY;
app.locals.KLING_SECRET_KEY = KLING_SECRET_KEY;
app.locals.HAILUO_API_KEY = HAILUO_API_KEY;
app.locals.FAL_API_KEY = FAL_API_KEY;
// Volcengine Ark (Doubao Seedance 2.0)
app.locals.ARK_API_KEY = ARK_API_KEY;
app.locals.ARK_MODEL_ID = ARK_MODEL_ID;
// ChuHaiBang Image Generation
app.locals.CHB_API_KEY = CHB_API_KEY;
app.locals.CHB_BASE_URL = CHB_BASE_URL;
// Tencent VOD
app.locals.TENCENT_SECRET_ID = TENCENT_SECRET_ID;
app.locals.TENCENT_SECRET_KEY = TENCENT_SECRET_KEY;
app.locals.TENCENT_SUB_APP_ID = TENCENT_SUB_APP_ID;
app.locals.TENCENT_REGION = TENCENT_REGION;
// Aliyun OSS
app.locals.OSS_ENDPOINT = OSS_ENDPOINT;
app.locals.OSS_BUCKET = OSS_BUCKET;
app.locals.OSS_ACCESS_KEY = OSS_ACCESS_KEY;
app.locals.OSS_ACCESS_SECRET = OSS_ACCESS_SECRET;
app.locals.OSS_DOMAIN = OSS_DOMAIN;
// Directories
app.locals.IMAGES_DIR = IMAGES_DIR;
app.locals.VIDEOS_DIR = VIDEOS_DIR;
app.locals.LIBRARY_DIR = LIBRARY_DIR;

// ============================================================================
// WORKFLOW SANITIZATION HELPERS
// ============================================================================

/**
 * Sanitizes workflow nodes by uploading base64 data and migrating /library/ paths to OSS.
 * Prevents large base64 strings from bloating workflow JSON and ensures all URLs are OSS.
 */
async function sanitizeWorkflowNodes(nodes, userId) {
    if (!nodes || !Array.isArray(nodes)) return nodes;

    let sanitizedCount = 0;
    const fields = ['resultUrl', 'lastFrame', 'editorCanvasData', 'editorBackgroundUrl'];

    const sanitized = await Promise.all(nodes.map(async (node) => {
        const cleanNode = { ...node };

        for (const field of fields) {
            const val = cleanNode[field];
            if (!val || typeof val !== 'string') continue;

            if (val.startsWith('data:')) {
                try {
                    const ossUrl = await storageService.saveBase64Asset(val, userId);
                    if (ossUrl && ossUrl !== val) {
                        cleanNode[field] = ossUrl;
                        sanitizedCount++;
                    }
                } catch (err) {
                    console.error(`  [Workflow Sanitize] Failed to upload ${field}:`, err.message);
                }
            } else if (val.includes('/library/') && !val.startsWith('http')) {
                try {
                    const ossUrl = await storageService.resolveLibraryPathToOss(val, userId);
                    if (ossUrl && ossUrl !== val) {
                        cleanNode[field] = ossUrl;
                        sanitizedCount++;
                    }
                } catch (err) {
                    console.error(`  [Workflow Sanitize] Failed to migrate ${field}:`, err.message);
                }
            }
        }

        if (cleanNode.title && /^(nodes|contextMenu|common)\./.test(cleanNode.title)) {
            delete cleanNode.title;
        }

        return cleanNode;
    }));

    if (sanitizedCount > 0) {
        console.log(`[Workflow Sanitize] Converted ${sanitizedCount} field(s) to OSS URLs`);
    }

    return sanitized;
}

// Mount generation routes (image and video generation)
app.use('/api', generationRoutes);



// Mount Local Models routes (local open-source model discovery)
app.use('/api/local-models', authMiddleware, localModelsRoutes);

// Mount Storyboard routes (AI script generation)
app.use('/api/storyboard', storyboardRoutes);

// Mount Agent routes (tool-calling AI agent with SSE)
app.use('/api/agent', agentRoutes);

// Mount Auth routes (login, register, token refresh)
app.use('/api/auth', initAuthRoutes(getPool()));

// Mount Usage routes (usage stats and logs)
app.use('/api/usage', initUsageRoutes(getPool()));

// Mount Pricing routes (model pricing list)
app.use('/api/pricing', initPricingRoutes(getPool()));

// Mount Admin routes (user management, wallet recharge, pricing CRUD)
app.use('/api/admin', initAdminRoutes(getPool()));

// NOTE: Old Kling helpers removed - now in server/services/kling.js

// --- Library Assets API (OSS + MySQL) ---

app.post('/api/library', authMiddleware, async (req, res) => {
    try {
        const { sourceUrl, name, category, meta } = req.body;
        const uid = String(req.userId);

        if (!sourceUrl || !name || !category) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const pool = getPool();
        if (!pool) return res.status(503).json({ error: 'Database not available' });

        let ossUrl;
        const isVideo = sourceUrl.includes('video') || sourceUrl.startsWith('data:video');
        const assetType = isVideo ? 'video' : 'image';

        if (sourceUrl.startsWith('data:')) {
            // Base64 upload → OSS
            ossUrl = await storageService.saveBase64Asset(sourceUrl, uid);
        } else if (sourceUrl.startsWith('http')) {
            // Already an OSS/remote URL — store directly
            ossUrl = sourceUrl.split('?')[0];
        } else {
            // Local /library/ path — fetch to buffer and upload to OSS
            const cleanUrl = decodeURIComponent(sourceUrl.split('?')[0]);
            let localPath = null;
            if (cleanUrl.startsWith('/library/images/')) localPath = safeLibraryPath(IMAGES_DIR, cleanUrl.replace('/library/images/', ''));
            else if (cleanUrl.startsWith('/library/videos/')) localPath = safeLibraryPath(VIDEOS_DIR, cleanUrl.replace('/library/videos/', ''));

            if (localPath && fs.existsSync(localPath)) {
                const { uploadFile, buildObjectKey } = await import('./services/oss-storage.js');
                const ext = path.extname(localPath).replace('.', '');
                const key = buildObjectKey(uid, 'library', `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.${ext}`);
                ossUrl = await uploadFile(localPath, key);
            } else {
                return res.status(404).json({ error: "Source file not found" });
            }
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await pool.execute(
            'INSERT INTO library_assets (id, user_id, name, category, type, oss_url, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [id, uid, name, category, assetType, ossUrl, JSON.stringify(meta || {}), now]
        );

        res.json({ success: true, asset: { id, userId: uid, name, category, url: ossUrl, type: assetType, createdAt: now, ...meta } });
    } catch (error) {
        console.error("Save to library error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/library', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const pool = getPool();
        if (!pool) return res.json([]);

        const [rows] = await pool.execute(
            'SELECT * FROM library_assets WHERE user_id = ? ORDER BY created_at DESC',
            [uid]
        );
        const assets = rows.map(r => ({
            id: r.id, userId: r.user_id, name: r.name, category: r.category,
            url: r.oss_url, type: r.type, createdAt: r.created_at,
            ...(r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {})
        }));
        res.json(assets);
    } catch (error) {
        console.error("List library error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/library/:id', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const pool = getPool();
        if (!pool) return res.status(503).json({ error: 'Database not available' });

        const [rows] = await pool.execute('SELECT user_id FROM library_assets WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: "Asset not found" });
        if (String(rows[0].user_id) !== String(uid)) return res.status(403).json({ error: 'No permission' });

        await pool.execute('DELETE FROM library_assets WHERE id = ? AND user_id = ?', [req.params.id, uid]);
        res.json({ success: true });
    } catch (error) {
        console.error("Delete library asset error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- Settings API ---

// Get current settings
app.get('/api/settings', (req, res) => {
    res.json({
        libraryDir: 'Aliyun OSS',
        isDefault: true,
        defaultDir: 'OSS',
        storageMode: 'oss',
    });
});

// Get storage stats (from DB)
app.get('/api/settings/storage-stats', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const stats = await storageService.getStorageStats(uid);
        if (stats) {
            res.json({ libraryDir: 'OSS', ...stats });
        } else {
            res.json({ libraryDir: 'OSS', images: { count: 0, size: 0 }, videos: { count: 0, size: 0 }, workflows: { count: 0, size: 0 }, chats: { count: 0, size: 0 }, totalSize: 0 });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ============================================================================
// REVERSE PROMPT (image/video → prompt description)
// ============================================================================

app.post('/api/reverse-prompt', authMiddleware, async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) return res.status(400).json({ error: '缺少图片/视频 URL' });

        const urlCheck = validateExternalUrl(imageUrl);
        if (!urlCheck.valid) return res.status(400).json({ error: `无效的 URL: ${urlCheck.reason}` });

        await checkBalance(req.userId, CHAT_UTILITY_MODEL);

        const imgRes = await fetch(toInternalOssUrl(imageUrl), { signal: AbortSignal.timeout(30_000) });
        if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);

        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const base64 = buffer.toString('base64');
        const contentType = imgRes.headers.get('content-type') || 'image/png';

        const systemPrompt = `你是一个专业的AI图像/视频分析师。请仔细观察这张图片，生成一段可以用于AI图像生成模型重新生成类似图片的英文提示词（prompt）。

要求：
1. 用英文输出
2. 描述画面的主体、风格、色调、构图、光影、氛围等关键要素
3. 使用AI绘画常用的提示词格式，包含质量修饰词
4. 长度适中（50-150词）
5. 只输出提示词本身，不要加任何解释或前缀`;

        const { text, totalTokens } = await callChatText(systemPrompt, base64, contentType);
        res.json({ prompt: text.trim() });

        try {
            const price = await getModelPrice(CHAT_UTILITY_MODEL);
            const cost = calculateCost(price, { tokens: totalTokens });
            logUsage({ userId: req.userId, type: 'text', model: CHAT_UTILITY_MODEL, prompt: 'reverse-prompt', cost, tokens: totalTokens, status: 'success' });
        } catch (billingErr) { console.error('[ReversePrompt] Billing error:', billingErr.message); }
        return;
    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error('[ReversePrompt] Error:', error.message);
        logUsage({ userId: req.userId, type: 'text', model: CHAT_UTILITY_MODEL, prompt: 'reverse-prompt', cost: 0, tokens: 0, status: 'failed' });
        res.status(500).json({ error: '反推提示词失败，请稍后重试' });
    }
});

// ============================================================================
// CLOUD SYNC API (cross-device restore)
// ============================================================================

app.get('/api/cloud/status', authMiddleware, async (req, res) => {
    try {
        const status = await syncService.getSyncStatus(String(req.userId));
        res.json(status);
    } catch (error) {
        console.error('[Cloud Status] Error:', error.message);
        res.status(500).json({ error: 'Failed to get sync status' });
    }
});

app.get('/api/cloud/workflows', authMiddleware, async (req, res) => {
    try {
        const workflows = await syncService.loadWorkflows(String(req.userId));
        res.json(workflows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/cloud/workflows/:id', authMiddleware, async (req, res) => {
    try {
        const row = await syncService.loadWorkflowById(req.params.id, String(req.userId));
        if (!row) return res.status(404).json({ error: 'Workflow not found in cloud' });
        const workflow = JSON.parse(row.data);

        if (workflow.nodes && Array.isArray(workflow.nodes)) {
            const pool = getPool();
            if (pool) {
                const urlFields = ['resultUrl', 'lastFrame'];
                let fixed = 0;
                await Promise.all(workflow.nodes.map(async (node) => {
                    for (const field of urlFields) {
                        const val = node[field];
                        if (!val || typeof val !== 'string') continue;
                        if (val.startsWith('data:') || val.startsWith('http')) continue;
                        if (!val.includes('/library/')) continue;
                        try {
                            const [rows] = await pool.execute(
                                'SELECT oss_url FROM images WHERE id = ? AND oss_url IS NOT NULL LIMIT 1',
                                [node.id]
                            );
                            if (rows.length > 0 && rows[0].oss_url) {
                                node[field] = rows[0].oss_url;
                                fixed++;
                            }
                        } catch {}
                    }
                }));
                if (fixed > 0) console.log(`[Workflow Load] Resolved ${fixed} /library/ path(s) to OSS URLs`);
            }
        }

        res.json(workflow);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/cloud/images', authMiddleware, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const result = await syncService.loadAssets('images', String(req.userId), limit, offset);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/cloud/videos', authMiddleware, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const result = await syncService.loadAssets('videos', String(req.userId), limit, offset);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cloud/restore/workflow/:id', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const row = await syncService.loadWorkflowById(req.params.id, uid);
        if (!row) return res.status(404).json({ error: 'Workflow not found in cloud' });
        res.json({ success: true, id: row.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Workflow API Routes (MySQL primary) ---

app.post('/api/workflows', authMiddleware, async (req, res) => {
    try {
        const workflow = req.body;
        const uid = String(req.userId);
        if (!workflow.id) workflow.id = crypto.randomUUID();
        workflow.userId = uid;
        workflow.updatedAt = new Date().toISOString();
        if (!workflow.createdAt) workflow.createdAt = workflow.updatedAt;

        const pool = getPool();
        if (!pool) return res.status(503).json({ error: 'Database not available' });

        // Check ownership if existing, and prevent empty overwrites
        const [existing] = await pool.execute('SELECT user_id, cover_url, node_count FROM workflows WHERE id = ?', [workflow.id]);
        if (existing.length > 0) {
            if (existing[0].user_id && String(existing[0].user_id) !== String(uid)) {
                return res.status(403).json({ error: 'No permission to update this workflow' });
            }
            if (existing[0].cover_url && !workflow.coverUrl) {
                workflow.coverUrl = existing[0].cover_url;
            }
            const incomingCount = workflow.nodes?.length || 0;
            if (incomingCount === 0 && existing[0].node_count > 0) {
                console.warn(`[Workflow] Blocked empty overwrite of ${workflow.id} (had ${existing[0].node_count} nodes)`);
                return res.json({ success: true, id: workflow.id, skipped: true });
            }
        }

        if (workflow.nodes) {
            workflow.nodes = await sanitizeWorkflowNodes(workflow.nodes, uid);
        }

        const title = workflow.title || null;
        const data = JSON.stringify(workflow);
        const coverUrl = workflow.coverUrl || null;
        const nodeCount = workflow.nodes?.length || 0;
        const createdAt = new Date(workflow.createdAt).toISOString().slice(0, 19).replace('T', ' ');
        const updatedAt = new Date(workflow.updatedAt).toISOString().slice(0, 19).replace('T', ' ');

        await pool.execute(
            `INSERT INTO workflows (id, user_id, title, data, cover_url, node_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title=VALUES(title), data=VALUES(data), cover_url=VALUES(cover_url), node_count=VALUES(node_count), updated_at=VALUES(updated_at)`,
            [workflow.id, uid, title, data, coverUrl, nodeCount, createdAt, updatedAt]
        );

        // Invalidate Redis cache
        const redis = getRedisClient();
        if (redis) {
            await redis.del(`wf_list:${uid}`).catch(() => {});
            await redis.del(`wf:${workflow.id}`).catch(() => {});
        }

        res.json({ success: true, id: workflow.id });
    } catch (error) {
        console.error("Save workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- Public Workflows API (bundled examples) ---

// Public workflows — built once at startup, cached in memory (files never change at runtime)
let publicWorkflowsCache = null;

function loadPublicWorkflows() {
    try {
        const publicWorkflowsDir = path.join(__dirname, '..', 'public', 'workflows');
        if (!fs.existsSync(publicWorkflowsDir)) return [];

        const files = fs.readdirSync(publicWorkflowsDir)
            .filter(f => f.endsWith('.json') && f !== 'index.json');

        const workflows = files.map(file => {
            try {
                const content = fs.readFileSync(path.join(publicWorkflowsDir, file), 'utf8');
                const workflow = JSON.parse(content);
                const nodeTypes = workflow.nodes?.reduce((acc, n) => {
                    acc[n.type] = (acc[n.type] || 0) + 1;
                    return acc;
                }, {}) || {};
                return {
                    id: file.replace('.json', ''),
                    title: workflow.title || '',
                    description: workflow.description || null,
                    nodeTypes,
                    nodeCount: workflow.nodes?.length || 0,
                    coverUrl: workflow.coverUrl || null
                };
            } catch (parseError) {
                console.warn(`Skipping invalid workflow file: ${file}`, parseError.message);
                return null;
            }
        }).filter(Boolean);

        workflows.sort((a, b) => a.title.localeCompare(b.title));
        return workflows;
    } catch (error) {
        console.error("Load public workflows error:", error);
        return [];
    }
}

app.get('/api/public-workflows', (req, res) => {
    if (!publicWorkflowsCache) {
        publicWorkflowsCache = loadPublicWorkflows();
    }
    res.json(publicWorkflowsCache);
});

// Load specific public workflow
app.get('/api/public-workflows/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            return res.status(400).json({ error: "Invalid workflow ID" });
        }
        const publicWorkflowsDir = path.join(__dirname, '..', 'public', 'workflows');
        const filePath = path.join(publicWorkflowsDir, `${id}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Public workflow not found" });
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const workflow = JSON.parse(content);
        // Clean stale i18n keys from node titles on load
        if (workflow.nodes && Array.isArray(workflow.nodes)) {
            workflow.nodes = workflow.nodes.map(node => {
                if (node.title && /^(nodes|contextMenu|common)\./.test(node.title)) {
                    const { title, ...rest } = node;
                    return rest;
                }
                return node;
            });
        }
        res.json(workflow);
    } catch (error) {
        console.error("Load public workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- User Workflows API (from DB + Redis cache) ---

app.get('/api/workflows', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const pool = getPool();
        if (!pool) return res.json([]);

        // Try Redis cache first
        const redis = getRedisClient();
        const cacheKey = `wf_list:${uid}`;
        if (redis) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) return res.json(JSON.parse(cached));
            } catch {}
        }

        const [rows] = await pool.execute(
            'SELECT id, title, cover_url, node_count, data, created_at, updated_at FROM workflows WHERE user_id = ? ORDER BY updated_at DESC',
            [uid]
        );
        const workflows = rows.map(r => {
            let nodeTypes = {};
            try {
                const parsed = JSON.parse(r.data);
                nodeTypes = parsed.nodes?.reduce((acc, n) => { acc[n.type] = (acc[n.type] || 0) + 1; return acc; }, {}) || {};
            } catch {}
            return {
                id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at,
                nodeCount: r.node_count, nodeTypes, coverUrl: r.cover_url
            };
        });

        if (redis) redis.set(cacheKey, JSON.stringify(workflows), 'EX', 300).catch(() => {});

        res.json(workflows);
    } catch (error) {
        console.error("List workflows error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/workflows/:id', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const wfId = req.params.id;
        const pool = getPool();
        if (!pool) return res.status(503).json({ error: 'Database not available' });

        // Always verify ownership via DB first, then serve from cache if safe
        const [rows] = await pool.execute('SELECT user_id, data FROM workflows WHERE id = ?', [wfId]);
        if (rows.length === 0) return res.status(404).json({ error: "Workflow not found" });

        const row = rows[0];
        if (row.user_id && String(row.user_id) !== uid) return res.status(403).json({ error: "No permission" });

        // Try Redis cache (ownership already verified above)
        const redis = getRedisClient();
        const cacheKey = `wf:${wfId}`;
        if (redis) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    const wf = JSON.parse(cached);
                    const hasLibraryPaths = wf.nodes?.some(n =>
                        ['resultUrl', 'lastFrame'].some(f => {
                            const v = n[f];
                            return v && typeof v === 'string' && v.includes('/library/') && !v.startsWith('http');
                        })
                    );
                    if (!hasLibraryPaths) return res.json(wf);
                    await redis.del(cacheKey).catch(() => {});
                }
            } catch {}
        }

        const workflow = JSON.parse(row.data);

        if (workflow.nodes && Array.isArray(workflow.nodes)) {
            let fixed = 0;
            await Promise.all(workflow.nodes.map(async (node) => {
                if (node.title && /^(nodes|contextMenu|common)\./.test(node.title)) {
                    delete node.title;
                }
                for (const field of ['resultUrl', 'lastFrame']) {
                    const val = node[field];
                    if (!val || typeof val !== 'string') continue;
                    if (val.startsWith('data:') || val.startsWith('http')) continue;
                    if (!val.includes('/library/')) continue;
                    try {
                        const resolved = await storageService.resolveLibraryPathToOss(val, uid);
                        if (resolved && resolved !== val) {
                            node[field] = resolved;
                            fixed++;
                        }
                    } catch {}
                }
            }));
            if (fixed > 0) console.log(`[Workflow Load] Resolved ${fixed} /library/ path(s) to OSS URLs`);
        }

        if (redis) redis.set(cacheKey, JSON.stringify(workflow), 'EX', 600).catch(() => {});

        res.json(workflow);
    } catch (error) {
        console.error("Load workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/workflows/:id', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const wfId = req.params.id;
        const pool = getPool();
        if (!pool) return res.status(503).json({ error: 'Database not available' });

        const [rows] = await pool.execute('SELECT user_id FROM workflows WHERE id = ?', [wfId]);
        if (rows.length === 0) return res.status(404).json({ error: "Workflow not found" });
        if (rows[0].user_id && String(rows[0].user_id) !== String(uid)) return res.status(403).json({ error: "No permission" });

        await pool.execute('DELETE FROM workflows WHERE id = ? AND user_id = ?', [wfId, uid]);

        const redis = getRedisClient();
        if (redis) {
            await redis.del(`wf_list:${uid}`).catch(() => {});
            await redis.del(`wf:${wfId}`).catch(() => {});
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Delete workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Update workflow title
app.put('/api/workflows/:id/title', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const { title } = req.body;
        const wfId = req.params.id;
        const pool = getPool();
        if (!pool) return res.status(503).json({ error: 'Database not available' });

        const [rows] = await pool.execute('SELECT user_id, data FROM workflows WHERE id = ?', [wfId]);
        if (rows.length === 0) return res.status(404).json({ error: "Workflow not found" });
        if (rows[0].user_id && String(rows[0].user_id) !== String(uid)) return res.status(403).json({ error: "No permission" });

        const workflowData = JSON.parse(rows[0].data);
        workflowData.title = title || '';
        await pool.execute('UPDATE workflows SET title = ?, data = ? WHERE id = ?', [title || '', JSON.stringify(workflowData), wfId]);

        const redis = getRedisClient();
        if (redis) {
            await redis.del(`wf_list:${uid}`).catch(() => {});
            await redis.del(`wf:${wfId}`).catch(() => {});
        }

        res.json({ success: true, title });
    } catch (error) {
        console.error("Update title error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Update workflow cover
app.put('/api/workflows/:id/cover', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const { coverUrl } = req.body;
        const wfId = req.params.id;
        const pool = getPool();
        if (!pool) return res.status(503).json({ error: 'Database not available' });

        const [rows] = await pool.execute('SELECT user_id, data FROM workflows WHERE id = ?', [wfId]);
        if (rows.length === 0) return res.status(404).json({ error: "Workflow not found" });
        if (rows[0].user_id && String(rows[0].user_id) !== String(uid)) return res.status(403).json({ error: "No permission" });

        const workflowData = JSON.parse(rows[0].data);
        workflowData.coverUrl = coverUrl;
        await pool.execute('UPDATE workflows SET cover_url = ?, data = ? WHERE id = ?', [coverUrl, JSON.stringify(workflowData), wfId]);

        const redis = getRedisClient();
        if (redis) {
            await redis.del(`wf_list:${uid}`).catch(() => {});
            await redis.del(`wf:${wfId}`).catch(() => {});
        }

        res.json({ success: true, coverUrl });
    } catch (error) {
        console.error("Update cover error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GEMINI IMAGE DESCRIPTION API
// ============================================================================

// Describe an image for prompt generation
app.post('/api/gemini/describe-image', authMiddleware, async (req, res) => {
    try {
        const { imageUrl, prompt } = req.body;
        console.log(`[Gemini DescribeV2] Request received. imageUrl: ${imageUrl ? (imageUrl.length > 100 ? imageUrl.substring(0, 100) + '...' : imageUrl) : 'missing'}`);
        // DEBUG: Verify story context injection
        if (prompt) {
            console.log('[Gemini DescribeV2] Received Prompt:', prompt);
        }

        if (!imageUrl) {
            return res.status(400).json({ error: 'Image URL is required' });
        }

        let imagePart;

        if (imageUrl.startsWith('data:')) {
            const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                imagePart = { inlineData: { data: matches[2], mimeType: matches[1] } };
            }
        } else if (imageUrl.startsWith('http')) {
            try {
                const cleanUrl = imageUrl.split('?')[0];
                const urlCheck = validateExternalUrl(cleanUrl);
                if (!urlCheck.valid) return res.status(400).json({ error: `Invalid image URL: ${urlCheck.reason}` });
                console.log(`[Gemini DescribeV2] Fetching remote: ${cleanUrl}`);
                const resp = await fetch(toInternalOssUrl(cleanUrl), { signal: AbortSignal.timeout(30_000) });
                if (resp.ok) {
                    const buffer = Buffer.from(await resp.arrayBuffer());
                    const ct = resp.headers.get('content-type') || 'image/png';
                    imagePart = { inlineData: { data: buffer.toString('base64'), mimeType: ct } };
                }
            } catch (e) {
                console.warn('[Gemini DescribeV2] Failed to fetch remote image:', e.message);
            }
        } else if (imageUrl.startsWith('/library/')) {
            // Legacy local path fallback
            const cleanUrl = imageUrl.split('?')[0];
            let fullPath = '';
            if (cleanUrl.startsWith('/library/images/')) fullPath = safeLibraryPath(IMAGES_DIR, cleanUrl.replace('/library/images/', ''));
            if (fullPath && fs.existsSync(fullPath)) {
                const imageData = fs.readFileSync(fullPath);
                const mimeType = fullPath.endsWith('.png') ? 'image/png' : fullPath.endsWith('.jpg') || fullPath.endsWith('.jpeg') ? 'image/jpeg' : 'image/webp';
                imagePart = { inlineData: { data: imageData.toString('base64'), mimeType } };
            }
        }

        if (!imagePart) {
            return res.status(400).json({ error: 'Could not process image URL. Provide base64 data or a valid URL.' });
        }

        await checkBalance(req.userId, CHAT_UTILITY_MODEL);

        const { text, totalTokens } = await callChatText(
            prompt || "Describe this image in detail for video generation.",
            imagePart.inlineData.data,
            imagePart.inlineData.mimeType
        );

        if (!text) {
            console.warn('[DescribeV2] Warning: No text content found in response.');
        }

        res.json({ description: text });

        try {
            const price = await getModelPrice(CHAT_UTILITY_MODEL);
            const cost = calculateCost(price, { tokens: totalTokens });
            logUsage({ userId: req.userId, type: 'text', model: CHAT_UTILITY_MODEL, prompt: (prompt || 'describe-image').substring(0, 200), cost, tokens: totalTokens, status: 'success' });
        } catch (billingErr) { console.error('[DescribeV2] Billing error:', billingErr.message); }
        return;
    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error("Describe image error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Optimize a prompt for video generation
app.post('/api/gemini/optimize-prompt', authMiddleware, async (req, res) => {
    try {
        const { prompt, imageUrls } = req.body;
        console.log(`[Gemini Optimize] Request received. Prompt: ${prompt ? (prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt) : 'missing'}`);

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        await checkBalance(req.userId, CHAT_UTILITY_MODEL);

        // Remove mention tokens and stray object-replacement chars before sending to model.
        const sanitizedPrompt = String(prompt)
            .replace(/\uFFFC/g, ' ')
            .replace(/@\s*[^\s@，。！？,.!?:：；;\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const systemInstruction = "You are an expert video prompt engineer. Your goal is to rewrite the user's prompt to be descriptive, visual, and optimized for AI video generation models like Veo, Kling, and Hailuo. If reference images are provided, preserve identity and key visual details from those references (characters, scene elements, props, and style cues). Hard rule 1: Do not change the person's gender without clear visual evidence from reference images or explicit user instruction; if uncertain, use neutral terms such as '角色' or '人物'. Hard rule 2: If the user prompt is Chinese, output must be Chinese with natural Chinese phrasing and must avoid English prompt-engineering jargon/tone. Keep it under 60 words. Output ONLY the rewritten prompt. Never output @mentions, usernames, placeholder labels, or UI artifacts.";
        const normalizedImageUrls = Array.isArray(imageUrls)
            ? imageUrls.filter(url => typeof url === 'string' && url.trim().length > 0).slice(0, 4)
            : [];
        const imageParts = (await Promise.all(normalizedImageUrls.map(url => toChatImagePart(url)))).filter(Boolean);
        const textPrompt = imageParts.length > 0
            ? `${systemInstruction}\n\nReference images are attached.\nUser Prompt: ${sanitizedPrompt}`
            : `${systemInstruction}\n\nUser Prompt: ${sanitizedPrompt}`;

        const result = await callChatTextWithImages(textPrompt, imageParts);
        let text = result.text;

        if (!text) {
            console.warn('[Optimize] Warning: No text content found in response.');
            return res.status(500).json({ error: 'Failed to optimize prompt' });
        }

        // Final cleanup to avoid leaking mention tags/artifacts to downstream generation.
        text = text
            .replace(/\uFFFC/g, ' ')
            .replace(/^\s*@.*$/gm, ' ')
            .replace(/@\s*[^\s@，。！？,.!?:：；;\n]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .replace(/^["']|["']$/g, '');

        res.json({ optimizedPrompt: text });

        try {
            const price = await getModelPrice(CHAT_UTILITY_MODEL);
            const cost = calculateCost(price, { tokens: result.totalTokens });
            logUsage({ userId: req.userId, type: 'text', model: CHAT_UTILITY_MODEL, prompt: prompt.substring(0, 200), cost, tokens: result.totalTokens, status: 'success' });
        } catch (billingErr) { console.error('[Optimize] Billing error:', billingErr.message); }
        return;
    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error("Optimize prompt error:", error);
        res.status(500).json({ error: error.message });
    }
});

// NOTE: Old generation routes removed - now in server/routes/generation.js


// ============================================================================
// ASSET HISTORY API
// ============================================================================

// Save an asset (image or video) — uploads to OSS
app.post('/api/assets/:type', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const { type } = req.params;
        const { data, prompt } = req.body;

        if (!['images', 'videos'].includes(type)) {
            return res.status(400).json({ error: 'Invalid asset type' });
        }

        const base64Data = data.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = type === 'images' ? 'png' : 'mp4';

        const saveFn = type === 'images' ? storageService.saveImage : storageService.saveVideo;
        const saved = await saveFn(buffer, { userId: uid, prompt: prompt || '', ext });

        res.json({ success: true, id: saved.id, filename: saved.filename, url: saved.ossUrl });
    } catch (error) {
        console.error('Save asset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// List all assets of a type (from DB)
app.get('/api/assets/:type', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const { type } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        if (!['images', 'videos'].includes(type)) {
            return res.status(400).json({ error: 'Invalid asset type' });
        }

        const listFn = type === 'images' ? storageService.listImages : storageService.listVideos;
        const result = await listFn(uid, { limit, offset });
        res.json(result);
    } catch (error) {
        console.error('List assets error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete an asset (from DB)
app.delete('/api/assets/:type/:id', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const { type, id } = req.params;

        if (!['images', 'videos'].includes(type)) {
            return res.status(400).json({ error: 'Invalid asset type' });
        }

        // Check ownership
        const asset = await storageService.getAssetById(type, id);
        if (asset && asset.user_id && String(asset.user_id) !== String(uid)) {
            return res.status(403).json({ error: 'No permission' });
        }

        await storageService.deleteAsset(type, id, uid);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete asset error:', error);
        res.status(500).json({ error: error.message });
    }
});


// ============================================================================
// VIDEO TRIM API
// ============================================================================

/**
 * Check if FFmpeg is available on the system
 */
async function isFFmpegAvailable() {
    return new Promise((resolve) => {
        const proc = spawn('ffmpeg', ['-version']);
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
    });
}

/**
 * Trim a video using FFmpeg
 * @param {string} inputPath - Input video path
 * @param {string} outputPath - Output video path
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 */
async function trimVideoWithFFmpeg(inputPath, outputPath, startTime, endTime) {
    return new Promise((resolve, reject) => {
        const duration = endTime - startTime;

        if (duration <= 0) {
            reject(new Error('Invalid trim range: end time must be greater than start time'));
            return;
        }

        const args = [
            '-y',                           // Overwrite output
            '-i', inputPath,                // Input file
            '-ss', startTime.toString(),    // Start time
            '-t', duration.toString(),      // Duration
            '-c:v', 'libx264',              // Video codec
            '-pix_fmt', 'yuv420p',          // Force yuv420p for max compatibility
            '-c:a', 'aac',                  // Audio codec
            '-preset', 'fast',              // Encoding speed
            '-crf', '23',                   // Quality (lower = better)
            outputPath                       // Output file
        ];

        console.log(`[Video Trim] Running FFmpeg with args:`, args.join(' '));

        const proc = spawn('ffmpeg', args);

        let stderr = '';
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                console.log(`[Video Trim] Successfully trimmed video`);
                resolve();
            } else {
                reject(new Error(`FFmpeg failed with code ${code}: ${stderr.slice(-500)}`));
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`FFmpeg error: ${err.message}`));
        });
    });
}

/**
 * Trim a video: download to temp -> ffmpeg -> upload to OSS
 */
app.post('/api/trim-video', authMiddleware, async (req, res) => {
    try {
        const { videoUrl, startTime, endTime, nodeId } = req.body;
        const uid = String(req.userId);

        if (!videoUrl || startTime === undefined || endTime === undefined) {
            return res.status(400).json({ error: 'videoUrl, startTime, and endTime are required' });
        }

        console.log(`[Video Trim] Request: ${videoUrl}, ${startTime}s to ${endTime}s`);

        const ffmpegAvailable = await isFFmpegAvailable();
        if (!ffmpegAvailable) {
            return res.status(500).json({ error: 'FFmpeg is not installed on the server.' });
        }

        const cleanVideoUrl = videoUrl.split('?')[0];

        // Download source video to temp
        const tmpInputName = `trim_in_${Date.now()}.mp4`;
        const tmpInputPath = storageService.getTempPath(tmpInputName);

        if (cleanVideoUrl.startsWith('http')) {
            const urlCheck = validateExternalUrl(cleanVideoUrl, { allowPrivate: true });
            if (!urlCheck.valid) return res.status(400).json({ error: `Invalid video URL: ${urlCheck.reason}` });
            const resp = await fetch(toInternalOssUrl(cleanVideoUrl), { signal: AbortSignal.timeout(120_000) });
            if (!resp.ok) throw new Error('Failed to download source video');
            fs.writeFileSync(tmpInputPath, Buffer.from(await resp.arrayBuffer()));
        } else if (cleanVideoUrl.startsWith('/library/videos/')) {
            const localPath = safeLibraryPath(VIDEOS_DIR, cleanVideoUrl.replace('/library/videos/', ''));
            if (!localPath) return res.status(400).json({ error: 'Invalid video path' });
            if (!fs.existsSync(localPath)) return res.status(404).json({ error: 'Source video not found' });
            fs.copyFileSync(localPath, tmpInputPath);
        } else {
            return res.status(400).json({ error: 'Invalid video URL format' });
        }

        const hash = crypto.randomBytes(4).toString('hex');
        const tmpOutputName = `trimmed_${Date.now()}_${hash}.mp4`;
        const tmpOutputPath = storageService.getTempPath(tmpOutputName);

        await trimVideoWithFFmpeg(tmpInputPath, tmpOutputPath, startTime, endTime);
        storageService.removeTempFile(tmpInputPath);

        const saved = await storageService.uploadTempFileAsVideo(tmpOutputPath, {
            userId: uid,
            prompt: `Trimmed video (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s)`,
            model: 'video-editor',
        });

        console.log(`[Video Trim] Saved: ${saved.ossUrl}`);

        res.json({ success: true, url: saved.ossUrl, filename: saved.filename, duration: endTime - startTime });

    } catch (error) {
        console.error('[Video Trim] Error:', error);
        res.status(500).json({ error: error.message || 'Failed to trim video' });
    }
});

// ============================================================================
// CAMERA ANGLE PROXY
// Proxies requests to the local Python camera-angle service so LAN clients
// don't need direct access to the Python server's port.
// ============================================================================

const CAMERA_ANGLE_ENDPOINT = process.env.VITE_MODAL_CAMERA_ENDPOINT || 'http://localhost:8100/generate';

app.post('/api/camera-angle/generate', authMiddleware, async (req, res) => {
    try {
        await checkBalance(req.userId, CAMERA_ANGLE_MODEL_ID);

        const response = await fetch(CAMERA_ANGLE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logUsage({ userId: req.userId, type: 'image', model: CAMERA_ANGLE_MODEL_ID, prompt: 'camera-angle', cost: 0, status: 'failed' });
            return res.status(response.status).json({ error: errorText });
        }

        const result = await response.json();
        res.json(result);

        try {
            const price = await getModelPrice(CAMERA_ANGLE_MODEL_ID);
            const cost = calculateCost(price);
            logUsage({ userId: req.userId, type: 'image', model: CAMERA_ANGLE_MODEL_ID, prompt: 'camera-angle', cost, status: 'success' });
        } catch (billingErr) { console.error('[CameraAngle] Billing error:', billingErr.message); }
        return;
    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error('[CameraAngle Proxy] Error:', error.message);
        logUsage({ userId: req.userId, type: 'image', model: CAMERA_ANGLE_MODEL_ID, prompt: 'camera-angle', cost: 0, status: 'failed' });
        if (error.cause?.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Camera angle service is not running. Start it with: python server/python/camera-angle/app.py' });
        }
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// CHAT AGENT API
// NOTE: Currently using LangGraph.js. If more complex agent capabilities
// are needed (multi-agent, advanced tools), consider migrating to Python.
// ============================================================================

// Send a message to the chat agent
app.post('/api/chat', authMiddleware, async (req, res) => {
    try {
        const { sessionId, message, media } = req.body;

        if (!API_KEY) {
            return res.status(500).json({ error: "Server missing API Key config" });
        }

        if (!sessionId) {
            return res.status(400).json({ error: "sessionId is required" });
        }

        if (!message && !media) {
            return res.status(400).json({ error: "message or media is required" });
        }

        await checkBalance(req.userId, CHAT_UTILITY_MODEL);

        const result = await chatAgent.sendMessage(sessionId, message, media, API_KEY, String(req.userId));

        res.json({
            success: true,
            response: result.response,
            topic: result.topic,
            messageCount: result.messageCount
        });

        try {
            const chatTokens = result.totalTokens || 0;
            const price = await getModelPrice(CHAT_UTILITY_MODEL);
            const cost = calculateCost(price, { tokens: chatTokens });
            logUsage({ userId: req.userId, type: 'text', model: CHAT_UTILITY_MODEL, prompt: (message || 'chat').substring(0, 200), cost, tokens: chatTokens, status: 'success' });
        } catch (billingErr) { console.error('[Chat] Billing error:', billingErr.message); }
        return;
    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error("Chat API Error:", error);
        res.status(500).json({ error: error.message || "Chat failed" });
    }
});

// List all chat sessions
app.get('/api/chat/sessions', authMiddleware, async (req, res) => {
    try {
        const sessions = await chatAgent.listSessions(String(req.userId));
        res.json(sessions);
    } catch (error) {
        console.error("List sessions error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Delete a chat session
app.delete('/api/chat/sessions/:id', authMiddleware, async (req, res) => {
    try {
        await chatAgent.deleteSession(req.params.id, String(req.userId));
        res.json({ success: true });
    } catch (error) {
        console.error("Delete session error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get full session data (for loading a specific chat)
app.get('/api/chat/sessions/:id', authMiddleware, async (req, res) => {
    try {
        const sessionData = await chatAgent.getSessionData(req.params.id, String(req.userId));
        if (!sessionData) {
            return res.status(404).json({ error: "Session not found" });
        }
        res.json(sessionData);
    } catch (error) {
        console.error("Get session error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// VIDEO MERGE API
// ============================================================================

function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffprobe', [
            '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath
        ]);
        let out = '';
        proc.stdout.on('data', d => out += d);
        proc.on('close', code => code === 0 && out.trim() ? resolve(parseFloat(out.trim())) : reject(new Error('ffprobe failed')));
        proc.on('error', reject);
    });
}

function hasAudioStream(filePath) {
    return new Promise((resolve) => {
        const proc = spawn('ffprobe', [
            '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath
        ]);
        let out = '';
        proc.stdout.on('data', d => out += d);
        proc.on('close', () => resolve(out.trim().length > 0));
        proc.on('error', () => resolve(false));
    });
}

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-500)}`)));
        proc.on('error', reject);
    });
}

/** Cut a segment [startSec, startSec+durationSec) from input; prefer stream copy, re-encode on failure. */
async function trimVideoSegment(inputPath, outputPath, startSec, durationSec) {
    try {
        await runFFmpeg([
            '-y', '-ss', String(startSec), '-i', inputPath,
            '-t', String(durationSec),
            '-c', 'copy',
            outputPath
        ]);
    } catch {
        await runFFmpeg([
            '-y', '-ss', String(startSec), '-i', inputPath,
            '-t', String(durationSec),
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            '-avoid_negative_ts', 'make_zero',
            outputPath
        ]);
    }
}

/**
 * Ensure a video file has an audio track (add silent one if missing)
 */
async function ensureAudio(inputPath, outputPath) {
    const has = await hasAudioStream(inputPath);
    if (has) {
        fs.copyFileSync(inputPath, outputPath);
        return;
    }
    await runFFmpeg([
        '-y', '-i', inputPath,
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-c:v', 'copy', '-c:a', 'aac', '-shortest', outputPath
    ]);
}

/**
 * Generate an ASS subtitle file from subtitle track data.
 * Returns the file path or null if no cues.
 */
function generateASSFile(subtitleTracks, tempDir, playResX = 1920, playResY = 1080) {
    const allCues = [];
    const styles = [];

    for (const track of subtitleTracks) {
        const s = track.style || {};
        const fontFamily = s.fontFamily || 'Noto Sans SC';
        const fontSize = s.fontSize || 48;
        const bold = s.bold !== false ? -1 : 0;
        const outlineWidth = s.outlineWidth ?? 2;
        const position = s.position || 'bottom';
        const alignment = position === 'top' ? 8 : position === 'center' ? 5 : 2;

        const hexToASSColor = (hex, alpha) => {
            const r = hex.slice(1, 3);
            const g = hex.slice(3, 5);
            const b = hex.slice(5, 7);
            const a = alpha != null ? alpha.toString(16).padStart(2, '0') : '00';
            return `&H${a}${b}${g}${r}`.toUpperCase();
        };

        const primaryColor = hexToASSColor(s.primaryColor || '#FFFFFF', 0);
        const outlineColor = hexToASSColor(s.outlineColor || '#000000', 0);

        const styleName = `S_${track.id}`.replace(/[^a-zA-Z0-9_]/g, '_');
        styles.push(
            `Style: ${styleName},${fontFamily},${fontSize},${primaryColor},&H000000FF,${outlineColor},&H80000000,${bold},0,0,0,100,100,0,0,1,${outlineWidth},0,${alignment},10,10,20,1`
        );

        for (const cue of (track.cues || [])) {
            allCues.push({ ...cue, styleName });
        }
    }

    if (allCues.length === 0) return null;

    allCues.sort((a, b) => a.startTime - b.startTime);

    const fmtASSTime = (sec) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const cs = Math.round((sec % 1) * 100);
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    };

    const lines = [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${playResX}`,
        `PlayResY: ${playResY}`,
        'WrapStyle: 0',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        ...styles,
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];

    for (const cue of allCues) {
        const text = cue.text.replace(/\n/g, '\\N');
        lines.push(`Dialogue: 0,${fmtASSTime(cue.startTime)},${fmtASSTime(cue.endTime)},${cue.styleName},,0,0,0,,${text}`);
    }

    const assPath = path.join(tempDir, 'subtitles.ass');
    fs.writeFileSync(assPath, lines.join('\n'), 'utf-8');
    return assPath;
}

app.post('/api/merge-videos', authMiddleware, mergeUpload.any(), async (req, res) => {
    const uid = String(req.userId);
    const tempDir = path.join(storageService.getTempDir(), `merge_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        if (!req.body) {
            return res.status(400).json({ error: 'Empty request body – expected multipart form data' });
        }
        const rawVideos = JSON.parse(req.body.videos || '[]');
        const videos = rawVideos.map(v => {
            if (typeof v === 'string') return { url: v, volume: 1, trimIn: 0, trimOut: null, speed: 1 };
            const speed = v.speed != null && !Number.isNaN(Number(v.speed)) ? Math.max(0.25, Math.min(4, Number(v.speed))) : 1;
            return {
                url: v.url,
                volume: v.volume ?? 1,
                trimIn: v.trimIn != null && !Number.isNaN(Number(v.trimIn)) ? Number(v.trimIn) : 0,
                trimOut: v.trimOut != null && !Number.isNaN(Number(v.trimOut)) ? Number(v.trimOut) : null,
                speed,
            };
        });
        const transition = req.body.transition || 'fade';
        const transitionDuration = parseFloat(req.body.transitionDuration) || 0.5;
        const MAX_AUDIO_TRACKS = 20;
        let audioTracksMeta = [];
        try { audioTracksMeta = JSON.parse(req.body.audioTracks || '[]'); } catch (_) {}
        if (audioTracksMeta.length > MAX_AUDIO_TRACKS) {
            return res.status(400).json({ error: `Too many audio tracks (max ${MAX_AUDIO_TRACKS})` });
        }
        let subtitleTracks = [];
        try { subtitleTracks = JSON.parse(req.body.subtitleTracks || '[]'); } catch (_) {}

        const ALLOWED_WIDTHS = [720, 1080, 1280, 1920, 3840];
        const ALLOWED_HEIGHTS = [720, 1080, 1280, 1920, 2160];
        const outW = ALLOWED_WIDTHS.includes(parseInt(req.body.outputWidth)) ? parseInt(req.body.outputWidth) : 1920;
        const outH = ALLOWED_HEIGHTS.includes(parseInt(req.body.outputHeight)) ? parseInt(req.body.outputHeight) : 1080;

        if (!videos || !Array.isArray(videos) || videos.length < 2) {
            return res.status(400).json({ error: 'At least 2 video URLs are required' });
        }
        if (videos.length > 20) {
            return res.status(400).json({ error: 'Maximum 20 videos allowed' });
        }

        const ffmpegOk = await isFFmpegAvailable();
        if (!ffmpegOk) {
            return res.status(500).json({ error: 'FFmpeg is not installed on the server' });
        }

        // Collect uploaded audio files
        const audioFilePaths = [];
        for (let i = 0; i < audioTracksMeta.length; i++) {
            const meta = audioTracksMeta[i];
            const uploadedFile = (req.files || []).find(f => f.fieldname === `audio_${i}`);
            if (uploadedFile) {
                const dest = path.join(tempDir, `audio_input_${i}${path.extname(uploadedFile.originalname) || '.mp3'}`);
                fs.copyFileSync(uploadedFile.path, dest);
                audioFilePaths.push({ path: dest, startTime: meta.startTime || 0, volume: meta.volume ?? 0.7 });
            }
        }

        // Download all source videos to temp
        const inputPaths = [];
        for (let i = 0; i < videos.length; i++) {
            const rawUrl = videos[i].url.split('?')[0];
            const tmpPath = path.join(tempDir, `input_${i}.mp4`);

            // Check if the URL points to our own server — resolve locally instead of HTTP fetch
            const selfUrlMatch = rawUrl.match(/^https?:\/\/[\w.\-]+:3001(\/library\/videos\/.+)/);
            const libPathDirect = rawUrl.match(/^\/library\/videos\/(.+)/);

            if (selfUrlMatch || libPathDirect) {
                const relPath = selfUrlMatch ? selfUrlMatch[1].replace('/library/videos/', '') : libPathDirect[1];
                const localPath = safeLibraryPath(VIDEOS_DIR, relPath);
                if (!localPath) return res.status(400).json({ error: `Invalid video path: ${rawUrl}` });
                if (!fs.existsSync(localPath)) return res.status(404).json({ error: `Video not found: ${rawUrl}` });
                fs.copyFileSync(localPath, tmpPath);
            } else if (rawUrl.startsWith('http')) {
                const urlCheck = validateExternalUrl(rawUrl, { allowPrivate: true });
                if (!urlCheck.valid) return res.status(400).json({ error: `Invalid video URL: ${urlCheck.reason}` });
                const fetchUrl = toInternalOssUrl(rawUrl);
                const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(120_000) });
                if (!resp.ok) return res.status(400).json({ error: `Failed to download: ${rawUrl}` });
                fs.writeFileSync(tmpPath, Buffer.from(await resp.arrayBuffer()));
            } else {
                const libIdx = rawUrl.indexOf('/library/videos/');
                if (libIdx === -1) return res.status(400).json({ error: `Invalid video URL: ${rawUrl}` });
                const localPath = safeLibraryPath(VIDEOS_DIR, rawUrl.substring(libIdx).replace('/library/videos/', ''));
                if (!localPath) return res.status(400).json({ error: `Invalid video path: ${rawUrl}` });
                if (!fs.existsSync(localPath)) return res.status(404).json({ error: `Video not found: ${rawUrl}` });
                fs.copyFileSync(localPath, tmpPath);
            }

            const probeDur = await getVideoDuration(tmpPath);
            const MIN_SEG = 0.04;
            const SALVAGE_EPS = 0.0005;

            const rawTi = videos[i].trimIn != null ? Number(videos[i].trimIn) : 0;
            const ti = Math.max(0, Math.min(Number.isFinite(rawTi) ? rawTi : 0, Math.max(0, probeDur - MIN_SEG)));
            let to = videos[i].trimOut != null && videos[i].trimOut !== ''
                ? Number(videos[i].trimOut)
                : probeDur;
            if (!Number.isFinite(to)) to = probeDur;
            to = Math.max(ti + MIN_SEG, Math.min(to, probeDur));

            const trimLen = to - ti;
            const removedStart = ti;
            const removedEnd = Math.max(0, probeDur - to);
            const salvageTotal = removedStart + removedEnd;
            const FULL_EPS = 0.002;
            const spansFull =
                probeDur > 0 &&
                removedStart <= FULL_EPS &&
                removedEnd <= FULL_EPS;

            let pathForPipeline = tmpPath;
            const shouldTrimSegment =
                probeDur > SALVAGE_EPS &&
                trimLen + SALVAGE_EPS >= MIN_SEG &&
                !spansFull;

            if (shouldTrimSegment) {
                const trimmedPath = path.join(tempDir, `trim_${i}.mp4`);
                try {
                    await trimVideoSegment(tmpPath, trimmedPath, ti, trimLen);
                    pathForPipeline = trimmedPath;
                    console.log(
                        `[Video Merge] clip ${i + 1} trimmed ${ti.toFixed(3)}–${to.toFixed(3)}s (probe ${probeDur.toFixed(3)}s, salvage ~${salvageTotal.toFixed(3)}s)`
                    );
                } catch (trimErr) {
                    console.error(`[Video Merge] FFmpeg trim failed for clip ${i + 1}:`, trimErr.message || trimErr);
                    throw new Error(
                        `Failed to trim clip ${i + 1} (${trimErr.message || 'ffmpeg error'}). Check server FFmpeg.`
                    );
                }
            }

            inputPaths.push(pathForPipeline);
        }

        const n = inputPaths.length;
        const td = Math.max(0.1, Math.min(transitionDuration, 3));
        const ts = Date.now();
        const hash = crypto.randomBytes(4).toString('hex');

        console.log(`[Video Merge] ${n} videos, ${audioFilePaths.length} audio tracks, transition=${transition}, duration=${td}s`);

        const normalizedPaths = [];
        const durations = [];
        for (let i = 0; i < n; i++) {
            const withAudio = path.join(tempDir, `audio_${i}.mp4`);
            await ensureAudio(inputPaths[i], withAudio);

            const norm = path.join(tempDir, `norm_${i}.mp4`);
            const vol = Math.max(0, Math.min(2, videos[i].volume ?? 1));
            const speed = videos[i].speed ?? 1;

            let vfChain = `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
            if (speed !== 1) {
                vfChain += `,setpts=PTS/${speed.toFixed(4)}`;
            }

            let afParts = ['aformat=sample_rates=44100:channel_layouts=stereo'];
            if (vol !== 1) afParts.push(`volume=${vol.toFixed(2)}`);
            if (speed !== 1) {
                // atempo only supports 0.5–2.0 per instance; chain for wider ranges
                let remaining = speed;
                while (remaining > 2.0) { afParts.push('atempo=2.0'); remaining /= 2.0; }
                while (remaining < 0.5) { afParts.push('atempo=0.5'); remaining /= 0.5; }
                if (Math.abs(remaining - 1.0) > 0.001) afParts.push(`atempo=${remaining.toFixed(4)}`);
            }
            const afFilter = afParts.join(',');

            await runFFmpeg([
                '-y', '-i', withAudio,
                '-vf', vfChain,
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                '-af', afFilter,
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                norm
            ]);
            normalizedPaths.push(norm);
            durations.push(await getVideoDuration(norm));
        }

        const mergedNoAudioFilename = `merged_raw_${ts}_${hash}.mp4`;
        const mergedNoAudioPath = path.join(tempDir, mergedNoAudioFilename);

        if (transition === 'none' || n === 2 && durations.some(d => d <= td)) {
            const listFile = path.join(tempDir, 'list.txt');
            fs.writeFileSync(listFile, normalizedPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
            await runFFmpeg([
                '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart', mergedNoAudioPath
            ]);
        } else {
            const parts = [];
            let prevV = '0:v';
            let offset = durations[0] - td;
            for (let i = 1; i < n; i++) {
                const out = i < n - 1 ? `xf${i}` : 'vout';
                parts.push(`[${prevV}][${i}:v]xfade=transition=${transition}:duration=${td}:offset=${Math.max(0, offset).toFixed(3)}[${out}]`);
                prevV = out;
                if (i < n - 1) offset += durations[i] - td;
            }
            let prevA = '0:a';
            for (let i = 1; i < n; i++) {
                const out = i < n - 1 ? `af${i}` : 'aout';
                parts.push(`[${prevA}][${i}:a]acrossfade=d=${td}:c1=tri:c2=tri[${out}]`);
                prevA = out;
            }

            const inputs = normalizedPaths.flatMap(p => ['-i', p]);
            await runFFmpeg([
                '-y', ...inputs,
                '-filter_complex', parts.join(';'),
                '-map', '[vout]', '-map', '[aout]',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                mergedNoAudioPath
            ]);
        }

        // Mix in additional audio tracks if any
        const outputFilename = `merged_${ts}_${hash}.mp4`;
        const outputPath = path.join(tempDir, outputFilename);

        if (audioFilePaths.length > 0) {
            const totalDur = await getVideoDuration(mergedNoAudioPath);

            const inputArgs = ['-y', '-i', mergedNoAudioPath];
            for (const at of audioFilePaths) {
                inputArgs.push('-i', at.path);
            }

            // Build the amix filter: video's audio [0:a] + each additional track delayed & volume-adjusted
            const filterParts = [];
            const mixInputs = [];

            // Video's original audio stream
            filterParts.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo[vorig]`);
            mixInputs.push('[vorig]');

            for (let ai = 0; ai < audioFilePaths.length; ai++) {
                const at = audioFilePaths[ai];
                const delayMs = Math.round(Math.max(0, at.startTime) * 1000);
                const vol = Math.max(0, Math.min(2, at.volume));
                const label = `aud${ai}`;
                filterParts.push(
                    `[${ai + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${delayMs}|${delayMs},volume=${vol.toFixed(2)}[${label}]`
                );
                mixInputs.push(`[${label}]`);
            }

            filterParts.push(
                `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=2[aout]`
            );

            await runFFmpeg([
                ...inputArgs,
                '-filter_complex', filterParts.join(';'),
                '-map', '0:v', '-map', '[aout]',
                '-c:v', 'copy',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                outputPath
            ]);
        } else {
            fs.renameSync(mergedNoAudioPath, outputPath);
        }

        // Burn-in subtitles if provided
        if (subtitleTracks.length > 0) {
            const assPath = generateASSFile(subtitleTracks, tempDir, outW, outH);
            if (assPath) {
                const subtitledPath = path.join(tempDir, `subtitled_${ts}_${hash}.mp4`);
                const assPathEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
                await runFFmpeg([
                    '-y', '-i', outputPath,
                    '-vf', `ass='${assPathEscaped}',format=yuv420p`,
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'copy',
                    '-movflags', '+faststart',
                    subtitledPath
                ]);
                fs.renameSync(subtitledPath, outputPath);
                console.log(`[Video Merge] Subtitles burned in from ${assPath}`);
            }
        }

        // Upload merged result to OSS
        const saved = await storageService.uploadTempFileAsVideo(outputPath, {
            userId: uid,
            prompt: `Merged ${n} videos (${transition})`,
            model: 'video-editor',
        });

        res.json({ url: saved.ossUrl, filename: saved.filename });
    } catch (err) {
        console.error('[Video Merge] Error:', err);
        res.status(500).json({ error: err.message || 'Video merge failed' });
    } finally {
        // Clean up multer temp files
        for (const f of (req.files || [])) {
            try { fs.unlinkSync(f.path); } catch (_) {}
        }
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
});

// ============================================================================
// AUDIO EXTRACTOR
// ============================================================================

function isYtDlpAvailable() {
    return new Promise((resolve) => {
        const proc = spawn('yt-dlp', ['--version']);
        proc.on('close', code => resolve(code === 0));
        proc.on('error', () => resolve(false));
    });
}

function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(-500)}`)));
        proc.on('error', reject);
    });
}

function normalizeVideoUrl(rawUrl) {
    try {
        const u = new URL(rawUrl);
        if (u.hostname.includes('douyin.com')) {
            const modalId = u.searchParams.get('modal_id');
            if (modalId && /^\d+$/.test(modalId)) {
                return `https://www.douyin.com/video/${modalId}`;
            }
        }
    } catch (_) {}
    return rawUrl;
}

const CHROME_PATHS = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
];

function findChrome() {
    for (const p of CHROME_PATHS) { if (fs.existsSync(p)) return p; }
    return null;
}

async function downloadWithBrowser(sourceUrl, destPath) {
    const chromePath = findChrome();
    if (!chromePath) throw new Error('Chrome/Chromium not found');

    const puppeteer = (await import('puppeteer-core')).default;
    console.log(`[AudioExtract] Browser fallback: ${sourceUrl}`);
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--no-first-run',
        ],
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Block heavy / irrelevant resources to (a) speed up navigation and (b) keep the page
        // from chasing networkidle. We only need the page's own JS to fire its API requests
        // (douyin /aweme/detail, bilibili /x/player/playurl, etc).
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (type === 'image' || type === 'media' || type === 'font' || type === 'stylesheet') {
                req.abort().catch(() => {});
            } else {
                req.continue().catch(() => {});
            }
        });

        let mediaUrl = null;
        let mediaResolve;
        const mediaPromise = new Promise((resolve) => { mediaResolve = resolve; });
        const setMedia = (url, label) => {
            if (mediaUrl) return;
            mediaUrl = url;
            console.log(`[AudioExtract] Browser: ${label}`);
            mediaResolve();
        };

        page.on('response', async (resp) => {
            if (mediaUrl) return;
            const url = resp.url();
            const ct = resp.headers()['content-type'] || '';

            // Douyin: intercept aweme detail API
            if (url.includes('/aweme/v1/web/aweme/detail')) {
                try {
                    const json = JSON.parse(await resp.text());
                    const playUrl = json?.aweme_detail?.video?.play_addr?.url_list?.[0];
                    if (playUrl) setMedia(playUrl, 'Douyin API hit');
                } catch (_) {}
                return;
            }
            // Bilibili: intercept playurl API for DASH audio
            if (url.includes('/x/player/') && url.includes('playurl')) {
                try {
                    const json = JSON.parse(await resp.text());
                    const dash = json?.data?.dash;
                    const audioUrl = dash?.audio?.[0]?.baseUrl || dash?.audio?.[0]?.base_url;
                    if (audioUrl) {
                        setMedia(audioUrl, 'Bilibili playurl API hit (audio)');
                    } else {
                        const videoUrlFb = dash?.video?.[0]?.baseUrl || json?.data?.durl?.[0]?.url;
                        if (videoUrlFb) setMedia(videoUrlFb, 'Bilibili playurl API hit (video)');
                    }
                } catch (_) {}
                return;
            }
            // Generic: any direct video/audio stream from CDN
            if (ct.includes('video/') && resp.status() === 200) {
                const len = parseInt(resp.headers()['content-length'] || '0', 10);
                if (len > 500000) setMedia(url, 'generic video stream hit');
            }
        });

        // Use `domcontentloaded` instead of `networkidle2` — Bilibili keeps firing analytics /
        // danmaku polling, so the page never reaches networkidle2 and the navigation always
        // times out at 25s on a cold start. With domcontentloaded we return as soon as the
        // page DOM is ready and let the response listener race for the playurl/aweme API.
        try {
            await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (gotoErr) {
            // Even if goto throws (e.g., aborted because we already got the API hit), keep going.
            if (!mediaUrl) throw gotoErr;
        }

        // Wait up to 25s for the response interceptor to capture the media URL.
        await Promise.race([
            mediaPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Could not find media URL on the page (timeout)')), 25000)),
        ]);

        if (!mediaUrl) throw new Error('Could not find media URL on the page');
        console.log(`[AudioExtract] Browser got media URL: ${mediaUrl.slice(0, 120)}...`);

        const referer = new URL(sourceUrl).origin + '/';
        const cookies = await page.cookies();
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        const dlResp = await fetch(mediaUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': referer,
                'Cookie': cookieStr,
            },
            signal: AbortSignal.timeout(120000),
        });
        if (!dlResp.ok) throw new Error(`Media download failed: HTTP ${dlResp.status}`);

        const buf = Buffer.from(await dlResp.arrayBuffer());
        fs.writeFileSync(destPath, buf);
        console.log(`[AudioExtract] Browser download OK: ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
    } finally {
        await browser.close();
    }
}

async function tryCobaltInstance(apiUrl, sourceUrl, destPath) {
    const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl, downloadMode: 'audio', audioFormat: 'wav' }),
        signal: AbortSignal.timeout(15000),
    });

    const data = await resp.json();
    if (data.status === 'error') {
        throw new Error(data.error?.code || 'unknown');
    }

    const streamUrl = data.url;
    if (!streamUrl) throw new Error('no download URL');

    const dlResp = await fetch(streamUrl, { signal: AbortSignal.timeout(120000) });
    if (!dlResp.ok) throw new Error(`HTTP ${dlResp.status}`);

    const arrayBuf = await dlResp.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuf));
    console.log(`[AudioExtract] Cobalt OK via ${apiUrl}: ${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)}MB`);
}

async function discoverCobaltInstances() {
    try {
        const resp = await fetch('https://instances.cobalt.best/instances.json', {
            headers: { 'User-Agent': 'chuhaibang-workflow/1.0 (+https://github.com)' },
            signal: AbortSignal.timeout(5000),
        });
        const list = await resp.json();
        return list
            .filter(i => i.online && i.info?.auth === false && i.score >= 30)
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map(i => `https://${i.api}/`);
    } catch {
        return [];
    }
}

async function downloadWithCobalt(sourceUrl, destPath) {
    const configured = process.env.COBALT_API_URL;
    const candidates = configured ? [configured] : [];

    const discovered = await discoverCobaltInstances();
    candidates.push(...discovered.filter(u => u !== configured));

    if (candidates.length === 0) {
        throw new Error('No cobalt instances available');
    }

    console.log(`[AudioExtract] Cobalt fallback: ${sourceUrl} (${candidates.length} instances)`);
    const errors = [];
    for (const apiUrl of candidates) {
        try {
            await tryCobaltInstance(apiUrl, sourceUrl, destPath);
            return;
        } catch (err) {
            console.log(`[AudioExtract] Cobalt ${apiUrl} failed: ${err.message}`);
            errors.push(`${apiUrl}: ${err.message}`);
        }
    }
    throw new Error(`All cobalt instances failed:\n${errors.join('\n')}`);
}

// ============================================================================
// TTS (Text-to-Speech) — 火山引擎豆包语音合成
// ============================================================================

app.get('/api/tts/voices', authMiddleware, async (req, res) => {
    const model = req.query.model || 'seed-tts-2.0';
    const cacheKey = `tts_voices:${model}`;

    const redis = getRedisClient();
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return res.json(JSON.parse(cached));
        } catch {}
    }

    const accessKey = process.env.VOLC_ACCESS_KEY;
    const secretKey = process.env.VOLC_SECRET_KEY;

    if (!accessKey || !secretKey) {
        return res.status(500).json({ error: 'VOLC_ACCESS_KEY / VOLC_SECRET_KEY not configured on server' });
    }

    try {
        const result = await volcTts.listSpeakersAll({ accessKey, secretKey, resourceId: model });
        if (redis) redis.set(cacheKey, JSON.stringify(result)).catch(() => {});
        res.json(result);
    } catch (err) {
        console.error('[TTS Voices] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Voice clone: train a new voice from uploaded audio
const cloneUpload = multer({ dest: storageService.getTempDir(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/tts/clone', authMiddleware, cloneUpload.single('audio'), async (req, res) => {
    const apiKey = process.env.VOLC_TTS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'VOLC_TTS_API_KEY is not configured on server' });

    try {
        const { speakerId, language, enableDenoise, demoText } = req.body;
        if (!speakerId) return res.status(400).json({ error: 'speakerId is required' });
        if (!req.file) return res.status(400).json({ error: 'Audio file is required' });

        await checkBalance(req.userId, VOLC_TTS_CLONE_MODEL_ID);

        const audioBuffer = fs.readFileSync(req.file.path);
        const audioBase64 = audioBuffer.toString('base64');
        const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
        const audioFormat = ['pcm', 'm4a', 'wav', 'mp3', 'ogg', 'aac'].includes(ext) ? ext : undefined;

        const result = await volcTts.trainVoice({
            apiKey,
            speakerId,
            audioBase64,
            audioFormat,
            language: parseInt(language) || 0,
            enableDenoise: enableDenoise === 'true' || enableDenoise === true,
            demoText: demoText || undefined,
        });

        res.json(result);

        const price = await getModelPrice(VOLC_TTS_CLONE_MODEL_ID);
        const cost = calculateCost(price);
        logUsage({ userId: req.userId, type: 'text', model: VOLC_TTS_CLONE_MODEL_ID, prompt: `tts-clone:${speakerId}`, cost, status: 'success' });
    } catch (err) {
        if (err.status === 402) return res.status(402).json({ error: err.message });
        console.error('[Voice Clone] Error:', err.message);
        logUsage({ userId: req.userId, type: 'text', model: VOLC_TTS_CLONE_MODEL_ID, prompt: 'tts-clone', cost: 0, status: 'failed' });
        res.status(500).json({ error: err.message });
    } finally {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    }
});

// Voice clone: query training status
app.get('/api/tts/clone/:speakerId', authMiddleware, async (req, res) => {
    const apiKey = process.env.VOLC_TTS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'VOLC_TTS_API_KEY is not configured on server' });

    try {
        const result = await volcTts.getVoiceStatus({ apiKey, speakerId: req.params.speakerId });
        res.json(result);
    } catch (err) {
        console.error('[Voice Clone Status] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tts', authMiddleware, async (req, res) => {
    const uid = String(req.userId);
    const apiKey = process.env.VOLC_TTS_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'VOLC_TTS_API_KEY is not configured on server' });
    }

    const {
        text,
        speaker,
        model = 'seed-tts-2.0',
        format = 'mp3',
        sampleRate = 24000,
        bitRate,
        speechRate,
        loudnessRate,
        emotion,
        emotionScale,
        pitch,
        contextTexts,
        enableSubtitle,
        silenceDuration,
    } = req.body;

    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
    }
    if (!speaker || typeof speaker !== 'string') {
        return res.status(400).json({ error: 'speaker is required' });
    }

    try {
        await checkBalance(req.userId, VOLC_TTS_MODEL_ID);

        const result = await volcTts.synthesize({
            apiKey,
            text,
            speaker,
            model,
            format,
            sampleRate,
            bitRate,
            speechRate,
            loudnessRate,
            emotion,
            emotionScale,
            pitch,
            contextTexts,
            enableSubtitle,
            silenceDuration,
            uid,
        });

        const ext = format === 'ogg_opus' ? 'ogg' : format;
        const saved = await storageService.saveAudioFile(result.audioBuffer, { userId: uid, ext });

        console.log(`[TTS] Saved: ${saved.ossUrl} (${(result.audioBuffer.length / 1024).toFixed(1)} KB)`);

        // Cache hits from Volcengine don't include subtitles — fall back to stored subtitles
        let subtitles = result.subtitles;
        if (!subtitles) {
            try {
                const pool = getPool();
                if (pool) {
                    const [rows] = await pool.execute(
                        'SELECT subtitles FROM tts_history WHERE user_id = ? AND text = ? AND speaker = ? AND subtitles IS NOT NULL ORDER BY created_at DESC LIMIT 1',
                        [Number(uid), text, speaker]
                    );
                    if (rows.length > 0 && rows[0].subtitles) {
                        subtitles = typeof rows[0].subtitles === 'string' ? JSON.parse(rows[0].subtitles) : rows[0].subtitles;
                        console.log(`[TTS] Cache hit — restored ${subtitles?.length || 0} subtitle segments from history`);
                    }
                }
            } catch (subErr) {
                console.warn('[TTS] Failed to restore subtitles from history:', subErr.message);
            }
        }

        const responseData = {
            audioUrl: saved.ossUrl,
            filename: saved.filename,
            format: result.format,
            size: result.audioBuffer.length,
            usage: result.usage,
            subtitles,
        };
        res.json(responseData);

        // Save to tts_history (non-blocking)
        try {
            const pool = getPool();
            if (pool) {
                const synthParams = JSON.stringify({ speechRate, loudnessRate, emotion, emotionScale, pitch, toneHint: req.body.contextTexts?.[0] || null });
                await pool.execute(
                    `INSERT INTO tts_history (user_id, text, speaker, model, audio_url, filename, format, size, duration_chars, params, subtitles) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [Number(uid), text, speaker, model, saved.ossUrl, saved.filename, format, result.audioBuffer.length, result.usage?.text_words || text.length, synthParams, subtitles ? JSON.stringify(subtitles) : null]
                );
                console.log(`[TTS History] Saved for user ${uid}`);
            }
        } catch (histErr) {
            console.error('[TTS History] Save failed:', histErr.message);
        }

        try {
            const charCount = result.usage?.text_words || text.length;
            const price = await getModelPrice(VOLC_TTS_MODEL_ID);
            const cost = calculateCost(price, { tokens: charCount });
            logUsage({ userId: req.userId, type: 'text', model: VOLC_TTS_MODEL_ID, prompt: text.substring(0, 200), cost, tokens: charCount, status: 'success' });
        } catch (billingErr) { console.error('[TTS] Billing error:', billingErr.message); }
        return;
    } catch (err) {
        if (err.status === 402) return res.status(402).json({ error: err.message });
        console.error('[TTS] Error:', err);
        logUsage({ userId: req.userId, type: 'text', model: VOLC_TTS_MODEL_ID, prompt: text.substring(0, 200), cost: 0, tokens: 0, status: 'failed' });
        res.status(500).json({ error: err.message || 'TTS synthesis failed' });
    }
});

// TTS history list
app.get('/api/tts/history', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;
        const pool = getPool();
        if (!pool) return res.json({ items: [], total: 0 });

        const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM tts_history WHERE user_id = ?', [uid]);
        const [rows] = await pool.execute(
            `SELECT id, text, speaker, model, audio_url, filename, format, size, duration_chars, params, subtitles, created_at FROM tts_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
            [uid]
        );

        const items = rows.map(r => ({
            id: r.id,
            text: r.text,
            speaker: r.speaker,
            model: r.model,
            audioUrl: r.audio_url,
            filename: r.filename,
            format: r.format,
            size: r.size,
            durationChars: r.duration_chars,
            params: typeof r.params === 'string' ? JSON.parse(r.params) : r.params,
            subtitles: typeof r.subtitles === 'string' ? JSON.parse(r.subtitles) : r.subtitles,
            createdAt: r.created_at,
        }));

        res.json({ items, total });
    } catch (err) {
        console.error('[TTS History] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// TTS text format (AI punctuation + cleanup)
/** Local-only fallback: strip noise + collapse whitespace + naive sentence splitting. */
function formatTextLocally(input) {
    let cleaned = String(input || '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/#+\s*/g, '')
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}]/gu, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
    return splitIntoSentences(cleaned);
}

/**
 * Normalize a block of text into one-sentence-per-line.
 * Splits on Chinese (。！？) and English (.!?) sentence-ending punct,
 * preserves the punctuation, ignores already-existing newlines.
 */
function splitIntoSentences(input) {
    const flattened = String(input || '').replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim();
    if (!flattened) return '';
    // Insert a marker after every sentence-ending punct (incl. trailing quotes/brackets)
    // when followed by another non-space char.
    const withBreaks = flattened.replace(/([。！？!?]+["'」』）)】\]》>]*)\s*(?=[^\s])/g, '$1\n');
    return withBreaks.split('\n').map(s => s.trim()).filter(Boolean).join('\n');
}

app.post('/api/tts/format-text', authMiddleware, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({ error: 'text is required' });
        }

        await checkBalance(req.userId, CHAT_FAST_MODEL);

        // Compact prompt — every token saved is latency saved.
        // Sentence-splitting is enforced server-side via splitIntoSentences() so we do
        // not need to rely on the model getting newlines exactly right.
        const prompt = `Clean this text for TTS playback. Strip URLs/markdown/HTML/emoji, collapse whitespace, add natural punctuation. Keep meaning identical — do not rewrite or translate. Output only the cleaned text.

${text.trim()}`;

        // Fast path: lightweight model + thinking explicitly disabled + tight timeout.
        // Formatting is mechanical cleanup, not reasoning — thinking adds latency for no benefit.
        // Falls back to local regex cleanup if the LLM is slow / errors out so the user never waits.
        try {
            const t0 = Date.now();
            const result = await callChatTextWithImages(prompt, [], {
                model: CHAT_FAST_MODEL,
                timeoutMs: 8_000,
                temperature: 0.2,
                maxTokens: 1024,
                disableThinking: true,
            });
            const elapsed = Date.now() - t0;
            const raw = result?.text?.trim();
            const tokens = result?.totalTokens || 0;
            console.log(`[TTS Format] ${CHAT_FAST_MODEL} returned in ${elapsed}ms (${tokens} tokens)`);
            if (raw) {
                const formatted = splitIntoSentences(raw);
                res.json({ text: formatted, source: 'llm', model: CHAT_FAST_MODEL, latencyMs: elapsed });

                try {
                    const price = await getModelPrice(CHAT_FAST_MODEL);
                    const cost = calculateCost(price, { tokens });
                    logUsage({ userId: req.userId, type: 'text', model: CHAT_FAST_MODEL, prompt: 'tts-format-text', cost, tokens, status: 'success' });
                } catch (billingErr) { console.error('[TTS Format] Billing error:', billingErr.message); }
                return;
            }
            // No content returned — local fallback, no billing
            return res.json({ text: formatTextLocally(text), source: 'local' });
        } catch (llmErr) {
            console.warn('[TTS Format] Fast LLM failed, falling back to local cleanup:', llmErr.message);
            // Local fallback path — no model used, no billing
            return res.json({ text: formatTextLocally(text), source: 'local' });
        }
    } catch (err) {
        if (err.status === 402) return res.status(402).json({ error: err.message });
        console.error('[TTS Format] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// TTS history delete
app.delete('/api/tts/history/:id', authMiddleware, async (req, res) => {
    try {
        const uid = String(req.userId);
        const id = Number(req.params.id);
        if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const pool = getPool();
        if (!pool) return res.status(500).json({ error: 'Database not available' });

        const [result] = await pool.execute('DELETE FROM tts_history WHERE id = ? AND user_id = ?', [id, uid]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (err) {
        console.error('[TTS History] Delete error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// INDEX-TTS — 参考音色克隆（upload + tts_url 代理）
// ============================================================================

const INDEX_TTS_BASE = (process.env.INDEX_TTS_BASE || 'https://your-ai-service.example.com/index-tts').replace(/\/+$/, '');
const indexTtsRefUpload = multer({ dest: storageService.getTempDir(), limits: { fileSize: 50 * 1024 * 1024 } });

function normalizeIndexTtsSavedPath(saved) {
    if (!saved || typeof saved !== 'string') return saved;
    return saved.replace(/^assets\//, '');
}

app.post('/api/index-tts/reference', authMiddleware, indexTtsRefUpload.single('audio'), async (req, res) => {
    const uid = String(req.userId);
    const apiKey = process.env.INDEX_TTS_API_KEY;
    if (!apiKey) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(500).json({ error: 'INDEX_TTS_API_KEY is not configured on server' });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'reference audio file is required' });
    }

    const ext = (path.extname(req.file.originalname) || '').toLowerCase();
    if (ext !== '.wav') {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: 'Reference audio must be WAV format (.wav)' });
    }

    try {
        const audioBuffer = fs.readFileSync(req.file.path);
        const safeBase = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, '_') || 'reference.wav';
        const remotePath = `workflow_u${uid}/${Date.now()}_${safeBase}`;

        // Use native FormData + Blob so undici (Node fetch) generates a valid boundary header.
        // `form-data` package's FormData isn't reliably supported as a body for native fetch.
        const form = new globalThis.FormData();
        const blob = new Blob([audioBuffer], { type: 'audio/wav' });
        form.append('files', blob, path.basename(safeBase));
        form.append('paths', remotePath);

        const upstream = await fetch(`${INDEX_TTS_BASE}/upload`, {
            method: 'POST',
            headers: {
                'api-key': apiKey,
            },
            body: form,
            signal: AbortSignal.timeout(120_000),
        });

        const rawBody = Buffer.from(await upstream.arrayBuffer());
        if (!upstream.ok) {
            const rawText = rawBody.toString('utf8');
            console.error(`[Index-TTS] upload upstream ${upstream.status} | content-type: ${upstream.headers.get('content-type')} | body:`, rawText.slice(0, 1000));
            let msg = `Upload failed (${upstream.status})`;
            try {
                const j = JSON.parse(rawText);
                if (j.detail) {
                    msg = Array.isArray(j.detail)
                        ? j.detail.map((d) => `${(d.loc || []).join('.')}: ${d.msg}`).join('; ')
                        : (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail));
                } else if (j.error || j.message) {
                    msg = j.error || j.message;
                }
            } catch (_) {
                if (rawText) msg = rawText.slice(0, 300);
            }
            return res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502).json({ error: msg });
        }

        let data;
        try {
            data = JSON.parse(rawBody.toString('utf8'));
        } catch (_) {
            return res.status(502).json({ error: 'Invalid JSON from Index-TTS upload' });
        }
        if (data.status !== 'ok' || !Array.isArray(data.saved)) {
            return res.status(502).json({ error: data.message || data.error || 'Index-TTS upload rejected' });
        }

        const audioPaths = data.saved.map((p) => normalizeIndexTtsSavedPath(p)).filter(Boolean);
        console.log('[Index-TTS] reference uploaded:', audioPaths);

        res.json({
            audioPaths,
            savedRaw: data.saved,
        });
    } catch (err) {
        console.error('[Index-TTS] reference:', err.message);
        res.status(500).json({ error: err.message || 'Upload failed' });
    } finally {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    }
});

app.post('/api/index-tts/synthesize', authMiddleware, async (req, res) => {
    const uid = String(req.userId);
    const apiKey = process.env.INDEX_TTS_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'INDEX_TTS_API_KEY is not configured on server' });
    }

    const { text, audio_paths: audioPaths, seed } = req.body || {};
    if (!text || typeof text !== 'string' || !String(text).trim()) {
        return res.status(400).json({ error: 'text is required' });
    }
    if (!audioPaths || !Array.isArray(audioPaths) || audioPaths.length === 0 || !audioPaths.every((p) => typeof p === 'string' && String(p).trim())) {
        return res.status(400).json({ error: 'audio_paths must be a non-empty array of strings' });
    }

    const payload = { text: String(text).trim(), audio_paths: audioPaths.map((p) => String(p).trim()) };
    if (seed != null && Number.isFinite(Number(seed))) {
        payload.seed = Math.floor(Number(seed));
    }

    try {
        await checkBalance(req.userId, INDEX_TTS_MODEL_ID);

        const upstream = await fetch(`${INDEX_TTS_BASE}/tts_url`, {
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(180_000),
        });

        const buf = Buffer.from(await upstream.arrayBuffer());
        const ct = (upstream.headers.get('content-type') || '').toLowerCase();

        if (!upstream.ok) {
            const rawText = buf.toString('utf8');
            console.error(`[Index-TTS] synth upstream ${upstream.status} | content-type: ${ct} | body:`, rawText.slice(0, 1000));
            let msg = `Synthesis failed (${upstream.status})`;
            try {
                const j = JSON.parse(rawText);
                if (j.detail) {
                    msg = Array.isArray(j.detail)
                        ? j.detail.map((d) => `${(d.loc || []).join('.')}: ${d.msg}`).join('; ')
                        : (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail));
                } else if (j.error || j.message) {
                    msg = j.error || j.message;
                }
            } catch (_) {
                if (rawText) msg = rawText.slice(0, 300);
            }
            return res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502).json({ error: msg });
        }

        if (ct.includes('application/json') || ct.includes('text/json')) {
            try {
                const j = JSON.parse(buf.toString('utf8'));
                return res.status(502).json({ error: j.error || j.message || 'Index-TTS returned JSON instead of audio' });
            } catch (_) {
                return res.status(502).json({ error: 'Invalid JSON response from Index-TTS' });
            }
        }

        const saved = await storageService.saveAudioFile(buf, { userId: uid, ext: 'wav' });

        console.log(`[Index-TTS] synthesized → ${saved.ossUrl}`);

        res.json({
            audioUrl: saved.ossUrl,
            filename: saved.filename,
            format: 'wav',
            size: buf.length,
        });

        try {
            const charCount = String(text).trim().length;
            const price = await getModelPrice(INDEX_TTS_MODEL_ID);
            const cost = calculateCost(price, { tokens: charCount });
            logUsage({ userId: req.userId, type: 'text', model: INDEX_TTS_MODEL_ID, prompt: String(text).substring(0, 200), cost, tokens: charCount, status: 'success' });
        } catch (billingErr) { console.error('[Index-TTS] Billing error:', billingErr.message); }
        return;
    } catch (err) {
        if (err.status === 402) return res.status(402).json({ error: err.message });
        console.error('[Index-TTS] synthesize:', err.message);
        logUsage({ userId: req.userId, type: 'text', model: INDEX_TTS_MODEL_ID, prompt: String(text).substring(0, 200), cost: 0, tokens: 0, status: 'failed' });
        res.status(500).json({ error: err.message || 'Synthesis failed' });
    }
});

// ============================================================================
// FASTER-WHISPER — 音频转字幕（代理 verbose_json 转写接口）
// ============================================================================

const FASTER_WHISPER_BASE = (process.env.FASTER_WHISPER_BASE || 'https://your-ai-service.example.com/faster-whisper').replace(/\/+$/, '');

/** Taiwan Traditional → Mainland Simplified (used when zh-TW Whisper model outputs 繁体). */
const twTraditionalToSimplified = openccTwToCn({ from: 'tw', to: 'cn' });

/**
 * Transcribe an audio URL via faster-whisper, returns the verbose_json payload
 * (text + segments with timestamps). Picks the Chinese-specific model when the
 * client hints `language=zh`, otherwise the multilingual turbo model.
 */
app.post('/api/whisper/transcribe', authMiddleware, async (req, res) => {
    // Same upstream gateway as Index-TTS, same key by default; allow override.
    const apiKey = process.env.FASTER_WHISPER_API_KEY || process.env.INDEX_TTS_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'FASTER_WHISPER_API_KEY (or INDEX_TTS_API_KEY) is not configured on server' });
    }

    const { audioUrl, language } = req.body || {};
    if (!audioUrl || typeof audioUrl !== 'string') {
        return res.status(400).json({ error: 'audioUrl is required' });
    }

    const model = language === 'zh'
        ? 'asadfgglie/faster-whisper-large-v3-zh-TW'
        : 'deepdml/faster-whisper-large-v3-turbo-ct2';

    try {
        await checkBalance(req.userId, FASTER_WHISPER_MODEL_ID);

        // Fetch the audio bytes server-side (frontend may pass any of: OSS URL,
        // /library path, or absolute http URL — keep it simple: only http(s) for now).
        const urlCheck = validateExternalUrl(audioUrl);
        if (!urlCheck.valid) {
            return res.status(400).json({ error: 'invalid audioUrl' });
        }
        const audioResp = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
        if (!audioResp.ok) {
            return res.status(502).json({ error: `failed to fetch audio (${audioResp.status})` });
        }
        const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
        const filename = (audioUrl.split('?')[0].split('/').pop() || 'audio.wav').replace(/[^\w.\-]/g, '_');
        const mime = audioResp.headers.get('content-type') || 'application/octet-stream';

        const form = new globalThis.FormData();
        form.append('file', new Blob([audioBuffer], { type: mime }), filename);
        form.append('model', model);
        form.append('response_format', 'verbose_json');
        if (language) form.append('language', String(language));

        const t0 = Date.now();
        const upstream = await fetch(`${FASTER_WHISPER_BASE}/v1/audio/transcriptions`, {
            method: 'POST',
            headers: { 'api-key': apiKey },
            body: form,
            signal: AbortSignal.timeout(300_000),
        });

        if (!upstream.ok) {
            const errBody = await upstream.text().catch(() => '');
            console.error('[Whisper] upstream error:', upstream.status, errBody.slice(0, 500));
            return res.status(upstream.status).json({ error: `whisper API ${upstream.status}: ${errBody.slice(0, 200) || 'transcription failed'}` });
        }

        const data = await upstream.json();
        const elapsed = Date.now() - t0;

        let outText = data?.text || '';
        let outSegments = Array.isArray(data?.segments)
            ? data.segments.map(s => ({
                id: s.id,
                start: s.start,
                end: s.end,
                text: s.text,
            }))
            : [];
        // 繁→简：显式 zh 走 TW 模型时需转；未传 language 时 turbo 若仍判为中文（含繁体）也要转
        const upstreamLang = String(data?.language || '').toLowerCase();
        const isZhTranscript = language === 'zh' || upstreamLang === 'zh' || upstreamLang.startsWith('zh-');
        if (isZhTranscript) {
            outText = twTraditionalToSimplified(outText);
            outSegments = outSegments.map(s => ({ ...s, text: twTraditionalToSimplified(s.text || '') }));
        }

        console.log(`[Whisper] ${model} (${data?.language || '?'}, ${data?.duration?.toFixed?.(1) || '?'}s audio) → ${outSegments.length} segments in ${elapsed}ms`);
        res.json({
            text: outText,
            language: data?.language || '',
            duration: data?.duration || 0,
            segments: outSegments,
            model,
            latencyMs: elapsed,
        });

        try {
            const durationSec = Number(data?.duration) || 0;
            const billingUnits = Math.max(1, Math.round(durationSec * 1000));
            const price = await getModelPrice(FASTER_WHISPER_MODEL_ID);
            const cost = calculateCost(price, { tokens: billingUnits });
            logUsage({ userId: req.userId, type: 'text', model: FASTER_WHISPER_MODEL_ID, prompt: `whisper:${durationSec.toFixed(1)}s`, cost, tokens: billingUnits, status: 'success' });
        } catch (billingErr) { console.error('[Whisper] Billing error:', billingErr.message); }
        return;
    } catch (err) {
        if (err.status === 402) return res.status(402).json({ error: err.message });
        console.error('[Whisper] transcribe:', err.message);
        logUsage({ userId: req.userId, type: 'text', model: FASTER_WHISPER_MODEL_ID, prompt: 'whisper-transcribe', cost: 0, tokens: 0, status: 'failed' });
        res.status(500).json({ error: err.message || 'transcription failed' });
    }
});

// ============================================================================
// SUBTITLE REMOVER (video-subtitle-remover local service)
// ============================================================================

const VSR_BASE = (process.env.VSR_ENDPOINT || 'http://localhost:8101').replace(/\/+$/, '');
const subtitleRemoverUpload = multer({ dest: storageService.getTempDir(), limits: { fileSize: 1024 * 1024 * 1024 } });
const vsrCompletedCache = new Map();

app.get('/api/subtitle-remover/health', authMiddleware, async (req, res) => {
    try {
        const response = await fetch(`${VSR_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(503).json({
            status: 'unavailable',
            error: 'Subtitle remover service is not running. Start it with: start-vsr-server.bat',
            detail: error.message,
        });
    }
});

app.post('/api/subtitle-remover/start', authMiddleware, subtitleRemoverUpload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'No video file provided' });
    }

    const { inpaintMode = 'sttn-auto', subtitleArea } = req.body || {};

    try {
        const health = await fetch(`${VSR_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        if (!health.ok) {
            return res.status(503).json({ error: 'Subtitle remover service is not ready' });
        }

        const formData = new FormData();
        const blob = new Blob([fs.readFileSync(file.path)], { type: file.mimetype || 'video/mp4' });
        formData.append('file', blob, file.originalname || 'input.mp4');
        formData.append('inpaint_mode', inpaintMode);
        if (subtitleArea) formData.append('subtitle_area', subtitleArea);

        const response = await fetch(`${VSR_BASE}/jobs`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(120_000),
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({ error: data.detail || data.error || 'Failed to start subtitle removal' });
        }

        console.log(`[SubtitleRemover] Job started: ${data.job_id} (${file.originalname})`);
        res.json({ jobId: data.job_id });
    } catch (error) {
        console.error('[SubtitleRemover] Start error:', error.message);
        if (error.cause?.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Subtitle remover service is not running. Start it with: start-vsr-server.bat' });
        }
        res.status(500).json({ error: error.message || 'Failed to start subtitle removal' });
    } finally {
        if (file) { try { fs.unlinkSync(file.path); } catch (_) {} }
    }
});

app.get('/api/subtitle-remover/status/:jobId', authMiddleware, async (req, res) => {
    const { jobId } = req.params;
    const uid = String(req.userId);

    try {
        if (vsrCompletedCache.has(jobId)) {
            return res.json(vsrCompletedCache.get(jobId));
        }

        const response = await fetch(`${VSR_BASE}/jobs/${jobId}`, { signal: AbortSignal.timeout(15_000) });
        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({ error: data.detail || 'Job not found' });
        }

        const payload = {
            jobId,
            status: data.status,
            progress: data.progress ?? 0,
            error: data.error || null,
        };

        if (data.status === 'completed') {
            const downloadResp = await fetch(`${VSR_BASE}/jobs/${jobId}/download`, { signal: AbortSignal.timeout(600_000) });
            if (!downloadResp.ok) {
                const errText = await downloadResp.text();
                return res.status(500).json({ error: `Failed to download result: ${errText.slice(0, 200)}` });
            }

            const videoBuffer = Buffer.from(await downloadResp.arrayBuffer());
            const tempPath = path.join(storageService.getTempDir(), `vsr_out_${jobId}.mp4`);
            fs.writeFileSync(tempPath, videoBuffer);

            let duration = 0;
            try { duration = await getVideoDuration(tempPath); } catch (_) {}
            try { fs.unlinkSync(tempPath); } catch (_) {}

            const saved = await storageService.saveVideo(videoBuffer, { userId: uid, ext: 'mp4', duration });
            const completed = {
                ...payload,
                videoUrl: saved.ossUrl,
                filename: saved.filename,
                duration,
                size: videoBuffer.length,
            };
            vsrCompletedCache.set(jobId, completed);

            fetch(`${VSR_BASE}/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
            setTimeout(() => vsrCompletedCache.delete(jobId), 60 * 60_000);

            console.log(`[SubtitleRemover] Job ${jobId} completed: ${saved.ossUrl} (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
            return res.json(completed);
        }

        res.json(payload);
    } catch (error) {
        console.error('[SubtitleRemover] Status error:', error.message);
        if (error.cause?.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Subtitle remover service is not running' });
        }
        res.status(500).json({ error: error.message || 'Failed to get job status' });
    }
});

// ============================================================================
// AUDIO EXTRACTION
// ============================================================================

const audioExtractUpload = multer({ dest: storageService.getTempDir(), limits: { fileSize: 500 * 1024 * 1024 } });

app.post('/api/extract-audio', authMiddleware, audioExtractUpload.single('file'), async (req, res) => {
    const uid = String(req.userId);
    const tempDir = path.join(storageService.getTempDir(), `audio_extract_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        const url = req.body?.url;
        const file = req.file;
        let inputPath;

        if (file) {
            inputPath = file.path;
            console.log(`[AudioExtract] File upload: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
        } else if (url) {
            const resolvedUrl = normalizeVideoUrl(url);
            console.log(`[AudioExtract] URL mode: ${resolvedUrl}${resolvedUrl !== url ? ` (normalized from ${url})` : ''}`);

            let downloaded = false;
            const failures = [];

            try {
                const browserOut = path.join(tempDir, 'browser_video.mp4');
                await downloadWithBrowser(resolvedUrl, browserOut);
                inputPath = browserOut;
                downloaded = true;
            } catch (browserErr) {
                const msg = browserErr.message?.slice(0, 200) || 'unknown';
                console.log(`[AudioExtract] Browser failed: ${msg}`);
                failures.push(`browser: ${msg}`);
            }

            // Fallback to Cobalt (third-party download relay) — handles a wide range of sites
            // including bilibili / douyin / youtube / tiktok / x.
            if (!downloaded) {
                try {
                    const cobaltOut = path.join(tempDir, 'cobalt_audio.bin');
                    await downloadWithCobalt(resolvedUrl, cobaltOut);
                    inputPath = cobaltOut;
                    downloaded = true;
                } catch (cobaltErr) {
                    const msg = cobaltErr.message?.slice(0, 200) || 'unknown';
                    console.log(`[AudioExtract] Cobalt fallback failed: ${msg}`);
                    failures.push(`cobalt: ${msg}`);
                }
            }

            if (!downloaded) {
                return res.status(400).json({
                    error: '无法从该链接提取音频，请尝试在浏览器中下载视频后使用「上传视频」功能',
                    detail: failures.join(' | '),
                });
            }
        } else {
            return res.status(400).json({ error: 'No file or URL provided' });
        }

        const hasAudio = await hasAudioStream(inputPath);
        if (!hasAudio) {
            return res.status(400).json({ error: 'No audio stream found in the input' });
        }

        const outputPath = path.join(tempDir, 'output.wav');
        await runFFmpeg([
            '-y', '-i', inputPath,
            '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2',
            outputPath,
        ]);

        if (!fs.existsSync(outputPath)) {
            throw new Error('FFmpeg audio extraction produced no output');
        }

        let duration = 0;
        try { duration = await getVideoDuration(outputPath); } catch (_) {}

        const wavBuffer = fs.readFileSync(outputPath);
        const saved = await storageService.saveAudioFile(wavBuffer, { userId: uid, ext: 'wav' });

        console.log(`[AudioExtract] Saved: ${saved.ossUrl} (${(wavBuffer.length / 1024 / 1024).toFixed(1)}MB, ${duration.toFixed(1)}s)`);
        res.json({ audioUrl: saved.ossUrl, filename: saved.filename, duration, size: wavBuffer.length });

    } catch (err) {
        console.error('[AudioExtract] Error:', err);
        res.status(500).json({ error: err.message || 'Audio extraction failed' });
    } finally {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {} }
});

// AUDIO TRIM
app.post('/api/trim-audio', authMiddleware, async (req, res) => {
    const uid = String(req.userId);
    const { audioUrl, start, end } = req.body;

    if (!audioUrl || typeof start !== 'number' || typeof end !== 'number') {
        return res.status(400).json({ error: 'audioUrl, start and end are required' });
    }
    if (start < 0 || end <= start) {
        return res.status(400).json({ error: 'Invalid time range' });
    }

    const tempDir = path.join(storageService.getTempDir(), `audio_trim_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        const inputPath = path.join(tempDir, 'input_audio');
        const urlCheck = validateExternalUrl(audioUrl, { allowPrivate: true });
        if (!urlCheck.valid) return res.status(400).json({ error: `Invalid audio URL: ${urlCheck.reason}` });
        const resp = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
        if (!resp.ok) throw new Error(`Failed to download audio: ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(inputPath, buf);

        const duration = end - start;
        const outputPath = path.join(tempDir, 'trimmed.wav');
        await runFFmpeg([
            '-y', '-i', inputPath,
            '-ss', String(start), '-t', String(duration),
            '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2',
            outputPath,
        ]);

        if (!fs.existsSync(outputPath)) {
            throw new Error('FFmpeg trim produced no output');
        }

        let trimmedDuration = 0;
        try { trimmedDuration = await getVideoDuration(outputPath); } catch (_) {}

        const wavBuffer = fs.readFileSync(outputPath);
        const saved = await storageService.saveAudioFile(wavBuffer, { userId: uid, ext: 'wav' });

        console.log(`[AudioTrim] Saved: ${saved.ossUrl} (${(wavBuffer.length / 1024 / 1024).toFixed(1)}MB, ${trimmedDuration.toFixed(1)}s)`);
        res.json({ audioUrl: saved.ossUrl, filename: saved.filename, duration: trimmedDuration, size: wavBuffer.length });
    } catch (err) {
        console.error('[AudioTrim] Error:', err);
        res.status(500).json({ error: err.message || 'Audio trimming failed' });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, '..', 'dist');
    app.use(express.static(distPath));

    // Handle SPA routing: serve index.html for any unknown routes
    app.get('{*path}', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

app.use(globalErrorHandler);

const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});

// Video generation can poll for up to 20 min; give 25 min headroom.
server.timeout = 25 * 60_000;
server.requestTimeout = 25 * 60_000;
server.headersTimeout = 26 * 60_000;
server.keepAliveTimeout = 30_000;

(async () => {
    // Initialize DB connection and run migrations (non-blocking)
    runMigrations().then(ok => {
        if (ok) console.log('[Startup] Cloud sync ready.');
        else console.log('[Startup] Cloud sync unavailable — running in local-only mode.');
    });
    // Initialize Redis connection (non-blocking)
    testRedisConnection().then(ok => {
        if (ok) console.log('[Startup] Redis pricing cache ready.');
        else console.log('[Startup] Redis unavailable — using in-memory pricing cache.');
    });
    // Initialize RabbitMQ connection (non-blocking)
    connectRabbitMQ().then(ch => {
        if (ch) console.log('[Startup] RabbitMQ task queue ready.');
        else console.log('[Startup] RabbitMQ unavailable — falling back to direct execution.');
    });
    // Temp cache cleanup: on startup + every 30 minutes
    storageService.cleanupTempFiles();
    setInterval(() => storageService.cleanupTempFiles(), 30 * 60_000);
})();
