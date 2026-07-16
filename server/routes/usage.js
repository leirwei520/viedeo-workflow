import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getRedis, isRedisAvailable } from '../db/redis.js';

const router = express.Router();

let pool = null;

export function initUsageRoutes(dbPool) {
  pool = dbPool;
  return router;
}

const STATS_KEY_PREFIX = 'usage_stats:';
const STATS_TTL = 120; // 2 min cache — good balance between freshness and DB load

/**
 * Invalidate cached stats for a user.
 * Call this after logUsage to keep stats fresh on next visit.
 */
export async function invalidateStatsCache(userId) {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return;
  try {
    await redis.del(`${STATS_KEY_PREFIX}${userId}`);
  } catch (_) { /* best effort */ }
}

async function queryStatsFromDB(userId) {
  const [[totals]] = await pool.execute(
    `SELECT
       COUNT(*) AS total_generations,
       SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END) AS total_images,
       SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END) AS total_videos,
       SUM(CASE WHEN type = 'text' THEN 1 ELSE 0 END) AS total_text,
       COALESCE(SUM(CASE WHEN status = 'success' THEN cost ELSE 0 END), 0) AS total_spent,
       COALESCE(SUM(CASE WHEN status = 'success' THEN tokens ELSE 0 END), 0) AS total_tokens,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS total_failed
     FROM usage_logs WHERE user_id = ?`,
    [userId]
  );

  const [[today]] = await pool.execute(
    `SELECT COUNT(*) AS count FROM usage_logs WHERE user_id = ? AND DATE(created_at) = CURDATE()`,
    [userId]
  );

  const [[thisWeek]] = await pool.execute(
    `SELECT COUNT(*) AS count FROM usage_logs WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)`,
    [userId]
  );

  const [[thisMonth]] = await pool.execute(
    `SELECT COUNT(*) AS count FROM usage_logs WHERE user_id = ? AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())`,
    [userId]
  );

  const [byModel] = await pool.execute(
    `SELECT model, type, COUNT(*) AS count, COALESCE(SUM(cost), 0) AS total_cost
     FROM usage_logs WHERE user_id = ? AND status = 'success'
     GROUP BY model, type ORDER BY total_cost DESC LIMIT 20`,
    [userId]
  );

  return {
    totalGenerations: Number(totals.total_generations),
    totalImages: Number(totals.total_images),
    totalVideos: Number(totals.total_videos),
    totalText: Number(totals.total_text),
    totalSpent: Number(totals.total_spent),
    totalTokens: Number(totals.total_tokens),
    totalFailed: Number(totals.total_failed),
    todayCount: Number(today.count),
    weekCount: Number(thisWeek.count),
    monthCount: Number(thisMonth.count),
    byModel: byModel.map(r => ({
      model: r.model,
      type: r.type,
      count: Number(r.count),
      totalCost: Number(r.total_cost)
    }))
  };
}

// Aggregated usage statistics for the current user (Redis cached)
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: '数据库未连接' });

    const userId = req.userId;
    const redis = getRedis();
    const cacheKey = `${STATS_KEY_PREFIX}${userId}`;

    // Try Redis cache first
    if (redis && isRedisAvailable()) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return res.json(JSON.parse(cached));
        }
      } catch (_) { /* fall through to DB */ }
    }

    const stats = await queryStatsFromDB(userId);

    // Write back to cache
    if (redis && isRedisAvailable()) {
      redis.set(cacheKey, JSON.stringify(stats), 'EX', STATS_TTL).catch(() => {});
    }

    res.json(stats);
  } catch (err) {
    console.error('[Usage] Stats error:', err);
    res.status(500).json({ error: '获取使用统计失败' });
  }
});

// Paginated usage log history
router.get('/logs', authMiddleware, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: '数据库未连接' });

    const userId = req.userId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const type = req.query.type; // 'image', 'video', or undefined for all
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE user_id = ?';
    const params = [userId];

    if (type === 'image' || type === 'video' || type === 'text') {
      whereClause += ' AND type = ?';
      params.push(type);
    }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM usage_logs ${whereClause}`,
      params
    );

    const [logs] = await pool.execute(
      `SELECT id, type, model, prompt, cost, tokens, status, result_url, created_at
       FROM usage_logs ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, String(limit), String(offset)]
    );

    res.json({
      logs: logs.map(l => ({
        id: Number(l.id),
        type: l.type,
        model: l.model,
        prompt: l.prompt,
        cost: Number(l.cost),
        tokens: Number(l.tokens || 0),
        status: l.status,
        resultUrl: l.result_url,
        createdAt: l.created_at
      })),
      total: Number(total),
      page,
      limit,
      totalPages: Math.ceil(Number(total) / limit)
    });
  } catch (err) {
    console.error('[Usage] Logs error:', err);
    res.status(500).json({ error: '获取使用记录失败' });
  }
});

export default router;
