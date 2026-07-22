# 真实词库数据生成 · 交付说明

## 问题与解决
原 `db/seed-data.js` 每库仅 20 个占位单词（模拟数据），不满足"真实、几千个"的要求。
现改用开源真实词库 **gaollard/english-vocabulary** 重新生成。

## 数据源
- **官方完整 txt 词表**（六级 / 考研 / 托福）作单词底表，保证覆盖完整考试大纲词汇。
- **json_original/json-sentence 富数据**：每条含 `uk/us` 英美音标、`translations` 释义（带词性）、`phrases` 短语、`sentences` 例句（英中对照）。按单词匹配为底表补充音标 / 例句 / 短语。
- **雅思**：该仓库无官方 txt，直接使用其 json-sentence 真实雅思词表（含音标例句）。

## 生成结果（db/seed-data.js）
| 词库 | 真实单词数 | 含音标 | 含例句 |
|------|-----------|--------|--------|
| 英语六级 | 3,991 | ✓ | ✓ |
| 考研英语 | 5,047 | ✓ | ✓ |
| 托福 TOEFL | 10,367 | ✓ (9,840) | ✓ (10,170) |
| 雅思 IELTS | 5,275 | ✓ (5,262) | ✓ |
| **总计** | **24,680** | **97.7%** | **93.9%** |

- 0 个空释义；所有单词均可经前端 🔊 按钮用 Web Speech API 发音（即使音标缺失）。
- 同一 headword 在源列表中可能重复出现（带不同释义），已按单词去重为真实唯一词汇量；数据库唯一键也会拒绝重复。

## 相关改动
- `scripts/build-word-data.js`：重写为从 `.cache/` 原始文件合成四库并写出 `seed-data.js`（新增 `npm run db:build` 可重跑）。
- `db/seed.js` / `db/setup.js`：单条 INSERT 改为**批量 INSERT（每批 500 行）**，3 万+ 单词秒级完成。
- `package.json`：新增 `db:build` 脚本。

## 用户启动步骤（MySQL 由你自行管理，我不启动项目）
1. 配置 `.env`（DB 连接、JWT 密钥等）。
2. `npm install`
3. `npm run db:setup`（建库 + 建表 + 灌入词库，约 24,680 词）
   - 或分开：`npm run db:seed`（仅补词库，需表已存在）
4. `npm start` 启动服务。

> 如需重新生成词库数据：`npm run db:build`（会命中 `.cache/` 已下载的原始文件，秒级完成）。
