-- Chuhai Bang Cloud Sync Schema

CREATE TABLE IF NOT EXISTS `workflows` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(255) DEFAULT NULL,
    `data` LONGTEXT NOT NULL COMMENT 'Full workflow JSON',
    `cover_url` TEXT DEFAULT NULL COMMENT 'OSS URL for cover image',
    `node_count` INT DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_workflows_user` (`user_id`),
    INDEX `idx_workflows_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `images` (
    `id` VARCHAR(128) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `node_id` VARCHAR(128) DEFAULT NULL COMMENT 'Canvas node ID for generation recovery',
    `filename` VARCHAR(255) NOT NULL,
    `prompt` TEXT DEFAULT NULL,
    `model` VARCHAR(64) DEFAULT NULL,
    `oss_url` TEXT DEFAULT NULL COMMENT 'Aliyun OSS public URL',
    `local_url` VARCHAR(512) DEFAULT NULL COMMENT 'Local /library/images/... path',
    `file_size` BIGINT UNSIGNED DEFAULT 0 COMMENT 'File size in bytes',
    `metadata` JSON DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_images_user` (`user_id`),
    INDEX `idx_images_created` (`created_at`),
    INDEX `idx_images_node` (`node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `videos` (
    `id` VARCHAR(128) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `node_id` VARCHAR(128) DEFAULT NULL COMMENT 'Canvas node ID for generation recovery',
    `filename` VARCHAR(255) NOT NULL,
    `prompt` TEXT DEFAULT NULL,
    `model` VARCHAR(64) DEFAULT NULL,
    `aspect_ratio` VARCHAR(16) DEFAULT NULL,
    `resolution` VARCHAR(32) DEFAULT NULL,
    `duration` FLOAT DEFAULT NULL,
    `oss_url` TEXT DEFAULT NULL COMMENT 'Aliyun OSS public URL',
    `local_url` VARCHAR(512) DEFAULT NULL COMMENT 'Local /library/videos/... path',
    `file_size` BIGINT UNSIGNED DEFAULT 0 COMMENT 'File size in bytes',
    `metadata` JSON DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_videos_user` (`user_id`),
    INDEX `idx_videos_created` (`created_at`),
    INDEX `idx_videos_node` (`node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sync_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `entity_type` ENUM('workflow', 'image', 'video') NOT NULL,
    `entity_id` VARCHAR(128) NOT NULL,
    `action` ENUM('upload', 'update', 'delete') NOT NULL,
    `oss_key` VARCHAR(512) DEFAULT NULL,
    `synced_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_sync_entity` (`entity_type`, `entity_id`),
    INDEX `idx_sync_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════
--  User Authentication & Billing
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `users` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(100) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `nickname` VARCHAR(100) DEFAULT NULL,
    `avatar_url` TEXT DEFAULT NULL,
    `role` ENUM('user','admin') NOT NULL DEFAULT 'user',
    `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
    `token_balance` DECIMAL(10,4) DEFAULT 0.0000 COMMENT 'RMB balance (¥) for billing',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `idx_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `recharge_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `admin_id` INT NOT NULL COMMENT 'Admin who performed the recharge',
    `amount` DECIMAL(10,4) NOT NULL COMMENT 'RMB amount (¥) added',
    `balance_before` DECIMAL(10,4) NOT NULL,
    `balance_after` DECIMAL(10,4) NOT NULL,
    `remark` VARCHAR(500) DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_recharge_user` (`user_id`),
    INDEX `idx_recharge_admin` (`admin_id`),
    INDEX `idx_recharge_created` (`created_at`),
    CONSTRAINT `fk_recharge_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_recharge_admin` FOREIGN KEY (`admin_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `refresh_tokens` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `token_hash` VARCHAR(255) NOT NULL,
    `expires_at` DATETIME NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_rt_user` (`user_id`),
    INDEX `idx_rt_hash` (`token_hash`),
    CONSTRAINT `fk_rt_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `usage_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `type` ENUM('image','video') NOT NULL,
    `model` VARCHAR(64) NOT NULL,
    `prompt` TEXT DEFAULT NULL,
    `cost` DECIMAL(10,4) DEFAULT 0.0000,
    `tokens` INT DEFAULT 0 COMMENT 'Total tokens consumed (prompt+completion)',
    `status` ENUM('success','failed') DEFAULT 'success',
    `result_url` TEXT DEFAULT NULL,
    `metadata` JSON DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_usage_user` (`user_id`),
    INDEX `idx_usage_created` (`created_at`),
    CONSTRAINT `fk_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════
--  Model Pricing
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `model_pricing` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `model_id` VARCHAR(100) NOT NULL COMMENT 'Model identifier matching frontend (e.g. gem-3.0, Kling/3.0)',
    `model_name` VARCHAR(100) NOT NULL COMMENT 'Display name',
    `type` ENUM('image','video','text') NOT NULL,
    `provider` VARCHAR(50) NOT NULL COMMENT 'tencent-vod, fal, tencent-text, gemini',
    `base_cost` DECIMAL(10,4) NOT NULL DEFAULT 1.0000 COMMENT 'Base cost in RMB (¥) per call',
    `cost_per_second` DECIMAL(10,4) DEFAULT 0.0000 COMMENT 'Additional ¥ per second (video only)',
    `cost_per_1k_tokens` DECIMAL(10,4) DEFAULT 0.0000 COMMENT '¥ per 1K tokens (text only)',
    `resolution_pricing` JSON DEFAULT NULL COMMENT 'Per-resolution per-mode pricing: {"mode": {"resolution": price}}',
    `is_active` TINYINT(1) DEFAULT 1 COMMENT 'Whether model is available',
    `sort_order` INT DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `idx_pricing_model` (`model_id`),
    INDEX `idx_pricing_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════
--  Chat Sessions
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `chat_sessions` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `topic` VARCHAR(255) DEFAULT NULL,
    `messages` LONGTEXT NOT NULL COMMENT 'Serialized messages JSON array',
    `message_count` INT DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_chats_user` (`user_id`),
    INDEX `idx_chats_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════
--  Library Assets (curated user asset library)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `library_assets` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `category` VARCHAR(100) NOT NULL,
    `type` ENUM('image','video') NOT NULL DEFAULT 'image',
    `oss_url` TEXT NOT NULL,
    `metadata` JSON DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_libass_user` (`user_id`),
    INDEX `idx_libass_category` (`user_id`, `category`),
    INDEX `idx_libass_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════
--  TTS History (voice synthesis records)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `tts_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `text` TEXT NOT NULL,
    `speaker` VARCHAR(128) NOT NULL,
    `model` VARCHAR(64) NOT NULL DEFAULT 'seed-tts-2.0',
    `audio_url` TEXT NOT NULL,
    `filename` VARCHAR(255) DEFAULT NULL,
    `format` VARCHAR(16) DEFAULT 'mp3',
    `size` INT DEFAULT 0,
    `duration_chars` INT DEFAULT 0,
    `params` JSON DEFAULT NULL COMMENT 'speechRate, volume, pitch, emotion, toneHint etc.',
    `subtitles` JSON DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_tts_user` (`user_id`),
    INDEX `idx_tts_created` (`created_at`),
    CONSTRAINT `fk_tts_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default admin user (username: admin / password: 123456)
-- Note: role is set via post-schema migration to avoid column-not-found on first run
INSERT IGNORE INTO `users` (`username`, `password_hash`, `nickname`, `token_balance`)
VALUES ('admin', '$2b$12$XlRsaF3hhCu.ysHj2zQQXuf6vX60/21O8gbFiSllStmwBlaYTBOBi', 'Admin', 100.0000);

-- ═══════════════════════════════════════════════════════
--  Seed: Model Pricing Data
-- ═══════════════════════════════════════════════════════

INSERT IGNORE INTO `model_pricing` (`model_id`, `model_name`, `type`, `provider`, `base_cost`, `cost_per_second`, `resolution_pricing`, `sort_order`) VALUES
('gem-2.5',            'Nano Banana',          'image', 'tencent-vod', 0.3000, 0.0000, '{"default":{"1k":0.3,"2k":0.38,"4k":0.46}}', 10),
('gem-3.0',            'Nano Banana Pro',      'image', 'tencent-vod', 1.0000, 0.0000, '{"default":{"1k":1,"2k":1,"4k":1.8}}', 11),
('gem-3.1',            'Nano2',                'image', 'tencent-vod', 0.5000, 0.0000, '{"default":{"512":0.333,"1k":0.5,"2k":0.75,"4k":1.12}}', 12),
('kling-img-2.1',      '可灵 2.1',              'image', 'tencent-vod', 0.1000, 0.0000, '{"default":{"1k":0.1,"2k":0.1,"4k":0.26},"ref":{"1k":0.4,"2k":0.48,"4k":0.56}}', 20),
('kling-img-3.0',      '可灵 3.0',              'image', 'tencent-vod', 0.2000, 0.0000, '{"default":{"1k":0.2,"2k":0.2,"4k":0.4}}', 21),
('kling-img-3.0-omni', '可灵 3.0 Omni',         'image', 'tencent-vod', 0.2000, 0.0000, '{"default":{"1k":0.2,"2k":0.2,"4k":0.4}}', 22),
('kling-img-o1',       '可灵 O1',               'image', 'tencent-vod', 0.2000, 0.0000, '{"default":{"1k":0.2,"2k":0.2,"4k":0.4}}', 23),
('vidu-q2',            '生数 Vidu Q2',           'image', 'tencent-vod', 0.1875, 0.0000, '{"default":{"1k":0.1875,"2k":0.25,"4k":0.3125},"ref":{"1k":0.25,"2k":0.375,"4k":0.5}}', 30),
('si-4.0',             '豆包 Seedream 4.0',      'image', 'tencent-vod', 0.2000, 0.0000, '{"default":{"1k":0.2,"2k":0.2,"4k":0.2}}', 40),
('si-4.5',             '豆包 Seedream 4.5',      'image', 'tencent-vod', 0.2500, 0.0000, '{"default":{"1k":0.25,"2k":0.25,"4k":0.25}}', 41),
('si-5.0-lite',        '豆包 Seedream 5.0 Lite', 'image', 'tencent-vod', 0.2200, 0.0000, '{"default":{"1k":0.22,"2k":0.22,"4k":0.22}}', 42),
('jimeng-4.0',         '即梦 4.0',              'image', 'tencent-vod', 0.2200, 0.0000, '{"default":{"1k":0.22,"2k":0.22,"4k":0.22}}', 50),
('hunyuan-3.0',        '混元 3.0',              'image', 'tencent-vod', 0.2000, 0.0000, '{"default":{"1k":0.2,"2k":0.28,"4k":0.36}}', 60),
('qwen-0925',          '千问 0925',             'image', 'tencent-vod', 0.3000, 0.0000, '{"default":{"1k":0.3,"2k":0.38,"4k":0.46}}', 70),
('qwen-2.0',           '千问 2.0',              'image', 'tencent-vod', 1.0000, 0.0000, NULL, 71),
('midjourney-v7',      'Midjourney v7',        'image', 'tencent-vod', 0.3000, 0.0000, '{"default":{"1k":0.3,"2k":0.38,"4k":0.46}}', 80),
('og-image2-low',      'Image 2 快速',         'image', 'tencent-vod', 0.3000, 0.0000, '{"default":{"1k":0.3,"2k":0.338,"4k":0.398}}', 90),
('og-image2-medium',   'Image 2 标准',         'image', 'tencent-vod', 0.6380, 0.0000, '{"default":{"1k":0.638,"2k":1.05,"4k":1.583}}', 91),
('og-image2-high',     'Image 2 高质量',       'image', 'tencent-vod', 1.8380, 0.0000, '{"default":{"1k":1.838,"2k":3.45,"4k":5.588}}', 92);

INSERT IGNORE INTO `model_pricing` (`model_id`, `model_name`, `type`, `provider`, `base_cost`, `cost_per_second`, `resolution_pricing`, `sort_order`) VALUES
('Hailuo/02',              '海螺 02',            'video', 'tencent-vod', 0.0000, 0.5800, '{"text":{"720p":0.33,"1080p":0.58,"2k":0.93,"4k":1.49}}', 100),
('Hailuo/2.3',             '海螺 2.3',           'video', 'tencent-vod', 0.0000, 0.5800, '{"text":{"720p":0.33,"1080p":0.58,"2k":0.93,"4k":1.49}}', 101),
('Hailuo/2.3-fast',        '海螺 2.3 Fast',      'video', 'tencent-vod', 0.0000, 0.3850, '{"text":{"720p":0.225,"1080p":0.385,"2k":0.58,"4k":0.87}}', 102),
('Kling/1.6',              '可灵 1.6',           'video', 'tencent-vod', 0.0000, 0.7000, '{"text":{"720p":0.4,"1080p":0.7,"2k":1,"4k":1.5}}', 110),
('Kling/2.1',              '可灵 2.1',           'video', 'tencent-vod', 0.0000, 0.7000, '{"text":{"720p":0.4,"1080p":0.7,"2k":1,"4k":1.5}}', 111),
('Kling/2.5',              '可灵 2.5 Turbo',     'video', 'tencent-vod', 0.0000, 0.5000, '{"text":{"720p":0.3,"1080p":0.5,"2k":0.75,"4k":1.12}}', 112),
('Kling/O1',               '可灵 O1',            'video', 'tencent-vod', 0.0000, 0.8000, '{"text":{"720p":0.6,"1080p":0.8,"2k":1.2,"4k":1.8},"img":{"720p":0.9,"1080p":1.2,"2k":1.8,"4k":2.7}}', 113),
('Kling/2.6',              '可灵 2.6',           'video', 'tencent-vod', 0.0000, 0.5000, '{"text":{"720p":0.3,"1080p":0.5,"2k":0.75,"4k":1.12},"text_audio":{"1080p":1,"2k":1.5,"4k":2.25}}', 114),
('Kling/2.6-audio',        '可灵 2.6 音画同出',    'video', 'tencent-vod', 0.0000, 1.0000, '{"text":{"1080p":1,"2k":1.5,"4k":2.25},"text_audio":{"1080p":1,"2k":1.5,"4k":2.25},"img":{"1080p":1,"2k":1.5,"4k":2.25},"img_audio":{"1080p":1,"2k":1.5,"4k":2.25}}', 115),
('Kling/3.0',              '可灵 3.0',           'video', 'tencent-vod', 0.0000, 0.8000, '{"text":{"720p":0.6,"1080p":0.8,"2k":1,"4k":1.2},"text_audio":{"720p":0.9,"1080p":1.2,"2k":1.5,"4k":2},"img":{"720p":0.6,"1080p":0.8,"2k":1,"4k":1.2},"img_audio":{"720p":0.9,"1080p":1.2,"2k":1.5,"4k":2}}', 116),
('Kling/3.0-Omni',         '可灵 3.0 Omni',      'video', 'tencent-vod', 0.0000, 0.8000, '{"text":{"720p":0.6,"1080p":0.8,"2k":1,"4k":1.2},"text_audio":{"720p":0.8,"1080p":1,"2k":1.2,"4k":1.5},"img":{"720p":0.9,"1080p":1.2,"2k":1.5,"4k":2},"img_audio":{"720p":1.1,"1080p":1.4,"2k":1.8,"4k":2.4}}', 117),
('Vidu/q2',                '生数 Q2',            'video', 'tencent-vod', 0.0000, 0.4700, '{"text":{"720p":0.32,"1080p":0.47,"2k":0.7,"4k":1.05},"img":{"480p":0.24,"720p":0.32,"1080p":0.82,"2k":1.23,"4k":1.845}}', 120),
('Vidu/q2-pro',            '生数 Q2 Pro',        'video', 'tencent-vod', 0.0000, 0.7000, '{"img":{"720p":0.35,"1080p":0.7,"2k":1,"4k":1.5},"ref":{"480p":0.27,"720p":0.35,"1080p":0.9,"2k":1.35,"4k":2.025}}', 121),
('Vidu/q2-turbo',          '生数 Q2 Turbo',      'video', 'tencent-vod', 0.0000, 0.4700, '{"img":{"720p":0.25,"1080p":0.47,"2k":0.7,"4k":1.05}}', 122),
('Vidu/q3',                '生数 Q3',            'video', 'tencent-vod', 0.0000, 0.7820, '{"text":{"480p":0.3125,"720p":0.625,"1080p":0.782,"2k":0.939,"4k":1.127}}', 123),
('Vidu/q3-pro',            '生数 Q3 Pro',        'video', 'tencent-vod', 0.0000, 0.9380, '{"text":{"480p":0.313,"720p":0.782,"1080p":0.938,"2k":1.1256,"4k":1.35072},"img":{"480p":0.313,"720p":0.782,"1080p":0.938,"2k":1.1256,"4k":1.35072}}', 124),
('Vidu/q3-turbo',          '生数 Q3 Turbo',      'video', 'tencent-vod', 0.0000, 0.4380, '{"text":{"480p":0.25,"720p":0.375,"1080p":0.438,"2k":0.5256,"4k":0.63072},"img":{"480p":0.25,"720p":0.375,"1080p":0.438,"2k":0.5256,"4k":0.63072}}', 125),
('Jimeng/3.0pro',          '即梦 3.0 Pro',       'video', 'tencent-vod', 0.0000, 1.0000, '{"text":{"1080p":1,"2k":1.5,"4k":2.25}}', 130),
('Seedance/2.0',           '豆包 2.0',           'video', 'volcengine',   5.0000, 0.4000, NULL, 139),
('Seedance/1.5-pro',       '豆包 1.5 Pro',       'video', 'tencent-vod', 0.0000, 0.3880, '{"text":{"480p":0.08,"720p":0.172,"1080p":0.388,"2k":0.691,"4k":1.552},"text_audio":{"480p":0.16,"720p":0.346,"1080p":0.778,"2k":1.382,"4k":3.11}}', 140),
('Seedance/1.0-pro',       '豆包 1.0 Pro',       'video', 'tencent-vod', 0.0000, 0.7340, '{"text":{"480p":0.146,"720p":0.308,"1080p":0.734,"2k":1.101,"4k":1.6515}}', 141),
('Seedance/1.0-pro-fast',  '豆包 1.0 Pro Fast',  'video', 'tencent-vod', 0.0000, 0.2060, '{"text":{"480p":0.04,"720p":0.086,"1080p":0.206,"2k":0.309,"4k":0.4635}}', 142),
('Seedance/1.0-lite-i2v',  '豆包 1.0 Lite',      'video', 'tencent-vod', 0.0000, 0.4900, '{"text":{"480p":0.098,"720p":0.206,"1080p":0.49,"2k":0.735,"4k":1.1025}}', 143),
('GV/3.1',                 'Google Veo 3.1',     'video', 'tencent-vod', 0.0000, 1.5000, '{"text":{"720p":1.5,"1080p":1.5,"2k":2.25,"4k":3},"text_audio":{"720p":3,"1080p":3,"2k":3.75,"4k":4.5}}', 150),
('GV/3.1-fast',            'Google Veo 3.1 Fast','video', 'tencent-vod', 0.0000, 0.7500, '{"text":{"720p":0.75,"1080p":0.75,"2k":1.5,"4k":2.25},"text_audio":{"720p":1.125,"1080p":1.125,"2k":1.875,"4k":2.625}}', 151),
('OS/2.0',                 'Sora 2.0',           'video', 'tencent-vod', 0.0000, 1.1250, '{"text":{"720p":0.75,"1080p":1.125,"2k":1.688,"4k":2.531}}', 160),
('Hunyuan/1.5',            '混元 1.5',           'video', 'tencent-vod', 0.0000, 0.5000, '{"text":{"720p":0.3,"1080p":0.5,"2k":0.75,"4k":1.12}}', 170);

INSERT IGNORE INTO `model_pricing` (`model_id`, `model_name`, `type`, `provider`, `base_cost`, `cost_per_second`, `sort_order`) VALUES
('kling-v2-6',             '可灵 2.6 (Fal)',     'video', 'fal',         4.0000, 0.5000, 200),
('kling-v2-1',             '可灵 2.1 (Legacy)',  'video', 'fal',         3.0000, 0.3500, 201),
('kling-v2-1-master',      '可灵 2.1 Master',    'video', 'fal',         3.5000, 0.4000, 202),
('kling-v2-5-turbo',       '可灵 2.5 Turbo',     'video', 'fal',         3.0000, 0.3500, 203),
('hailuo-2.3',             '海螺 2.3 (Legacy)',  'video', 'tencent-vod', 2.5000, 0.3000, 210),
('hailuo-2.3-fast',        '海螺 2.3 Fast',      'video', 'tencent-vod', 2.0000, 0.2500, 211),
('hailuo-02',              '海螺 02 (Legacy)',   'video', 'tencent-vod', 2.0000, 0.3000, 212);

INSERT IGNORE INTO `model_pricing` (`model_id`, `model_name`, `type`, `provider`, `base_cost`, `cost_per_1k_tokens`, `sort_order`) VALUES
('gemini-3.1-pro-preview', 'Gemini 3.1 Pro',     'text', 'tencent-text', 0.0000, 0.1000, 300),
('gpt-5.4',                'GPT 5.4',            'text', 'tencent-text', 0.0000, 0.1500, 301),
('gemini-2.0-flash',       'Gemini 2.0 Flash',   'text', 'gemini',       0.0000, 0.0500, 310),
('gemini-3-pro-image-preview','Gemini 3 Pro Image','text','gemini',       0.5000, 0.1000, 311),
-- Chat utility models (used by /api/chat, /api/gemini/*, /api/reverse-prompt, storyboard, agent)
('qwen3.6-plus',           'Qwen 3.6 Plus',      'text', 'dashscope',    0.0000, 0.0500, 320),
('gemini-2.5-flash',       'Gemini 2.5 Flash',   'text', 'gemini',       0.0000, 0.0200, 321),
-- TTS / STT / utility AI services
('volc-tts',               '火山 TTS',            'text', 'volcengine',   0.0000, 0.0400, 400),
('volc-tts-clone',         '火山 TTS 声音克隆',     'text', 'volcengine',   1.0000, 0.0000, 401),
('index-tts',              'Index TTS',          'text', 'chuhai-bang',  0.0000, 0.0400, 410),
('faster-whisper',         'Faster Whisper 转写', 'text', 'chuhai-bang',  0.0000, 0.0050, 420),
('camera-angle',           '镜头角度生成',         'image', 'local',       0.1000, 0.0000, 430),
('chuhaibang',             '出海帮 合成图',         'image', 'chuhai-bang', 0.2000, 0.0000, 440);
