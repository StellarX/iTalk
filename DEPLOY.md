# iTalk 英语学习网站 · Linux 服务器部署指南

> 适用：纯 Node.js + Express + 静态前端（`public/` 无需构建），Node ≥ 18。
> 前提：MySQL 5.7 **库与表已创建**（若 `words` / `word_libraries` 还没数据，见第 5 步灌词库）。
> 目标：服务后台稳定运行、开机自启、可平滑更新。

---

## 1. 准备服务器

- 一台 Linux 服务器（Ubuntu 20.04+/CentOS 7+ 均可），已装好 **MySQL 5.7** 且库表已建。
- 开放端口：直接用 Node 则开 `3000`；走 Nginx 则开 `80/443`（推荐后者，见第 7 步）。

### 安装 Node.js（若未装）

**推荐：官方二进制（任何发行版通用，最稳，不依赖发行版识别）**
先确认架构：`uname -m` → `x86_64` 用 `linux-x64`，`aarch64` 用 `linux-arm64`。
```bash
cd /tmp
curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz -o node.tar.xz
sudo tar -xJf node.tar.xz -C /usr/local --strip-components=1
node -v && npm -v   # 需 >= 18
```
> 若 `node -v` 报找不到，执行 `echo 'export PATH=/usr/local/bin:$PATH' >> ~/.bashrc && source ~/.bashrc`。

**备选：NodeSource 脚本（Ubuntu/Debian 原生最省事）**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```
> ⚠️ 若报 `This script is only supported on Debian-based systems.`，说明脚本没识别到 Debian/Ubuntu（常见于 `lsb-release` 缺失或非常规云镜像）。不用纠结，**直接改用上面的官方二进制法**即可，效果完全一样。

---

## 2. 获取代码

**方式 A：git（推荐，便于后续更新）**
```bash
sudo apt-get install -y git
git clone <你的仓库地址> /var/www/italk
cd /var/www/italk
```
> ⚠️ 项目根**没有 `.gitignore`**，请勿提交 `node_modules/` 和 `.env`。若用 git，先在根目录加 `.gitignore`：
> ```
> node_modules/
> .env
> ```

**方式 B：scp / 压缩包上传**
上传**源码目录**（不含 Windows 上的 `node_modules/`——平台二进制不兼容，必须在服务器重装）。

---

## 3. 安装依赖

```bash
cd /var/www/italk
npm install --omit=dev
```
- 依赖仅 5 个：`express` / `mysql2` / `jsonwebtoken` / `bcryptjs` / `dotenv`。
- `mysql2` v3 通常带预编译二进制，`npm install` 直接可用；若报原生编译错误，后备方案：
  ```bash
  sudo apt-get install -y build-essential python3   # 重试 npm install
  ```

---

## 4. 配置环境变量

复制模板并填写（**不要用示例里的默认值上线**）：
```bash
cp .env.example .env
nano .env
```
必填项：
```ini
PORT=3000
NODE_ENV=production

DB_HOST=127.0.0.1      # 数据库在别的机器就填其内网 IP
DB_PORT=3306
DB_USER=italk_user     # 建议用专用账号，别用 root
DB_PASSWORD=你的强密码
DB_NAME=english_learning

JWT_SECRET=请改成随机长字符串   # ★ 必须改！否则任何人可伪造登录 token
TOKEN_EXPIRES_IN=7d
```
生成随机密钥可用：`openssl rand -hex 32`

---

## 5. 灌词库数据（如尚未导入）

> 表已建 ≠ 有单词。若 `words` / `word_libraries` 为空，必须执行（幂等，可重复跑）：
```bash
npm run db:setup
```
该脚本会建 `word_libraries` 行并 upsert 5 个词库约 2.7 万词的种子数据（来自 `db/seed-data.js`）。

---

## 6. 先前台验证，再转后台

```bash
node src/server.js
# 另开终端
curl http://localhost:3000/api/health
# 期望: {"status":"ok","db":"connected",...}
```
确认 `db: connected` 后 `Ctrl+C` 停止，进入后台运行。

### 方案 A：PM2（推荐，最省心）
```bash
sudo npm install -g pm2
pm2 start src/server.js --name italk
pm2 save                 # 保存进程列表
pm2 startup              # 开机自启（按提示执行它吐出的命令）
pm2 logs italk           # 看日志
pm2 restart italk        # 重启
pm2 stop italk           # 停止
```

### 方案 B：systemd（不装额外依赖）
新建 `/etc/systemd/system/italk.service`：
```ini
[Unit]
Description=iTalk English Learning Site
After=network.target mysql.service

[Service]
WorkingDirectory=/var/www/italk
ExecStart=/usr/bin/node /var/www/italk/src/server.js
Restart=always
RestartSec=3
User=www-data
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now italk
sudo systemctl status italk
sudo journalctl -u italk -f      # 看日志
```

### 方案 C：nohup（最简单，但不建议生产）
```bash
nohup node src/server.js > app.log 2>&1 &
# 停： kill %1  或  pkill -f "node src/server.js"
```

---

## 7. （可选）Nginx 反向代理 + HTTPS

不建议公网裸跑 `3000`。用 Nginx 统一入口、加 TLS：

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/italk
```
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/italk /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# 申请免费证书：
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## 8. 防火墙 / 安全组

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```
- 走 Nginx 时**不要**对外暴露 3000。
- 数据库账号用最小权限专用用户，不要 root。

---

## 9. 后续更新

```bash
cd /var/www/italk
git pull
npm install --omit=dev        # 仅当依赖变化时
npm run db:setup              # 词库有更新时可重跑（幂等）
pm2 restart italk             # 或 systemctl restart italk
```

---

## 常见问题 / 坑

1. **别用 Windows 的 `node_modules`**：平台原生二进制不兼容，必须在服务器 `npm install`。
2. **`JWT_SECRET` 必须改**：否则登录 token 可被伪造。
3. **表已建但网站没词**：跑 `npm run db:setup` 灌词库（见第 5 步）。
4. **数据库在另一台机器**：`DB_HOST` 填内网 IP，并确保 MySQL 的 `bind-address` 与该用户授权 host 允许来源连接。
5. **前端是纯静态、用相对路径调 `/api`**：只要和后端同源（同端口或同 Nginx 域）即可，无需额外配置。
6. **`npm install` 报原生编译失败**：装 `build-essential python3` 后重试（大多数情况其实不需要，mysql2 v3 有预编译包）。
7. **改了 `.env` 要重启服务**才能生效（PM2：`pm2 restart italk`；systemd：`systemctl restart italk`）。

> 项目根另含 `docker-compose.yml`，若想走容器化部署可参考其中的服务定义（注意容器内 `DB_HOST` 应指向 `db` 服务名而非 `127.0.0.1`）。
