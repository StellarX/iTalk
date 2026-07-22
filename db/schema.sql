-- ============================================================
-- 英语学习网站 · 数据库 Schema (MySQL 5.7)
-- 执行顺序：先建库，再执行本文件
-- 2026-07-20 补充：所有字段 COMMENT 注释
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 用户
CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户主键',
  `username`      VARCHAR(64)  NOT NULL COMMENT '登录用户名(唯一)',
  `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希(bcrypt)',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 词库（六级 / 考研 / 雅思 / 托福 ...）
CREATE TABLE IF NOT EXISTS `word_libraries` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '词库主键',
  `code`        VARCHAR(32)  NOT NULL COMMENT '唯一标识，如 cet6',
  `name`        VARCHAR(64)  NOT NULL COMMENT '展示名',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '词库描述',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 单词（全局词典，归属某个词库）
CREATE TABLE IF NOT EXISTS `words` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '单词主键',
  `library_id`  INT UNSIGNED NOT NULL COMMENT '所属词库id',
  `word`        VARCHAR(128) NOT NULL COMMENT '单词原文',
  `phonetic`    VARCHAR(128) DEFAULT NULL COMMENT '音标',
  `definition`  TEXT         NOT NULL COMMENT '释义',
  `example`     TEXT         DEFAULT NULL COMMENT '例句',
  `phrase`      VARCHAR(255) DEFAULT NULL COMMENT '短语',
  `audio_url`   VARCHAR(512) DEFAULT NULL COMMENT '音频地址(可空，前端可用语音合成)',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '入库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_lib_word` (`library_id`, `word`),
  KEY `idx_word` (`word`),
  CONSTRAINT `fk_words_library` FOREIGN KEY (`library_id`)
    REFERENCES `word_libraries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户自定义单词本
CREATE TABLE IF NOT EXISTS `user_wordbooks` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '单词本主键',
  `user_id`     INT UNSIGNED NOT NULL COMMENT '所属用户id',
  `name`        VARCHAR(128) NOT NULL COMMENT '单词本名称',
  `category`    VARCHAR(64)  DEFAULT '默认' COMMENT '分类组织',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_wb_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 单词本 ↔ 单词 关联
CREATE TABLE IF NOT EXISTS `user_wordbook_words` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '关联主键',
  `wordbook_id`  INT UNSIGNED NOT NULL COMMENT '单词本id',
  `word_id`      INT UNSIGNED NOT NULL COMMENT '单词id',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '添加时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wb_word` (`wordbook_id`, `word_id`),
  CONSTRAINT `fk_wbw_book` FOREIGN KEY (`wordbook_id`)
    REFERENCES `user_wordbooks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wbw_word` FOREIGN KEY (`word_id`)
    REFERENCES `words` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户-单词 记忆状态（算法核心存储）
CREATE TABLE IF NOT EXISTS `user_word_memory` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记忆记录主键',
  `user_id`          INT UNSIGNED NOT NULL COMMENT '用户id',
  `word_id`          INT UNSIGNED NOT NULL COMMENT '单词id',
  `stability_hours`  DECIMAL(10,4) NOT NULL DEFAULT 12.0000 COMMENT '稳定度(小时)',
  `review_count`     INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '复习次数',
  `lapses`           INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '遗忘次数',
  `last_familiarity` TINYINT       DEFAULT NULL COMMENT '0不认识1模糊2熟悉3掌握',
  `last_review_at`   DATETIME      DEFAULT NULL COMMENT '首次为 NULL',
  `first_seen_at`    DATETIME      DEFAULT NULL COMMENT '首次见到时间',
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_word` (`user_id`, `word_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_mem_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mem_word` FOREIGN KEY (`word_id`)
    REFERENCES `words` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 记忆日志（历史记忆数据，用于算法可追溯与统计）
CREATE TABLE IF NOT EXISTS `user_memory_log` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '日志主键',
  `user_id`          INT UNSIGNED NOT NULL COMMENT '用户id',
  `word_id`          INT UNSIGNED NOT NULL COMMENT '单词id',
  `familiarity`      TINYINT      NOT NULL COMMENT '0~3',
  `elapsed_hours`    DECIMAL(10,2) DEFAULT 0.00 COMMENT '距上次复习的间隔',
  `stability_before` DECIMAL(10,4) DEFAULT NULL COMMENT '复习前稳定度(小时)',
  `stability_after`  DECIMAL(10,4) DEFAULT NULL COMMENT '复习后稳定度(小时)',
  `strength_before`  DECIMAL(6,2)  DEFAULT NULL COMMENT '复习前强度分',
  `strength_after`  DECIMAL(6,2)  DEFAULT NULL COMMENT '复习后强度分',
  `session_type`     ENUM('learn','review','browse') NOT NULL DEFAULT 'learn' COMMENT '学习/复习/浏览',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_word` (`user_id`, `word_id`),
  CONSTRAINT `fk_log_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_log_word` FOREIGN KEY (`word_id`)
    REFERENCES `words` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
