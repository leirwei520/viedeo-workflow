import express from 'express';
import { getRedis, isRedisAvailable } from '../db/redis.js';

const router = express.Router();

let pool = null;

let memCache = null;
let memCacheTs = 0;
const MEM_CACHE_TTL = 5 * 60 * 1000;

const REDIS_KEY_ALL = 'pricing:all';
const REDIS_KEY_PREFIX = 'pricing:model:';
const REDIS_TTL = 600;

export function initPricingRoutes(dbPool) {
  pool = dbPool;
  return router;
}

// ──────────────────────────────────────────────
//  Resolution / Mode helpers
// ──────────────────────────────────────────────

const RESOLUTION_ALIASES = {
  '480p': '480p', '540p': '480p', '512p': '480p',
  '720p': '720p', '768p': '720p',
  '1080p': '1080p', '1080P': '1080p',
  '512': '512', '1k': '1k', '1K': '1k',
  '2k': '2k', '2K': '2k',
  '3k': '3k', '3K': '3k',
  '4k': '4k', '4K': '4k',
};

/**
 * Normalize frontend resolution strings to DB pricing keys.
 * Returns null for 'Auto' or unknown values (triggers fallback).
 */
export function normalizeResolution(resolution) {
  if (!resolution || resolution === 'Auto' || resolution === 'auto') return null;
  return RESOLUTION_ALIASES[resolution] || resolution.toLowerCase();
}

/**
 * Detect generation mode from request parameters.
 * Video modes: text, text_audio, img, img_audio, ref, ref_audio
 * Image modes: default, ref
 */
export function detectGenerationMode({ imageBase64, lastFrameBase64, frameImages, motionReferenceUrl, referenceVideoUrls, generateAudio, type }) {
  if (type === 'image') {
    const hasRef = !!imageBase64 || (Array.isArray(imageBase64) && imageBase64.length > 0);
    return hasRef ? 'ref' : 'default';
  }

  const hasImage = !!imageBase64 || !!lastFrameBase64 ||
    (Array.isArray(frameImages) && frameImages.length > 0);
  const hasAudio = generateAudio === true;
  const hasRefVideo = !!motionReferenceUrl || (Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0);

  if (hasRefVideo) return hasAudio ? 'ref_audio' : 'ref';
  if (hasImage) return hasAudio ? 'img_audio' : 'img';
  return hasAudio ? 'text_audio' : 'text';
}

// ──────────────────────────────────────────────
//  DB loader
// ──────────────────────────────────────────────

async function loadPricingFromDb() {
  if (!pool) return [];
  const [rows] = await pool.execute(
    'SELECT model_id, model_name, type, provider, base_cost, cost_per_second, cost_per_1k_tokens, resolution_pricing, is_active, sort_order FROM model_pricing WHERE is_active = 1 ORDER BY sort_order ASC'
  );
  return rows.map(r => {
    let resPricing = null;
    if (r.resolution_pricing) {
      try {
        resPricing = typeof r.resolution_pricing === 'string'
          ? JSON.parse(r.resolution_pricing)
          : r.resolution_pricing;
      } catch { /* ignore malformed JSON */ }
    }
    return {
      modelId: r.model_id,
      modelName: r.model_name,
      type: r.type,
      provider: r.provider,
      baseCost: Number(r.base_cost),
      costPerSecond: Number(r.cost_per_second),
      costPer1kTokens: Number(r.cost_per_1k_tokens),
      resolutionPricing: resPricing,
      sortOrder: r.sort_order,
    };
  });
}

// ──────────────────────────────────────────────
//  Redis-backed cache with in-memory fallback
// ──────────────────────────────────────────────

async function setRedisCache(pricing) {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return;

  try {
    const pipeline = redis.pipeline();
    pipeline.set(REDIS_KEY_ALL, JSON.stringify(pricing), 'EX', REDIS_TTL);
    for (const entry of pricing) {
      pipeline.set(REDIS_KEY_PREFIX + entry.modelId, JSON.stringify(entry), 'EX', REDIS_TTL);
    }
    await pipeline.exec();
  } catch (err) {
    console.warn('[Pricing] Redis write failed:', err.message);
  }
}

