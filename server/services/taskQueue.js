import crypto from 'crypto';
import { getChannel, QUEUES } from './rabbitmq.js';
import { getRedis } from '../db/redis.js';

const TASK_TTL = 30 * 60; // 30 min Redis expiry

function redisKey(taskId) { return `task:${taskId}`; }
function nodeTaskKey(nodeId) { return `node_task:${nodeId}`; }
function userConcurrencyKey(userId) { return `user_concurrent:${userId}`; }

// ============================================================================
// PUBLISH
// ============================================================================

export async function enqueueTask({ type, userId, nodeId, payload }) {
    const ch = getChannel();
    if (!ch) throw new Error('RabbitMQ not available');

    const taskId = crypto.randomUUID();
    const queue = type === 'image' ? QUEUES.IMAGE : QUEUES.VIDEO;

    const task = {
        taskId,
        type,
        userId: String(userId),
        nodeId,
        payload,
        createdAt: Date.now(),
    };

    const redis = getRedis();
    if (redis) {
        const multi = redis.multi();
        multi.hmset(redisKey(taskId), {
            taskId,
            type,
            userId: String(userId),
            nodeId: nodeId || '',
            status: 'queued',
            createdAt: String(Date.now()),
        });
        multi.expire(redisKey(taskId), TASK_TTL);
        if (nodeId) {
            multi.set(nodeTaskKey(nodeId), taskId, 'EX', TASK_TTL);
        }
        await multi.exec();
    }

    ch.sendToQueue(queue, Buffer.from(JSON.stringify(task)), {
        persistent: true,
        messageId: taskId,
        headers: { userId: String(userId), type },
    });

    console.log(`[TaskQueue] Enqueued ${type} task ${taskId} for user ${userId} (node: ${nodeId || 'N/A'})`);
    return { taskId, status: 'queued' };
}

// ============================================================================
// STATUS
// ============================================================================

export async function getTaskStatus(taskId) {
    const redis = getRedis();
    if (!redis) return null;
    const data = await redis.hgetall(redisKey(taskId));
    if (!data || !data.taskId) return null;
    return data;
}

export async function getTaskByNodeId(nodeId) {
    const redis = getRedis();
    if (!redis) return null;
    const taskId = await redis.get(nodeTaskKey(nodeId));
    if (!taskId) return null;
    return getTaskStatus(taskId);
}

// Lua: state-machine guarded status update.
// Prevents overwriting terminal states (completed/failed) with earlier states.
const UPDATE_STATUS_LUA = `
local key = KEYS[1]
local newStatus = ARGV[1]
local ttl = tonumber(ARGV[2])
local curStatus = redis.call('HGET', key, 'status')
if curStatus == 'completed' or curStatus == 'failed' then
    return 0
end
local validTransitions = {
    queued = { processing = true, failed = true },
    processing = { completed = true, failed = true },
}
local allowed = validTransitions[curStatus]
if allowed and not allowed[newStatus] then
    return 0
end
return 1
`;

export async function updateTaskStatus(taskId, updates) {
    const redis = getRedis();
    if (!redis) return;

    // Validate state transition if status is being updated
    if (updates.status) {
        const allowed = await redis.eval(
            UPDATE_STATUS_LUA, 1, redisKey(taskId),
            updates.status, String(TASK_TTL)
        );
        if (allowed === 0) return; // Transition not allowed
    }

    const fields = {};
    for (const [k, v] of Object.entries(updates)) {
        fields[k] = v == null ? '' : String(v);
    }
    fields.updatedAt = String(Date.now());
    await redis.hmset(redisKey(taskId), fields);
    await redis.expire(redisKey(taskId), TASK_TTL);
}

// ============================================================================
// USER CONCURRENCY TRACKING (all operations via Lua for atomicity)
// ============================================================================

const USER_MAX = parseInt(process.env.RABBITMQ_USER_MAX_CONCURRENT) || 20;
const CONCURRENCY_TTL = 600; // 10 min safety net

// Lua: atomic check-and-increment. Returns 1 if allowed, 0 if limit reached.
const CHECK_AND_INCR_LUA = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local cur = tonumber(redis.call('GET', key) or '0')
if cur == nil then cur = 0 end
if cur >= max then return 0 end
redis.call('INCR', key)
redis.call('EXPIRE', key, ttl)
return 1
`;

// Lua: atomic decrement, auto-delete if ≤ 0 to prevent negative drift.
const SAFE_DECR_LUA = `
local key = KEYS[1]
local cur = tonumber(redis.call('GET', key) or '0')
if cur == nil or cur <= 0 then
    redis.call('DEL', key)
    return 0
end
local newVal = redis.call('DECR', key)
if newVal <= 0 then redis.call('DEL', key) end
return newVal
`;

/**
 * Atomically check concurrency limit and increment if allowed.
 * Returns true if the user is under the limit, false otherwise.
 */
export async function checkAndIncrementConcurrency(userId) {
    const redis = getRedis();
    if (!redis) return true;
    const result = await redis.eval(CHECK_AND_INCR_LUA, 1, userConcurrencyKey(userId), USER_MAX, CONCURRENCY_TTL);
    return result === 1;
}

/**
 * @deprecated Use checkAndIncrementConcurrency for atomic check+incr.
 */
export async function checkUserConcurrency(userId) {
    const redis = getRedis();
    if (!redis) return true;
    const count = parseInt(await redis.get(userConcurrencyKey(userId)) || '0');
    return count < USER_MAX;
}

export async function decrementUserConcurrency(userId) {
    const redis = getRedis();
    if (!redis) return;
    await redis.eval(SAFE_DECR_LUA, 1, userConcurrencyKey(userId));
}

// ============================================================================
// QUEUE STATS (for admin/monitoring)
// ============================================================================

export async function getQueueStats() {
    const ch = getChannel();
    if (!ch) return null;
    const [imgQ, vidQ] = await Promise.all([
        ch.checkQueue(QUEUES.IMAGE),
        ch.checkQueue(QUEUES.VIDEO),
    ]);
    return {
        image: { ready: imgQ.messageCount, consumers: imgQ.consumerCount },
        video: { ready: vidQ.messageCount, consumers: vidQ.consumerCount },
    };
}
