# 项目长期笔记 · italk 英语学习网站

## 协作约定（用户偏好）
- 用户本地已安装 MySQL 5.7，数据库由用户自行管理（建库/建表/启动服务）。
- 我只负责交付代码 + 建表 SQL，**不在最终交付时启动项目**；服务启动交给用户自己跑。
- 过程中可验证链路，但交付阶段不自动 `npm start`。

## 技术栈
- 后端：Node.js + Express + mysql2 + JWT(bcryptjs) + dotenv
- 前端：原生 HTML/CSS/JS（premium UI：玻璃拟态、极光背景、明/暗/系统主题、磁吸按钮、卡片翻转、Web Speech 发音）
- 数据库：MySQL 5.7（utf8mb4 / InnoDB）
- 词库：六级(cet6)/考研(kaoyan)/雅思(ielts)/托福(toefl)，每库 20 词共 80 词

## 记忆算法（核心）
- 文件：`src/services/memoryAlgorithm.js`（已 9/9 单测通过）
- 模型：类 FSRS 遗忘曲线——稳定度 `stability_hours`（小时）+ 衰减后实时`strength_score`
- 熟悉度等级：0不认识 / 1模糊 / 2熟悉 / 3掌握
- `不认识`→稳定度崩塌×0.4 且 lapses+1；`模糊/熟悉/掌握`→按等级与复习次数增长（1+0.5f+0.08·review_count，上限 MAX_STABILITY）
- strength = 100 / (1 + 衰减系数·(1 + 间隔/稳定度))，间隔越久/稳定度越低 → 分数越低 → 复习优先抽取
- 复习抽取按 strength_score 升序取前 N 个最不牢固的单词

## 关键文件
- schema: `db/schema.sql`（建表，不含建库）
- 种子: `db/seed-data.js`(数据) / `db/seed.js`(灌库) / `db/setup.js`(建库建表灌数据一条龙)
- 后端: `src/server.js`, `src/routes/*`, `src/services/memoryService.js`, `src/middleware/auth.js`, `src/config/{env,db}.js`
- 前端: `public/index.html`, `public/css/styles.css`, `public/js/{api,app}.js`
