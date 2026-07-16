import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, testConnection, setDbAvailable } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPostSchemaMigrations(pool) {
    try {
        // Expand usage_logs.type enum to include 'text'
        const [cols] = await pool.execute(
            `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usage_logs' AND COLUMN_NAME = 'type'`
        );
        if (cols.length > 0 && !cols[0].COLUMN_TYPE.includes("'text'")) {
            await pool.execute(
                `ALTER TABLE usage_logs MODIFY COLUMN \`type\` ENUM('image','video','text') NOT NULL`
            );
            console.log('[DB] Migrated usage_logs.type to include text.');
        }

        // Add role column to users table
        const [roleCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
        );
        if (roleCols.length === 0) {
            await pool.execute(
                `ALTER TABLE users ADD COLUMN \`role\` ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER \`avatar_url\``
            );
            await pool.execute(`UPDATE users SET role = 'admin' WHERE username = 'admin'`);
            console.log('[DB] Migrated users table: added role column.');
        }

        // Add tokens column to usage_logs table
        const [tokensCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usage_logs' AND COLUMN_NAME = 'tokens'`
        );
        if (tokensCols.length === 0) {
            await pool.execute(
                `ALTER TABLE usage_logs ADD COLUMN \`tokens\` INT DEFAULT 0 COMMENT 'Total tokens consumed' AFTER \`cost\``
            );
            console.log('[DB] Migrated usage_logs table: added tokens column.');
        }

        // Add status column to users table
        const [statusCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'`
        );
        if (statusCols.length === 0) {
            await pool.execute(
                `ALTER TABLE users ADD COLUMN \`status\` ENUM('active','disabled') NOT NULL DEFAULT 'active' AFTER \`role\``
            );
            console.log('[DB] Migrated users table: added status column.');
        }

        // Add node_id column to images table (fixes history: each generation gets its own record)
        const [imgNodeCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'images' AND COLUMN_NAME = 'node_id'`
        );
        if (imgNodeCols.length === 0) {
            await pool.execute(
                `ALTER TABLE images ADD COLUMN \`node_id\` VARCHAR(128) DEFAULT NULL COMMENT 'Canvas node ID for generation recovery' AFTER \`user_id\``
            );
            await pool.execute(`ALTER TABLE images ADD INDEX \`idx_images_node\` (\`node_id\`)`);
            console.log('[DB] Migrated images table: added node_id column.');
        }

        // Add node_id column to videos table
        const [vidNodeCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'videos' AND COLUMN_NAME = 'node_id'`
        );
        if (vidNodeCols.length === 0) {
            await pool.execute(
                `ALTER TABLE videos ADD COLUMN \`node_id\` VARCHAR(128) DEFAULT NULL COMMENT 'Canvas node ID for generation recovery' AFTER \`user_id\``
            );
            await pool.execute(`ALTER TABLE videos ADD INDEX \`idx_videos_node\` (\`node_id\`)`);
            console.log('[DB] Migrated videos table: added node_id column.');
        }
        // Add file_size column to images table
        const [imgSizeCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'images' AND COLUMN_NAME = 'file_size'`
        );
        if (imgSizeCols.length === 0) {
            await pool.execute(
                `ALTER TABLE images ADD COLUMN \`file_size\` BIGINT UNSIGNED DEFAULT 0 COMMENT 'File size in bytes' AFTER \`local_url\``
            );
            console.log('[DB] Migrated images table: added file_size column.');
        }

        // Add file_size column to videos table
        const [vidSizeCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'videos' AND COLUMN_NAME = 'file_size'`
        );
        if (vidSizeCols.length === 0) {
            await pool.execute(
                `ALTER TABLE videos ADD COLUMN \`file_size\` BIGINT UNSIGNED DEFAULT 0 COMMENT 'File size in bytes' AFTER \`local_url\``
            );
            console.log('[DB] Migrated videos table: added file_size column.');
        }
        // Add resolution_pricing JSON column to model_pricing
        const [resPricingCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_pricing' AND COLUMN_NAME = 'resolution_pricing'`
        );
        if (resPricingCols.length === 0) {
            await pool.execute(
                `ALTER TABLE model_pricing ADD COLUMN \`resolution_pricing\` JSON DEFAULT NULL COMMENT 'Per-resolution per-mode pricing' AFTER \`cost_per_1k_tokens\``
            );
            console.log('[DB] Migrated model_pricing table: added resolution_pricing column.');
        }
    } catch (err) {
        console.warn('[DB] Post-schema migration warning:', err.message);
    }
}

