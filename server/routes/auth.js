import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { signAccessToken, signRefreshToken, verifyToken, authMiddleware } from '../middleware/auth.js';
import { uploadBuffer, isOssConfigured } from '../services/oss-storage.js';
import { getBalance } from '../services/balance.js';
import { getRedis, isRedisAvailable } from '../db/redis.js';

const PROFILE_KEY_PREFIX = 'profile:';
const PROFILE_TTL = 300; // 5 min

const router = express.Router();

let pool = null;

export function initAuthRoutes(dbPool) {
  pool = dbPool;
  return router;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Login (username + password) ─────────────────────────

router.post('/login', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: '数据库未连接' });

    const { username, password } = req.body;

    if (!username) {
      return res.status(400).json({ error: '请输入账号' });
    }
    if (!password) {
      return res.status(400).json({ error: '请输入密码' });
    }

    const [users] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(401).json({ error: '账号不存在' });
    }

    const user = users[0];
    if (user.status === 'disabled') {
      return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: '密码错误' });
    }

    const accessToken = signAccessToken(user.id, user.role);
    const refreshToken = signRefreshToken(user.id);

    const rtHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.execute(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, rtHash, expiresAt]
    );

    const { password_hash, ...safeUser } = user;

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: safeUser,
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

// ─── Refresh Token ──────────────────────────────────────

router.post('/refresh', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: '数据库未连接' });

    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: '缺少 refresh_token' });
    }

    let payload;
    try {
      payload = verifyToken(refresh_token);
    } catch {
      return res.status(401).json({ error: 'Refresh token 无效或已过期' });
    }

    const rtHash = hashToken(refresh_token);
    const [tokens] = await pool.execute(
      'SELECT * FROM refresh_tokens WHERE token_hash = ? AND user_id = ? AND expires_at > NOW()',
      [rtHash, payload.uid]
    );

    if (tokens.length === 0) {
      return res.status(401).json({ error: 'Refresh token 已失效' });
    }

    await pool.execute('DELETE FROM refresh_tokens WHERE token_hash = ?', [rtHash]);

    // Fetch current role so the new access token reflects any role changes
    const [userRows] = await pool.execute('SELECT role FROM users WHERE id = ?', [payload.uid]);
    const currentRole = userRows.length ? userRows[0].role : 'user';

    const newAccessToken = signAccessToken(payload.uid, currentRole);
    const newRefreshToken = signRefreshToken(payload.uid);
    const newRtHash = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.execute(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [payload.uid, newRtHash, expiresAt]
    );

    res.json({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    });
  } catch (err) {
    console.error('[Auth] Refresh error:', err);
    res.status(500).json({ error: '刷新令牌失败' });
  }
});

// ─── Get Current User ───────────────────────────────────

router.get('/me', authMiddleware, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: '数据库未连接' });

    const userId = req.userId;
    const redis = getRedis();
    const cacheKey = `${PROFILE_KEY_PREFIX}${userId}`;

    // Try Redis cache for profile fields (not balance)
    let user = null;
    if (redis && isRedisAvailable()) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) user = JSON.parse(cached);
      } catch (_) { /* fall through */ }
    }

    if (!user) {
      const [users] = await pool.execute(
        'SELECT id, username, nickname, avatar_url, role, token_balance, created_at FROM users WHERE id = ?',
        [userId]
      );
      if (users.length === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }
      user = users[0];
      // Cache profile in Redis (balance will be overwritten below anyway)
      if (redis && isRedisAvailable()) {
        redis.set(cacheKey, JSON.stringify(user), 'EX', PROFILE_TTL).catch(() => {});
      }
    }

    // Always use Redis-cached balance (real-time, reflects pre-deductions)
    try {
      user.token_balance = await getBalance(userId);
    } catch (_) { /* keep cached/DB value */ }

    res.json({ user });
  } catch (err) {
    console.error('[Auth] Get user error:', err);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// ─── Change Password ─────────────────────────────────────

router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: '数据库未连接' });

    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '请输入旧密码和新密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码长度不能少于6位' });
    }
    if (oldPassword === newPassword) {
      return res.status(400).json({ error: '新密码不能与旧密码相同' });
    }

    const [users] = await pool.execute('SELECT password_hash, role FROM users WHERE id = ?', [req.userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const valid = await bcrypt.compare(oldPassword, users[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: '旧密码错误' });
    }

    const role = users[0].role || 'user';
    const newHash = await bcrypt.hash(newPassword, 10);

    // Update password + invalidate all refresh tokens in parallel
    await Promise.all([
      pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.userId]),
      pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [req.userId]),
    ]);
    const accessToken = signAccessToken(req.userId, role);
    const refreshToken = signRefreshToken(req.userId);
    const rtHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.execute(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [req.userId, rtHash, expiresAt]
    );

    res.json({ success: true, access_token: accessToken, refresh_token: refreshToken });
  } catch (err) {
    console.error('[Auth] Change password error:', err);
    res.status(500).json({ error: '修改密码失败，请稍后重试' });
  }
});

// ─── Update Avatar ──────────────────────────────────────

router.post('/avatar', authMiddleware, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: '数据库未连接' });

    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ error: '缺少头像数据' });

    const match = avatar.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/);
    const ext = match ? (match[1] === 'jpeg' ? 'jpg' : match[1]) : 'png';
    const base64Data = match ? match[2] : avatar;
    const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

    const filename = `avatar_${req.userId}_${Date.now()}.${ext}`;
    const buffer = Buffer.from(base64Data, 'base64');

    const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB
    if (buffer.length > MAX_AVATAR_SIZE) {
      return res.status(413).json({ error: `头像文件过大（最大 ${MAX_AVATAR_SIZE / 1024 / 1024}MB）` });
    }

    let avatarUrl;

    if (isOssConfigured()) {
      const objectKey = `avatars/${req.userId}/${filename}`;
      avatarUrl = await uploadBuffer(buffer, objectKey, mimeType);
      console.log(`[Auth] Avatar uploaded to OSS: ${avatarUrl}`);
    } else {
      const IMAGES_DIR = req.app.locals.IMAGES_DIR;
      if (!IMAGES_DIR) return res.status(500).json({ error: '存储目录未配置' });

      const filePath = path.join(IMAGES_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      avatarUrl = `/library/images/${filename}`;
      console.log(`[Auth] Avatar saved locally: ${avatarUrl}`);
    }

    await pool.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.userId]);

    // Invalidate profile cache so next /me returns updated avatar
    const redis = getRedis();
    if (redis && isRedisAvailable()) {
      redis.del(`${PROFILE_KEY_PREFIX}${req.userId}`).catch(() => {});
    }

    res.json({ avatar_url: avatarUrl });
  } catch (err) {
    console.error('[Auth] Avatar upload error:', err);
    res.status(500).json({ error: '头像上传失败' });
  }
});

export default router;
