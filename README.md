# Lumina · 智能英语学习网站

基于 **Node.js + MySQL 5.7** 的英语学习网站，核心特性：

- 📚 **背单词**：选择词库（六级 / 考研 / 雅思 / 托福）、指定学习数量，卡片式学习，主观选择熟悉等级（不认识 / 模糊 / 熟悉 / 掌握），含音标、释义、例句、短语与**发音**（浏览器语音合成）。
- 📒 **单词本管理**：自定义单词本，支持创建 / 重命名 / 删除，按分类组织，学习或复习时可一键加入。
- 🔁 **智能复习**：依据记忆算法优先抽取**最不牢固**的单词；可指定抽取前 N 个，也可限定词库 / 单词本。
- 🧠 **记忆算法（核心）**：综合「熟悉等级 + 时间间隔（遗忘曲线）+ 复习次数」计算 0~100 的记忆牢固度分数，用于复习智能排序。

---

## 技术栈

- 后端：Node.js + Express + MySQL 2 (`mysql2` 连接池)
- 前端：原生 HTML/CSS/JS（玻璃拟态 + 极光渐变 + 明/暗/系统主题切换），无需构建
- 数据库：MySQL 5.7（UTF8MB4）
- 鉴权：JWT（Bearer Token）+ bcrypt 密码哈希
- 发音：Web Speech API（无需预录音频文件）

---

## 快速开始

### 1. 准备数据库（MySQL 5.7）

**方式 A：Docker（推荐）**

```bash
docker-compose up -d        # 启动 MySQL 5.7，端口 3306，root/root，库名 english_learning
```

**方式 B：已有 MySQL**

自行创建数据库（UTF8MB4），并记下账号密码。

### 2. 配置环境变量

```bash
cp .env.example .env
# 按需修改 DB_HOST / DB_USER / DB_PASSWORD / DB_NAME / JWT_SECRET
```

### 3. 安装依赖并初始化

```bash
npm install
npm run db:setup     # 建库 + 建表 + 灌入四套词库种子数据
```

### 4. 启动

```bash
npm start            # 默认 http://localhost:3000
# 或开发模式（文件变更自动重启）
npm run dev
```

打开浏览器访问 `http://localhost:3000`，注册账号即可开始使用。

---

## 记忆算法说明

核心文件：`src/services/memoryAlgorithm.js`（已含单元测试 `npm run test:algo`）。

1. **可提取性（遗忘曲线）**
   `retrievability = exp(-elapsedHours / stability)`
   其中 `stability`（稳定度，单位小时）越大，记忆衰减越慢。
2. **稳定度更新（每次反馈后）**
   - 选「不认识」(f=0)：记忆崩塌，`stability *= 0.3` 并记录一次遗忘（lapse）。
   - 选「模糊/熟悉/掌握」(f=1/2/3)：巩固，增长率随等级与复习次数提升，且设下限与上限。
3. **记忆牢固度分数（用于排序）**
   `strength = retrievability × (0.4 + 0.6 × mastery) × 100`，`mastery = 最近熟悉等级 / 3`。
   分数越低 → 越薄弱 → 复习时越优先。

复习抽取：对所有已学单词计算 `strength` 并**升序**取前 N 个（支持按词库 / 单词本过滤）。

---

## 目录结构

```
.
├── docker-compose.yml        # MySQL 5.7 容器
├── db/
│   ├── schema.sql            # 表结构
│   ├── seed-data.js          # 四套词库种子（80 词）
│   ├── setup.js              # 一键建库+建表+种子
│   └── seed.js               # 仅补种子数据
├── src/
│   ├── server.js             # 服务入口
│   ├── config/               # env / db 连接池
│   ├── middleware/auth.js    # 鉴权
│   ├── routes/               # auth / libraries / learn / review / wordbooks
│   └── services/
│       ├── memoryAlgorithm.js   # 记忆算法（核心）
│       ├── memoryAlgorithm.test.js
│       └── memoryService.js      # 反馈持久化 + 排序
└── public/                   # 前端（index.html / css / js）
```

## API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/libraries` | 词库列表 |
| POST | `/api/learn/start` | 开始学习（选词库+数量） |
| POST | `/api/learn/feedback` | 学习反馈 |
| GET | `/api/review/stats` | 复习统计 |
| GET | `/api/review/weak?limit=&libraryId=&wordbookId=` | 抽取最薄弱 N 词 |
| POST | `/api/review/feedback` | 复习反馈 |
| GET/POST/PATCH/DELETE | `/api/wordbooks` | 单词本 CRUD |
| POST/DELETE | `/api/wordbooks/:id/words` | 单词本内单词管理 |

> 注：除认证接口外，其余接口均需在 `Authorization: Bearer <token>` 中携带登录令牌。