async function seedResolutionPricing(pool) {
    try {
        const [check] = await pool.execute(
            `SELECT COUNT(*) as cnt FROM model_pricing WHERE resolution_pricing IS NOT NULL`
        );
        if (check[0].cnt > 0) return;

        console.log('[DB] Seeding resolution_pricing data from Tencent VOD price list...');

        const updates = [
            // ── VIDEO MODELS (tencent-vod) ── base_cost=0, cost_per_second=1080P text rate
            [`Hailuo/02`,    0, 0.58,  JSON.stringify({"text":{"720p":0.33,"1080p":0.58,"2k":0.93,"4k":1.49}})],
            [`Hailuo/2.3`,   0, 0.58,  JSON.stringify({"text":{"720p":0.33,"1080p":0.58,"2k":0.93,"4k":1.49}})],
            [`Hailuo/2.3-fast`, 0, 0.385, JSON.stringify({"text":{"720p":0.225,"1080p":0.385,"2k":0.58,"4k":0.87}})],

            [`Kling/1.6`,    0, 0.7,   JSON.stringify({"text":{"720p":0.4,"1080p":0.7,"2k":1,"4k":1.5}})],
            [`Kling/2.1`,    0, 0.7,   JSON.stringify({"text":{"720p":0.4,"1080p":0.7,"2k":1,"4k":1.5}})],
            [`Kling/2.5`,    0, 0.5,   JSON.stringify({"text":{"720p":0.3,"1080p":0.5,"2k":0.75,"4k":1.12}})],
            [`Kling/O1`,     0, 0.8,   JSON.stringify({"text":{"720p":0.6,"1080p":0.8,"2k":1.2,"4k":1.8},"img":{"720p":0.9,"1080p":1.2,"2k":1.8,"4k":2.7}})],
            [`Kling/2.6`,    0, 0.5,   JSON.stringify({"text":{"720p":0.3,"1080p":0.5,"2k":0.75,"4k":1.12},"text_audio":{"1080p":1,"2k":1.5,"4k":2.25}})],
            [`Kling/2.6-audio`, 0, 1,  JSON.stringify({"text":{"1080p":1,"2k":1.5,"4k":2.25},"text_audio":{"1080p":1,"2k":1.5,"4k":2.25},"img":{"1080p":1,"2k":1.5,"4k":2.25},"img_audio":{"1080p":1,"2k":1.5,"4k":2.25}})],
            [`Kling/3.0`,    0, 0.8,   JSON.stringify({"text":{"720p":0.6,"1080p":0.8,"2k":1,"4k":1.2},"text_audio":{"720p":0.9,"1080p":1.2,"2k":1.5,"4k":2},"img":{"720p":0.6,"1080p":0.8,"2k":1,"4k":1.2},"img_audio":{"720p":0.9,"1080p":1.2,"2k":1.5,"4k":2}})],
            [`Kling/3.0-Omni`, 0, 0.8, JSON.stringify({"text":{"720p":0.6,"1080p":0.8,"2k":1,"4k":1.2},"text_audio":{"720p":0.8,"1080p":1,"2k":1.2,"4k":1.5},"img":{"720p":0.9,"1080p":1.2,"2k":1.5,"4k":2},"img_audio":{"720p":1.1,"1080p":1.4,"2k":1.8,"4k":2.4}})],

            [`Vidu/q2`,      0, 0.47,  JSON.stringify({"text":{"720p":0.32,"1080p":0.47,"2k":0.7,"4k":1.05},"img":{"480p":0.24,"720p":0.32,"1080p":0.82,"2k":1.23,"4k":1.845}})],
            [`Vidu/q2-pro`,  0, 0.7,   JSON.stringify({"img":{"720p":0.35,"1080p":0.7,"2k":1,"4k":1.5},"ref":{"480p":0.27,"720p":0.35,"1080p":0.9,"2k":1.35,"4k":2.025}})],
            [`Vidu/q2-turbo`, 0, 0.47, JSON.stringify({"img":{"720p":0.25,"1080p":0.47,"2k":0.7,"4k":1.05}})],
            [`Vidu/q3`,      0, 0.782, JSON.stringify({"text":{"480p":0.3125,"720p":0.625,"1080p":0.782,"2k":0.939,"4k":1.127}})],
            [`Vidu/q3-pro`,  0, 0.938, JSON.stringify({"text":{"480p":0.313,"720p":0.782,"1080p":0.938,"2k":1.1256,"4k":1.35072},"img":{"480p":0.313,"720p":0.782,"1080p":0.938,"2k":1.1256,"4k":1.35072}})],
            [`Vidu/q3-turbo`, 0, 0.438, JSON.stringify({"text":{"480p":0.25,"720p":0.375,"1080p":0.438,"2k":0.5256,"4k":0.63072},"img":{"480p":0.25,"720p":0.375,"1080p":0.438,"2k":0.5256,"4k":0.63072}})],

            [`Jimeng/3.0pro`, 0, 1,    JSON.stringify({"text":{"1080p":1,"2k":1.5,"4k":2.25}})],

            [`Seedance/1.5-pro`,      0, 0.388, JSON.stringify({"text":{"480p":0.08,"720p":0.172,"1080p":0.388,"2k":0.691,"4k":1.552},"text_audio":{"480p":0.16,"720p":0.346,"1080p":0.778,"2k":1.382,"4k":3.11}})],
            [`Seedance/1.0-pro`,      0, 0.734, JSON.stringify({"text":{"480p":0.146,"720p":0.308,"1080p":0.734,"2k":1.101,"4k":1.6515}})],
            [`Seedance/1.0-pro-fast`, 0, 0.206, JSON.stringify({"text":{"480p":0.04,"720p":0.086,"1080p":0.206,"2k":0.309,"4k":0.4635}})],
            [`Seedance/1.0-lite-i2v`, 0, 0.49,  JSON.stringify({"text":{"480p":0.098,"720p":0.206,"1080p":0.49,"2k":0.735,"4k":1.1025}})],

            [`GV/3.1`,       0, 1.5,   JSON.stringify({"text":{"720p":1.5,"1080p":1.5,"2k":2.25,"4k":3},"text_audio":{"720p":3,"1080p":3,"2k":3.75,"4k":4.5}})],
            [`GV/3.1-fast`,  0, 0.75,  JSON.stringify({"text":{"720p":0.75,"1080p":0.75,"2k":1.5,"4k":2.25},"text_audio":{"720p":1.125,"1080p":1.125,"2k":1.875,"4k":2.625}})],
            [`OS/2.0`,       0, 1.125, JSON.stringify({"text":{"720p":0.75,"1080p":1.125,"2k":1.688,"4k":2.531}})],
            [`Hunyuan/1.5`,  0, 0.5,   JSON.stringify({"text":{"720p":0.3,"1080p":0.5,"2k":0.75,"4k":1.12}})],

            // ── IMAGE MODELS ── base_cost = default 1K price
            [`gem-2.5`,      0.3,    0, JSON.stringify({"default":{"1k":0.3,"2k":0.38,"4k":0.46}})],
            [`gem-3.0`,      1,      0, JSON.stringify({"default":{"1k":1,"2k":1,"4k":1.8}})],
            [`gem-3.1`,      0.5,    0, JSON.stringify({"default":{"512":0.333,"1k":0.5,"2k":0.75,"4k":1.12}})],
            [`kling-img-2.1`, 0.1,   0, JSON.stringify({"default":{"1k":0.1,"2k":0.1,"4k":0.26},"ref":{"1k":0.4,"2k":0.48,"4k":0.56}})],
            [`kling-img-3.0`, 0.2,   0, JSON.stringify({"default":{"1k":0.2,"2k":0.2,"4k":0.4}})],
            [`kling-img-3.0-omni`, 0.2, 0, JSON.stringify({"default":{"1k":0.2,"2k":0.2,"4k":0.4}})],
            [`kling-img-o1`, 0.2,    0, JSON.stringify({"default":{"1k":0.2,"2k":0.2,"4k":0.4}})],
            [`vidu-q2`,      0.1875, 0, JSON.stringify({"default":{"1k":0.1875,"2k":0.25,"4k":0.3125},"ref":{"1k":0.25,"2k":0.375,"4k":0.5}})],
            [`si-4.0`,       0.2,    0, JSON.stringify({"default":{"1k":0.2,"2k":0.2,"4k":0.2}})],
            [`si-4.5`,       0.25,   0, JSON.stringify({"default":{"1k":0.25,"2k":0.25,"4k":0.25}})],
            [`si-5.0-lite`,  0.22,   0, JSON.stringify({"default":{"1k":0.22,"2k":0.22,"4k":0.22}})],
            [`jimeng-4.0`,   0.22,   0, JSON.stringify({"default":{"1k":0.22,"2k":0.22,"4k":0.22}})],
            [`hunyuan-3.0`,  0.2,    0, JSON.stringify({"default":{"1k":0.2,"2k":0.28,"4k":0.36}})],
            [`qwen-0925`,    0.3,    0, JSON.stringify({"default":{"1k":0.3,"2k":0.38,"4k":0.46}})],
            [`midjourney-v7`, 0.3,   0, JSON.stringify({"default":{"1k":0.3,"2k":0.38,"4k":0.46}})],
            [`og-image2-low`,    0.3,   0, JSON.stringify({"default":{"1k":0.3,"2k":0.338,"4k":0.398}})],
            [`og-image2-medium`, 0.638, 0, JSON.stringify({"default":{"1k":0.638,"2k":1.05,"4k":1.583}})],
            [`og-image2-high`,   1.838, 0, JSON.stringify({"default":{"1k":1.838,"2k":3.45,"4k":5.588}})],
        ];

        for (const [modelId, baseCost, costPerSecond, resPricing] of updates) {
            await pool.execute(
                `UPDATE model_pricing SET base_cost = ?, cost_per_second = ?, resolution_pricing = ? WHERE model_id = ?`,
                [baseCost, costPerSecond, resPricing, modelId]
            );
        }

        console.log(`[DB] Seeded resolution_pricing for ${updates.length} models.`);
    } catch (err) {
        console.warn('[DB] Resolution pricing seed warning:', err.message);
    }
}

export async function runMigrations() {
    const connected = await testConnection();
    if (!connected) return false;

    const pool = getPool();

    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // Strip single-line comments, then split by semicolons
        const cleaned = schema.replace(/--.*$/gm, '');
        const statements = cleaned
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        // Run CREATE TABLE statements first
        const createStmts = statements.filter(s => /^CREATE\s/i.test(s));
        const seedStmts = statements.filter(s => !/^CREATE\s/i.test(s));

        for (const stmt of createStmts) {
            await pool.execute(stmt);
        }

        // Run column migrations before seed data (seeds may reference new columns)
        await runPostSchemaMigrations(pool);

        for (const stmt of seedStmts) {
            await pool.execute(stmt);
        }

        // Seed resolution-based pricing for existing models
        await seedResolutionPricing(pool);

        console.log('[DB] Schema migration completed successfully.');
        setDbAvailable(true);
        return true;
    } catch (err) {
        console.error('[DB] Migration failed:', err.message);
        setDbAvailable(false);
        return false;
    }
}