export async function getPricingCache() {
  const redis = getRedis();

  if (redis && isRedisAvailable()) {
    try {
      const cached = await redis.get(REDIS_KEY_ALL);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      console.warn('[Pricing] Redis read failed, falling back to DB:', err.message);
    }
  }

  const now = Date.now();
  if (memCache && now - memCacheTs < MEM_CACHE_TTL) {
    return memCache;
  }

  try {
    const pricing = await loadPricingFromDb();
    memCache = pricing;
    memCacheTs = Date.now();
    setRedisCache(pricing);
    return pricing;
  } catch (err) {
    console.error('[Pricing] Failed to load pricing:', err.message);
    return memCache || [];
  }
}

export async function getModelPrice(modelId) {
  const redis = getRedis();

  if (redis && isRedisAvailable()) {
    try {
      const cached = await redis.get(REDIS_KEY_PREFIX + modelId);
      if (cached) return JSON.parse(cached);
    } catch (_) { /* fall through */ }
  }

  const pricing = await getPricingCache();
  return pricing.find(p => p.modelId === modelId) || null;
}

export async function invalidatePricingCache() {
  memCache = null;
  memCacheTs = 0;

  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return;

  try {
    const keys = await redis.keys('pricing:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    console.log(`[Pricing] Cache invalidated (${keys.length} Redis keys cleared)`);
  } catch (err) {
    console.warn('[Pricing] Redis cache invalidation failed:', err.message);
  }
}

// ──────────────────────────────────────────────
//  Cost calculation (resolution + mode aware)
// ──────────────────────────────────────────────

/**
 * Look up per-second rate or per-image price from the resolution_pricing JSON.
 * Fallback chain: [mode][resolution] → ["text"][resolution] → ["default"][resolution] → null
 */
function resolvePrice(resolutionPricing, mode, normalizedRes) {
  if (!resolutionPricing || !normalizedRes) return null;

  // Try exact mode + resolution
  if (resolutionPricing[mode] && resolutionPricing[mode][normalizedRes] != null) {
    return resolutionPricing[mode][normalizedRes];
  }
  // Fallback: "text" mode (cheapest video tier)
  if (resolutionPricing.text && resolutionPricing.text[normalizedRes] != null) {
    return resolutionPricing.text[normalizedRes];
  }
  // Fallback: "default" mode (images)
  if (resolutionPricing.default && resolutionPricing.default[normalizedRes] != null) {
    return resolutionPricing.default[normalizedRes];
  }
  return null;
}

/**
 * Calculate cost for a model call.
 *
 * @param {object} priceEntry - from getModelPrice()
 * @param {object} options
 * @param {number} options.duration - seconds (video only)
 * @param {number} options.tokens  - token count (text only)
 * @param {string} options.resolution - e.g. '1080p', '2K', '720p'
 * @param {string} options.mode - e.g. 'text', 'img_audio', 'ref', 'default'
 */
export function calculateCost(priceEntry, { duration, tokens, resolution, mode } = {}) {
  if (!priceEntry) {
    console.warn('[Pricing] No price entry found — using fallback cost 0. Check model_pricing table.');
    return 0;
  }

  const normalizedRes = normalizeResolution(resolution);

  // ── Video: perSecond * duration ──
  if (priceEntry.type === 'video') {
    const effectiveMode = mode || 'text';
    const resolvedRate = resolvePrice(priceEntry.resolutionPricing, effectiveMode, normalizedRes);
    const perSecond = resolvedRate != null ? resolvedRate : priceEntry.costPerSecond;
    const effectiveDuration = duration || 5;

    if (perSecond > 0) {
      return Math.round(perSecond * effectiveDuration * 10000) / 10000;
    }
    return Math.round(priceEntry.baseCost * 10000) / 10000;
  }

  // ── Image: flat rate per image ──
  if (priceEntry.type === 'image') {
    const effectiveMode = mode || 'default';
    const resolvedRate = resolvePrice(priceEntry.resolutionPricing, effectiveMode, normalizedRes);
    if (resolvedRate != null) {
      return Math.round(resolvedRate * 10000) / 10000;
    }
    return Math.round(priceEntry.baseCost * 10000) / 10000;
  }

  // ── Text: token-based ──
  if (tokens && priceEntry.costPer1kTokens > 0) {
    return Math.round((tokens / 1000) * priceEntry.costPer1kTokens * 10000) / 10000;
  }

  return Math.round(priceEntry.baseCost * 10000) / 10000;
}

// GET /api/pricing — public list of all active model prices
router.get('/', async (_req, res) => {
  try {
    const pricing = await getPricingCache();
    res.json({ pricing });
  } catch (err) {
    console.error('[Pricing] Error:', err);
    res.status(500).json({ error: '获取定价失败' });
  }
});

export default router;
