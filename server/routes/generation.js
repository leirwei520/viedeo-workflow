/**
 * generation.js
 * 
 * Routes for AI image and video generation.
 * Supports Tencent GEM, Kling AI, Hailuo AI providers.
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getModelPrice, calculateCost, detectGenerationMode } from './pricing.js';
import { getBalance, deductBalance, persistDeduction, refundBalance } from '../services/balance.js';
import { getGenerationStatus } from '../services/storage.js';
import { enqueueTask, getTaskByNodeId, checkAndIncrementConcurrency, decrementUserConcurrency, getQueueStats } from '../services/taskQueue.js';
import { getChannel } from '../services/rabbitmq.js';

const router = express.Router();

async function getModelCost(model, { duration, tokens, resolution, mode } = {}) {
    const priceEntry = await getModelPrice(model);
    return calculateCost(priceEntry, { duration, tokens, resolution, mode });
}

/**
 * Check if user has sufficient balance for a model call.
 * Reads from Redis cache first, falls back to DB.
 * Throws 402 if balance is insufficient.
 */
export async function checkBalance(userId, model, { duration, resolution, mode } = {}) {
    if (!userId) return;

    const estimatedCost = await getModelCost(model, { duration, resolution, mode });
    if (estimatedCost <= 0) return;

    const balance = await getBalance(userId);

    if (balance < estimatedCost) {
        const err = new Error(`余额不足，当前余额 ¥${balance.toFixed(2)}，预估费用 ¥${estimatedCost.toFixed(2)}`);
        err.status = 402;
        throw err;
    }
}

/**
 * Pre-deduct balance atomically via Redis Lua script before generation.
 * Returns the cost so caller can refund on failure.
 * Throws 402 if insufficient.
 */
export async function preDeduct(userId, model, { duration, resolution, mode } = {}) {
    if (!userId) return { cost: 0, source: 'none' };

    const estimatedCost = await getModelCost(model, { duration, resolution, mode });
    if (estimatedCost <= 0) return { cost: 0, source: 'none' };

    const { success, source } = await deductBalance(userId, estimatedCost);
    if (!success) {
        const balance = await getBalance(userId);
        const err = new Error(`余额不足，当前余额 ¥${balance.toFixed(2)}，预估费用 ¥${estimatedCost.toFixed(2)}`);
        err.status = 402;
        throw err;
    }
    return { cost: estimatedCost, source };
}

/**
 * Log usage and persist deduction to DB.
 * @param preDeducted - if true, balance was already debited via preDeduct.
 * @param preDeductSource - 'redis' | 'db' — where the pre-deduction happened.
 */
export async function logUsage({ userId, type, model, prompt, cost, tokens, status, resultUrl, preDeducted = false, preDeductSource = 'redis' }) {
    await persistDeduction({ userId, type, model, prompt, cost, tokens, status, resultUrl, preDeducted, preDeductSource });
}

// ============================================================================
// IMAGE GENERATION
// ============================================================================

router.post('/generate-image', authMiddleware, async (req, res) => {
    const userId = req.userId;
    let concurrencyAcquired = false;
    let preDeductedCost = 0;
    let preDeductSource = 'none';
    let enqueued = false;
    try {
        const { nodeId, prompt, imageModel, resolution, imageBase64 } = req.body;
        const mode = detectGenerationMode({ imageBase64, type: 'image' });

        const deduction = await preDeduct(userId, imageModel, { resolution, mode });
        preDeductedCost = deduction.cost;
        preDeductSource = deduction.source;

        concurrencyAcquired = await checkAndIncrementConcurrency(userId);
        if (!concurrencyAcquired) {
            if (preDeductedCost > 0) await refundBalance(userId, preDeductedCost, { redisOnly: preDeductSource === 'redis' });
            preDeductedCost = 0;
            return res.status(429).json({ error: '并发任务数已达上限，请稍后再试' });
        }

        if (getChannel()) {
            const result = await enqueueTask({
                type: 'image',
                userId,
                nodeId,
                payload: { ...req.body, preDeductedCost, preDeductSource },
            });
            enqueued = true;
            return res.status(202).json({ taskId: result.taskId, status: 'queued' });
        }

        console.warn('[Generation] RabbitMQ unavailable, falling back to direct execution');
        const { directGenerateImage } = await import('./generation-direct.js');
        const resultUrl = await directGenerateImage(req, preDeductedCost);
        await logUsage({ userId, type: 'image', model: imageModel || 'chuhaibang', prompt, cost: preDeductedCost, status: 'success', resultUrl, preDeducted: true, preDeductSource });
        preDeductedCost = 0;
        return res.json({ resultUrl });

    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error("Server Image Gen Error:", error);
        if (preDeductedCost > 0) {
            await refundBalance(userId, preDeductedCost, { redisOnly: preDeductSource === 'redis' }).catch(e =>
                console.error('[Generation] Refund failed:', e.message));
        }
        await logUsage({ userId, type: 'image', model: req.body.imageModel || 'unknown', prompt: req.body.prompt, cost: 0, status: 'failed', preDeducted: false });
        res.status(500).json({ error: error.message || "Image generation failed" });
    } finally {
        if (concurrencyAcquired && !enqueued) {
            await decrementUserConcurrency(userId);
        }
    }
});

