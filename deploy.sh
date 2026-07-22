#!/bin/bash
# ============================================================
# iTalk 一键部署脚本 (Linux)
# 用法（在服务器上以 root 或有 sudo 的用户执行）：
#   1) 先把项目代码放到 APP_DIR（git clone 或 scp 上传，不要带 node_modules）
#   2) 可选：export DB_PASSWORD=你的MySQL密码  JWT_SECRET=随机串
#   3) bash deploy.sh
# 说明：敏感项优先读环境变量，缺失则交互输入；密码不会写死在脚本里。
# ============================================================
set -euo pipefail

# ---- 配置（可用环境变量覆盖）----
APP_DIR="${APP_DIR:-/var/www/italk}"
NODE_VERSION="${NODE_VERSION:-20.18.0}"
PORT="${PORT:-3000}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-english_learning}"
DB_USER="${DB_USER:-root}"

# root 下不需要 sudo，普通用户自动加
if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo"; fi

# ---- 敏感项：环境变量优先，否则交互输入/自动生成 ----
if [[ -z "${DB_PASSWORD:-}" ]]; then
  read -r -s -p "请输入 MySQL 密码: " DB_PASSWORD; echo
fi
if [[ -z "${JWT_SECRET:-}" ]]; then
  JWT_SECRET="$(openssl rand -hex 32)"
  echo "ℹ️ 未提供 JWT_SECRET，已自动生成随机值"
fi

echo "==> [1/6] 安装基础工具"
$SUDO apt-get update -y
$SUDO apt-get install -y curl xz-utils openssl

echo "==> [2/6] 安装 Node.js ${NODE_VERSION} (官方二进制，按架构自动选)"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  NODE_ARCH="linux-x64" ;;
  aarch64) NODE_ARCH="linux-arm64" ;;
  *) echo "✗ 不支持的架构: $ARCH"; exit 1 ;;
esac
cd /tmp
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_ARCH}.tar.xz" -o node.tar.xz
$SUDO tar -xJf node.tar.xz -C /usr/local --strip-components=1
rm -f node.tar.xz
node -v && npm -v

echo "==> [3/6] 检查部署目录: $APP_DIR"
if [[ ! -d "$APP_DIR" ]]; then
  echo "✗ 目录不存在。请先把项目代码放上去（git clone 或 scp），再运行本脚本。"
  exit 1
fi
cd "$APP_DIR"

echo "==> [4/6] 安装依赖"
npm install --omit=dev

echo "==> [5/6] 生成 .env（用 printf 安全写入，避免密码中的 \$ / \` 被展开）"
printf 'PORT=%s\nNODE_ENV=production\nDB_HOST=%s\nDB_PORT=%s\nDB_USER=%s\nDB_PASSWORD=%s\nDB_NAME=%s\nJWT_SECRET=%s\nTOKEN_EXPIRES_IN=7d\n' \
  "$PORT" "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" "$DB_NAME" "$JWT_SECRET" > .env
chmod 600 .env

read -r -p "是否灌词库数据（首次部署且 words 表为空时选 y，已灌过选 N）? [y/N] " SEED_ANS
if [[ "$SEED_ANS" == "y" || "$SEED_ANS" == "Y" ]]; then
  echo "    -> 执行 npm run db:setup"
  npm run db:setup
else
  echo "    -> 跳过灌词库"
fi

echo "==> [6/6] 用 PM2 后台启动"
$SUDO npm install -g pm2
pm2 start src/server.js --name italk
pm2 save
pm2 startup >/dev/null 2>&1 || true

sleep 2
echo "==> 健康检查:"
curl -s "http://localhost:${PORT}/api/health" || echo "(健康检查失败，请查 pm2 logs italk)"

echo ""
echo "✅ 部署脚本执行完毕。"
echo "   查看日志: pm2 logs italk"
echo "   重启:     pm2 restart italk"
