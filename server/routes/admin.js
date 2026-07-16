import express from 'express';
import bcrypt from 'bcryptjs';
import { authMiddleware } from '../middleware/auth.js';
import { invalidatePricingCache } from './pricing.js';
import { syncBalanceToRedis } from '../services/balance.js';
import { getRedis, isRedisAvailable } from '../db/redis.js';

function invalidateProfileCache(userId) {
  const redis = getRedis();
  if (redis && isRedisAvailable()) {
    redis.del(`profile:${userId}`).catch(() => {});
  }
}

const router = express.Router();
let pool = null;

export function initAdminRoutes(dbPool) {
  pool = dbPool;
  return router;
}

function adminOnly(req, res, next) {
  // Role is embedded in JWT at login/refresh — no DB query needed
  if (req.userRole === 'admin') return next();

  // Fallback: if JWT was issued before role was added, check DB
  if (!pool) return res.status(503).json({ error: '数据库未连接' });
  pool.execute('SELECT role FROM users WHERE id = ?', [req.userId])
    .then(([rows]) => {
      if (!rows.length || rows[0].role !== 'admin') {
        return res.status(403).json({ error: '无管理员权限' });
      }
      next();
    })
    .catch(() => res.status(500).json({ error: '权限校验失败' }));
}

// All admin routes require auth + admin role
router.use(authMiddleware, adminOnly);

// ══════════════════════════════════════════════════════════
//  Users
// ══════════════════════════════════════════════════════════

router.get('/users', async (req, res) => {
  try {
    const search = req.query.search || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];

    if (search) {
      where = '(username LIKE ? OR nickname LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) as total FROM users WHERE ${where}`, params
    );

    const [users] = await pool.execute(
      `SELECT id, username, nickname, avatar_url, role, status, token_balance, created_at, updated_at 
       FROM users WHERE ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
      [...params, String(limit), String(offset)]
    );

    res.json({ users, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Admin] List users error:', err);
    res.status(500).json({ error: '获取用户列表失败' });
  }
});

// ══════════════════════════════════════════════════════════
//  Create User
// ══════════════════════════════════════════════════════════

router.post('/users', async (req, res) => {
  const { username, password, nickname, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 2 || username.length > 50) {
    return res.status(400).json({ error: '用户名长度 2-50 位' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }

  try {
    const [existing] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    const hash = await bcrypt.hash(password, 12);
    const userRole = role && ['user', 'admin'].includes(role) ? role : 'user';

    const [result] = await pool.execute(
      'INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?)',
      [username, hash, nickname || null, userRole]
    );

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('[Admin] Create user error:', err);
    res.status(500).json({ error: '创建用户失败' });
  }
});

// ══════════════════════════════════════════════════════════
//  Recharge Wallet
// ══════════════════════════════════════════════════════════

router.post('/users/:id/recharge', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { amount, remark } = req.body;
  const adminId = req.userId;

  if (!amount || isNaN(amount) || amount === 0) {
    return res.status(400).json({ error: '金额不能为 0' });
  }
  if (Math.abs(amount) > 100000) {
    return res.status(400).json({ error: '单次操作金额不能超过 100,000' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [users] = await conn.execute(
      'SELECT id, token_balance FROM users WHERE id = ? FOR UPDATE', [userId]
    );
    if (!users.length) {
      await conn.rollback();
      return res.status(404).json({ error: '用户不存在' });
    }

    const balanceBefore = Number(users[0].token_balance);
    const balanceAfter = balanceBefore + Number(amount);

    if (balanceAfter < 0) {
      await conn.rollback();
      return res.status(400).json({ error: `余额不足，当前余额 ¥${balanceBefore.toFixed(2)}` });
    }

    await conn.execute(
      'UPDATE users SET token_balance = ? WHERE id = ?',
      [balanceAfter, userId]
    );

    await conn.execute(
      'INSERT INTO recharge_logs (user_id, admin_id, amount, balance_before, balance_after, remark) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, adminId, amount, balanceBefore, balanceAfter, remark || null]
    );

    await conn.commit();

    // Sync new balance to Redis cache
    syncBalanceToRedis(userId, balanceAfter).catch(() => {});

    res.json({
      success: true,
      balanceBefore,
      balanceAfter,
      amount: Number(amount),
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Admin] Recharge error:', err);
    res.status(500).json({ error: '充值失败' });
  } finally {
    conn.release();
  }
});

// ══════════════════════════════════════════════════════════
//  Recharge Logs
// ══════════════════════════════════════════════════════════

router.get('/recharge-logs', async (req, res) => {
  try {
    const userId = req.query.userId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];

    if (userId) {
      where = 'r.user_id = ?';
      params.push(userId);
    }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) as total FROM recharge_logs r WHERE ${where}`, params
    );

    const [logs] = await pool.execute(
      `SELECT r.id, r.user_id, u.username, u.nickname, r.admin_id, a.username as admin_username,
              r.amount, r.balance_before, r.balance_after, r.remark, r.created_at
       FROM recharge_logs r
       JOIN users u ON u.id = r.user_id
       JOIN users a ON a.id = r.admin_id
       WHERE ${where}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, String(limit), String(offset)]
    );

    res.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Admin] Recharge logs error:', err);
    res.status(500).json({ error: '获取充值记录失败' });
  }
});

// ══════════════════════════════════════════════════════════
//  User Management: Edit / Disable / Delete / Reset Password
// ══════════════════════════════════════════════════════════

router.put('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { nickname, role } = req.body;

  if (userId === req.userId && role && role !== 'admin') {
    return res.status(400).json({ error: '不能降低自己的权限' });
  }

  try {
    const fields = [];
    const params = [];

    if (nickname !== undefined) { fields.push('nickname = ?'); params.push(nickname); }
    if (role && ['user', 'admin'].includes(role)) { fields.push('role = ?'); params.push(role); }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有需要更新的字段' });
    }

    params.push(userId);
    await pool.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    invalidateProfileCache(userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Update user error:', err);
    res.status(500).json({ error: '更新用户失败' });
  }
});

router.put('/users/:id/status', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { status } = req.body;

  if (userId === req.userId) {
    return res.status(400).json({ error: '不能禁用自己的账号' });
  }
  if (!['active', 'disabled'].includes(status)) {
    return res.status(400).json({ error: '状态值无效' });
  }

  try {
    await pool.execute('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    invalidateProfileCache(userId);

    if (status === 'disabled') {
      await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Toggle user status error:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

router.put('/users/:id/reset-password', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }

  try {
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
    await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Reset password error:', err);
    res.status(500).json({ error: '重置密码失败' });
  }
});

router.delete('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id);

  if (userId === req.userId) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }

  try {
    const [users] = await pool.execute('SELECT role FROM users WHERE id = ?', [userId]);
    if (!users.length) return res.status(404).json({ error: '用户不存在' });
    if (users[0].role === 'admin') return res.status(400).json({ error: '不能删除管理员账号' });

    await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
    await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Delete user error:', err);
    res.status(500).json({ error: '删除用户失败' });
  }
});

// ══════════════════════════════════════════════════════════
//  Model Pricing CRUD
// ══════════════════════════════════════════════════════════

router.get('/pricing', async (req, res) => {
  try {
    const search = req.query.search || '';
    const type = req.query.type || '';
    const provider = req.query.provider || '';
    const status = req.query.status || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];

    if (search) {
      where += ' AND (model_id LIKE ? OR model_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (type && ['image', 'video', 'text'].includes(type)) {
      where += ' AND type = ?';
      params.push(type);
    }
    if (provider) {
      where += ' AND provider = ?';
      params.push(provider);
    }
    if (status === 'active') {
      where += ' AND is_active = 1';
    } else if (status === 'inactive') {
      where += ' AND is_active = 0';
    }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) as total FROM model_pricing WHERE ${where}`, params
    );

    const allowedSort = ['id', 'model_id', 'model_name', 'type', 'provider', 'base_cost', 'cost_per_second', 'cost_per_1k_tokens', 'sort_order', 'is_active'];
    const sortBy = allowedSort.includes(req.query.sort_by) ? req.query.sort_by : 'sort_order';
    const sortDir = req.query.sort_dir === 'desc' ? 'DESC' : 'ASC';

    const [rows] = await pool.execute(
      `SELECT * FROM model_pricing WHERE ${where} ORDER BY ${sortBy} ${sortDir}, id ASC LIMIT ? OFFSET ?`,
      [...params, String(limit), String(offset)]
    );

    // Get distinct providers for filter dropdown
    const [providers] = await pool.execute('SELECT DISTINCT provider FROM model_pricing ORDER BY provider');

    res.json({
      pricing: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      providers: providers.map(p => p.provider),
    });
  } catch (err) {
    console.error('[Admin] List pricing error:', err);
    res.status(500).json({ error: '获取定价列表失败' });
  }
});

