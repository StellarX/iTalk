#!/bin/bash
# ============================================================
# iTalk 一键部署脚本 (Linux)
#
# 用法（在服务器上执行，支持两种模式）：
#
#  A) 手动（SSH 进去后交互输入密码）：
#       git clone https://github.com/StellarX/iTalk /var/www/italk
#       cd /var/www/italk
#       bash deploy.sh
#     -> 脚本会交互询问 MySQL 密码、是否灌词库
#
#  B) 全自动（CI / 远程驱动，环境变量注入，无交互）：
#       export DB_PASSWORD='你的MySQL密码'
#       export SEED=y            # 首次部署且 words 表为空时 y，否则省略或 N
#       export DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=english_learning DB_USER=root
#       export JWT_SECRET=随机串   # 省略则自动生成
#       bash deploy.sh
#
#  说明：敏感项优先读环境变量；非交互模式下若缺少必填项则直接报错退出（不卡住）。
#        密码用 printf 写入，避免 $ / ` 被 shell 展开。
# ============================================================
set -euo pipefail

# 是否交互终端
INTERACTIVE=0; [ -t 0 ] && INTERACTIVE=1

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

# ---- 敏感项 ----
# MySQL 密码：环境变量优先；交互终端则询问；否则报错退出
if [[ -z "${DB_PASSWORD:-}" ]]; then
  if [[ $INTERACTIVE -eq 1 ]]; then
    read -r -s -p "请输入 MySQL 密码: " DB_PASSWORD; echo
  else
    echo "✗ 缺少 DB_PASSWORD 环境变量（非交互模式）。请 export DB_PASSWORD=... 后重试。"
    exit 1
  fi
fi

# JWT 密钥：省略则自动生成
if [[ -z "${JWT_SECRET:-}" ]]; then
  JWT_SECRET="$(openssl rand -hex 32)"
  echo "ℹ️ 未提供 JWT_SECRET，已自动生成随机值"
fi

# 是否灌词库：环境变量优先；交互终端则询问；否则默认 N
if [[ -z "${SEED:-}" ]]; then
  if [[ $INTERACTIVE -eq 1 ]]; then
    read -r -p "是否灌词库数据（首次部署且 words 表为空选 y，已灌过选 N）? [y/N] " SEED
  else
    SEED="N"
  fi
fi

echo "==> [1/6] 安装基础工具"
$SUDO apt-get update -y
$SUDO apt-get install -y curl xz-utils openssl

echo "==> [2/6] 安装 Node.js（若已装且主版本满足要求则跳过，避免降级）"
NEED_SKIP=0
if command -v node >/dev/null 2>&1; then
  HAVE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  NEED_MAJOR="$(echo "${NODE_VERSION}" | cut -d. -f1)"
  if [ "$HAVE_MAJOR" -ge "$NEED_MAJOR" ] 2>/dev/null; then
    echo "    已安装 Node $(node -v)，满足要求，跳过下载"
    NEED_SKIP=1
  fi
fi
if [ "$NEED_SKIP" -ne 1 ]; then
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
fi

echo "==> [3/6] 检查部署目录: $APP_DIR"
if [[ ! -d "$APP_DIR" ]]; then
  echo "✗ 目录不存在：$APP_DIR"
  echo "  请先克隆代码： git clone https://github.com/StellarX/iTalk $APP_DIR"
  exit 1
fi
cd "$APP_DIR"

echo "==> [4/6] 安装依赖"
npm install --omit=dev

echo "==> [5/6] 生成 .env（printf 安全写入，密码中的 \$ / \` 不会被展开）"
printf 'PORT=%s\nNODE_ENV=production\nDB_HOST=%s\nDB_PORT=%s\nDB_USER=%s\nDB_PASSWORD=%s\nDB_NAME=%s\nJWT_SECRET=%s\nTOKEN_EXPIRES_IN=7d\n' \
  "$PORT" "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" "$DB_NAME" "$JWT_SECRET" > .env
chmod 600 .env

if [[ "$SEED" == "y" || "$SEED" == "Y" ]]; then
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
