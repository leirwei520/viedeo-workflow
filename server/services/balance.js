/**
 * balance.js
 *
 * Redis-cached balance service with atomic pre-deduction and async DB persistence.
 *
 * Flow:
 *   1. On first access or cache miss → load balance from MySQL into Redis
 *   2. checkBalance  → Redis GET to compare
 *   3. deductBalance → Redis Lua atomic check-and-deduct (no race conditions)
 *   4. logUsage      → async INSERT into usage_logs + periodic DB sync
 *   5. On recharge   → update DB first, then SET Redis key
 *
 * Falls back to direct MySQL when Redis is unavailable.
 */

import { getRedis, isRedisAvailable } from '../db/redis.js';
import { getPool } from '../db/pool.js';
import { invalidateStatsCache } from '../routes/usage.js';

const BALANCE_KEY_PREFIX = 'balance:';
const BALANCE_TTL = 600; // 10 min — re-sync from DB periodically

function balanceKey(userId) {
    return `${BALANCE_KEY_PREFIX}${userId}`;
}

// Lua: atomic check-and-deduct. Returns new balance or -1 if insufficient.
const DEDUCT_LUA = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local bal = tonumber(redis.call('GET', key))
if bal == nil then return -2 end
if bal < cost then return -1 end
local newBal = bal - cost
if newBal < 0 then newBal = 0 end
redis.call('SET', key, string.format('%.4f', newBal), 'EX', ARGV[2])
return string.format('%.4f', newBal)
`;

// Lua: atomic refund (increment). Returns new balance or -1 if key missing.
const REFUND_LUA = `
local key = KEYS[1]
local amount = tonumber(ARGV[1])
local bal = tonumber(redis.call('GET', key))
if bal == nil then return -1 end
local newBal = bal + amount
redis.call('SET', key, string.format('%.4f', newBal), 'EX', ARGV[2])
return string.format('%.4f', newBal)
`;

// Lua: atomic debit (decrement, floor at 0). Returns new balance or -1 if key missing.
const DEBIT_LUA = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local bal = tonumber(redis.call('GET', key))
if bal == nil then return -1 end
local newBal = bal - cost
if newBal < 0 then newBal = 0 end
redis.call('SET', key, string.format('%.4f', newBal), 'EX', ARGV[2])
return string.format('%.4f', newBal)
`;

/**
 * Ensure the user's balance is cached in Redis.
 * Returns the balance as a number, or null if DB unavailable.
 */
export async function ensureCached(userId) {
    const redis = getRedis();
    if (!redis || !isRedisAvailable()) return null;

    const key = balanceKey(userId);
    const cached = await redis.get(key);
    if (cached !== null) return parseFloat(cached);

    const pool = getPool();
    if (!pool) return null;

    const [rows] = await pool.execute('SELECT token_balance FROM users WHERE id = ?', [userId]);
    if (!rows.length) return null;

    const balance = parseFloat(rows[0].token_balance);
    await redis.set(key, balance.toFixed(4), 'EX', BALANCE_TTL);
    return balance;
}

/**
 * Get user balance — Redis first, DB fallback.
 */
export async function getBalance(userId) {
    const redis = getRedis();
    if (redis && isRedisAvailable()) {
        const bal = await ensureCached(userId);
        if (bal !== null) return bal;
    }

    const pool = getPool();
    if (!pool) return 0;

    const [rows] = await pool.execute('SELECT token_balance FROM users WHERE id = ?', [userId]);
    return rows.length ? parseFloat(rows[0].token_balance) : 0;
}

/**
 * Atomic check-and-deduct via Redis Lua script.
 * Returns { success, newBalance } or falls back to DB if Redis unavailable.
 */