router.put('/pricing/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { model_id, model_name, type, provider, base_cost, cost_per_second, cost_per_1k_tokens, is_active, sort_order, resolution_pricing } = req.body;

  let rpValue = null;
  if (resolution_pricing !== undefined) {
    rpValue = resolution_pricing === null || resolution_pricing === ''
      ? null
      : (typeof resolution_pricing === 'string' ? resolution_pricing : JSON.stringify(resolution_pricing));
  }

  try {
    await pool.execute(
      `UPDATE model_pricing SET 
        model_id = ?, model_name = ?, type = ?, provider = ?,
        base_cost = ?, cost_per_second = ?, cost_per_1k_tokens = ?,
        resolution_pricing = ?, is_active = ?, sort_order = ?
       WHERE id = ?`,
      [model_id, model_name, type, provider,
       base_cost ?? 1, cost_per_second ?? 0, cost_per_1k_tokens ?? 0,
       rpValue, is_active ?? 1, sort_order ?? 0, id]
    );
    await invalidatePricingCache();
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Update pricing error:', err);
    res.status(500).json({ error: '更新定价失败' });
  }
});

router.post('/pricing', async (req, res) => {
  const { model_id, model_name, type, provider, base_cost, cost_per_second, cost_per_1k_tokens, sort_order, resolution_pricing } = req.body;

  if (!model_id || !model_name || !type || !provider) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  let rpValue = null;
  if (resolution_pricing) {
    rpValue = typeof resolution_pricing === 'string' ? resolution_pricing : JSON.stringify(resolution_pricing);
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO model_pricing (model_id, model_name, type, provider, base_cost, cost_per_second, cost_per_1k_tokens, resolution_pricing, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [model_id, model_name, type, provider,
       base_cost ?? 1, cost_per_second ?? 0, cost_per_1k_tokens ?? 0, rpValue, sort_order ?? 0]
    );
    await invalidatePricingCache();
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: '模型 ID 已存在' });
    }
    console.error('[Admin] Create pricing error:', err);
    res.status(500).json({ error: '创建定价失败' });
  }
});

router.delete('/pricing/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM model_pricing WHERE id = ?', [parseInt(req.params.id)]);
    await invalidatePricingCache();
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Delete pricing error:', err);
    res.status(500).json({ error: '删除定价失败' });
  }
});

export default router;
