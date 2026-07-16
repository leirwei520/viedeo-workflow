import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const DEFAULT_SECRET = 'chuhai-bang-jwt-secret-change-in-production';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_SECRET)) {
    throw new Error('[Security] FATAL: JWT_SECRET must be set to a strong random value in production. Refusing to start.');
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_SECRET) {
    console.warn('[Security] ⚠ JWT_SECRET not set — generating random ephemeral secret for development. Tokens will invalidate on restart.');
}

const JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET !== DEFAULT_SECRET
    ? process.env.JWT_SECRET
    : crypto.randomBytes(32).toString('hex');

export function signAccessToken(userId, role = 'user') {
  return jwt.sign({ uid: userId, role }, JWT_SECRET, { expiresIn: '24h' });
}

export function signRefreshToken(userId) {
  return jwt.sign({ uid: userId, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    req.userId = payload.uid;
    req.userRole = payload.role || null;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token 已过期', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: '无效的认证令牌' });
  }
}