export async function deductBalance(userId, cost) {
    if (cost <= 0) return { success: true, newBalance: -1, source: 'none' };

    const redis = getRedis();
    if (redis && isRedisAvailable()) {
        await ensureCached(userId);

        const result = await redis.eval(
            DEDUCT_LUA, 1, balanceKey(userId),
            cost.toFixed(4), String(BALANCE_TTL)
        );

        if (result === -2) {
            await ensureCached(userId);
            const retry = await redis.eval(
                DEDUCT_LUA, 1, balanceKey(userId),
                cost.toFixed(4), String(BALANCE_TTL)
            );
            if (retry === -1 || retry === -2) return { success: false, newBalance: 0, source: 'redis' };
            return { success: true, newBalance: parseFloat(retry), source: 'redis' };
        }

        if (result === -1) return { success: false, newBalance: 0, source: 'redis' };
        return { success: true, newBalance: parseFloat(result), source: 'redis' };
    }

    // Fallback: direct DB with row-level lock (balance already updated in DB)
    const pool = getPool();
    if (!pool) return { success: false, newBalance: 0, source: 'db' };

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.execute(
            'SELECT token_balance FROM users WHERE id = ? FOR UPDATE', [userId]
        );
        if (!rows.length) {
            await conn.rollback();
            return { success: false, newBalance: 0, source: 'db' };
        }
        const balance = parseFloat(rows[0].token_balance);
        if (balance < cost) {
            await conn.rollback();
            return { success: false, newBalance: balance, source: 'db' };
        }
        const newBalance = Math.max(balance - cost, 0);
        await conn.execute('UPDATE users SET token_balance = ? WHERE id = ?', [newBalance, userId]);
        await conn.commit();
        return { success: true, newBalance, source: 'db' };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Persist a deduction to MySQL (async, fire-and-forget safe).
 *
 * @param preDeducted - if true, Redis was already debited via preDeduct/deductBalance.
 *   On success: only writes DB (Redis already correct).
 *   On failure: refunds Redis pre-deduction, no DB debit.
 *
 * If preDeducted is false (e.g. text calls where cost is unknown upfront):
 *   On success: deducts from both DB and Redis.
 */
/**
 * @param preDeducted - if true, balance was already debited via deductBalance()
 * @param preDeductSource - 'redis' | 'db' | 'none' — where the pre-deduction happened.
 *   When 'db', the DB balance is already correct; only log usage, skip DB UPDATE.
 *   When 'redis', sync to DB on success; refund Redis on failure.
 */
export async function persistDeduction({ userId, type, model, prompt, cost, tokens, status, resultUrl, preDeducted = false, preDeductSource = 'redis' }) {
    const pool = getPool();
    if (!pool || !userId) return;

    try {
        const loggedCost = status === 'success' ? cost : 0;
        await pool.execute(
            'INSERT INTO usage_logs (user_id, type, model, prompt, cost, tokens, status, result_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, type, model || 'unknown', prompt ? prompt.substring(0, 2000) : null, loggedCost, tokens || 0, status, resultUrl || null]
        );

        if (status === 'success') {
            if (preDeducted && preDeductSource === 'db') {
                // DB was already debited atomically in deductBalance — no further DB update needed.
                // Just invalidate Redis cache so next read re-syncs from DB.
                await invalidateBalance(userId);
            } else {
                // Either not pre-deducted, or pre-deducted via Redis only — sync to DB
                await pool.execute(
                    'UPDATE users SET token_balance = GREATEST(token_balance - ?, 0) WHERE id = ?',
                    [cost, userId]
                );
                if (!preDeducted && cost > 0) {
                    const redis = getRedis();
                    if (redis && isRedisAvailable()) {
                        await redis.eval(DEBIT_LUA, 1, balanceKey(userId), cost.toFixed(4), String(BALANCE_TTL));
                    }
                }
            }
        } else if (preDeducted && cost > 0) {
            if (preDeductSource === 'db') {
                // Deduction was via DB — must refund DB
                await refundBalance(userId, cost, { redisOnly: false });
            } else {
                // Deduction was via Redis only — refund Redis; if Redis is down, fall back to DB
                await refundBalance(userId, cost, { redisOnly: true });
            }
        }

        invalidateStatsCache(userId).catch(() => {});
    } catch (err) {
        console.error('[Balance] Failed to persist deduction:', err.message);
    }
}

/**
 * Refund a pre-deducted amount.
 * @param {object} options
 * @param {boolean} options.redisOnly - If true, only refund Redis (use when pre-deduction
 *   was Redis-only and DB was never debited, e.g. preDeduct → failure path).
 */
export async function refundBalance(userId, amount, { redisOnly = false } = {}) {
    if (amount <= 0) return;

    const redis = getRedis();
    let redisRefunded = false;
    if (redis && isRedisAvailable()) {
        await redis.eval(REFUND_LUA, 1, balanceKey(userId), amount.toFixed(4), String(BALANCE_TTL));
        redisRefunded = true;
    }

    // If redisOnly was requested but Redis is unavailable, the pre-deduction
    // must have gone through the DB fallback path, so refund via DB instead.
    if (!redisOnly || !redisRefunded) {
        const pool = getPool();
        if (pool) {
            await pool.execute(
                'UPDATE users SET token_balance = token_balance + ? WHERE id = ?',
                [amount, userId]
            );
        }
    }
}

/**
 * Set balance in Redis (call after admin recharge or external balance change).
 */
export async function syncBalanceToRedis(userId, newBalance) {
    const redis = getRedis();
    if (!redis || !isRedisAvailable()) return;

    await redis.set(balanceKey(userId), parseFloat(newBalance).toFixed(4), 'EX', BALANCE_TTL);
}

/**
 * Invalidate cached balance (forces next read to hit DB).
 */
export async function invalidateBalance(userId) {
    const redis = getRedis();
    if (!redis || !isRedisAvailable()) return;

    await redis.del(balanceKey(userId));
}