// ============================================================================
// VIDEO GENERATION
// ============================================================================

router.post('/generate-video', authMiddleware, async (req, res) => {
    const userId = req.userId;
    let concurrencyAcquired = false;
    let preDeductedCost = 0;
    let preDeductSource = 'none';
    let enqueued = false;
    try {
        const { nodeId, prompt, videoModel, duration, resolution, imageBase64, lastFrameBase64, frameImages, motionReferenceUrl, generateAudio } = req.body;
        const mode = detectGenerationMode({ imageBase64, lastFrameBase64, frameImages, motionReferenceUrl, generateAudio, type: 'video' });

        const deduction = await preDeduct(userId, videoModel, { duration: duration || 5, resolution, mode });
        preDeductedCost = deduction.cost;
        preDeductSource = deduction.source;

        concurrencyAcquired = await checkAndIncrementConcurrency(userId);
        if (!concurrencyAcquired) {
            if (preDeductedCost > 0) await refundBalance(userId, preDeductedCost, { redisOnly: preDeductSource === 'redis' });
            preDeductedCost = 0;
            return res.status(429).json({ error: '并发任务数已达上限，请稍后再试' });
        }

        if (getChannel()) {
            const result = await enqueueTask({
                type: 'video',
                userId,
                nodeId,
                payload: { ...req.body, preDeductedCost, preDeductSource },
            });
            enqueued = true;
            return res.status(202).json({ taskId: result.taskId, status: 'queued' });
        }

        console.warn('[Generation] RabbitMQ unavailable, falling back to direct execution');
        const { directGenerateVideo } = await import('./generation-direct.js');
        const resultUrl = await directGenerateVideo(req, preDeductedCost);
        await logUsage({ userId, type: 'video', model: videoModel || 'veo-3.1', prompt, cost: preDeductedCost, status: 'success', resultUrl, preDeducted: true, preDeductSource });
        preDeductedCost = 0;
        return res.json({ resultUrl });

    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error("Server Video Gen Error:", error);
        if (preDeductedCost > 0) {
            await refundBalance(userId, preDeductedCost, { redisOnly: preDeductSource === 'redis' }).catch(e =>
                console.error('[Generation] Refund failed:', e.message));
        }
        await logUsage({ userId, type: 'video', model: req.body.videoModel || 'unknown', prompt: req.body.prompt, cost: 0, status: 'failed', preDeducted: false });
        res.status(500).json({ error: error.message || "Video generation failed" });
    } finally {
        if (concurrencyAcquired && !enqueued) {
            await decrementUserConcurrency(userId);
        }
    }
});

// ============================================================================
// GENERATION STATUS / RECOVERY
// ============================================================================

/**
 * Check if a generation has finished for a specific nodeId.
 * First checks Redis task queue, then falls back to DB lookup.
 */
router.get('/generation-status/:nodeId', authMiddleware, async (req, res) => {
    try {
        const { nodeId } = req.params;
        const userId = String(req.userId);

        const task = await getTaskByNodeId(nodeId);
        if (task && task.status) {
            if (task.userId && task.userId !== userId) {
                return res.json({ status: 'pending' });
            }
            if (task.status === 'completed' && task.resultUrl) {
                return res.json({ status: 'success', resultUrl: task.resultUrl, type: task.type });
            }
            if (task.status === 'failed') {
                return res.json({ status: 'failed', error: task.error || 'Generation failed', createdAt: task.createdAt });
            }
            if (task.status === 'queued' || task.status === 'processing') {
                return res.json({ status: task.status });
            }
        }

        const result = await getGenerationStatus(nodeId, userId);
        if (result) return res.json(result);
        res.json({ status: 'pending' });
    } catch (error) {
        console.error("Status Check Error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Queue statistics endpoint for monitoring.
 */
router.get('/queue-stats', authMiddleware, async (req, res) => {
    try {
        const stats = await getQueueStats();
        res.json(stats || { image: { ready: 0, consumers: 0 }, video: { ready: 0, consumers: 0 } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
