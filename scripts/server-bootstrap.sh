#!/usr/bin/env bash
# CELANO PPT 服务器引导脚本（幂等，可重复执行）
#
#   sudo bash scripts/server-bootstrap.sh \
#     --repo git@github.com:<OWNER>/celano-ppt.git \
#     --branch main \
#     --domain ppt.example.com \
#     --email ops@example.com \
#     [--app-dir /opt/celano-ppt] [--port 3000] [--skip-nginx] [--skip-tls]
#
# 私有仓库需要服务器持有只读 Deploy Key：脚本会在首次运行时生成密钥并打印公钥，
# 把它加到 GitHub 仓库 Settings → Deploy keys（勾选 Allow write access 不需要）后重跑本脚本。

set -euo pipefail

APP_DIR="/opt/celano-ppt"
REPO=""
BRANCH="main"
DOMAIN=""
EMAIL=""
PORT="3000"
SKIP_NGINX=0
SKIP_TLS=0
APP_USER="celano"
NODE_MAJOR="22"

log()  { printf '\033[1;32m[celano]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[celano]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[celano]\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)      REPO="$2"; shift 2 ;;
    --branch)    BRANCH="$2"; shift 2 ;;
    --domain)    DOMAIN="$2"; shift 2 ;;
    --email)     EMAIL="$2"; shift 2 ;;
    --app-dir)   APP_DIR="$2"; shift 2 ;;
    --port)      PORT="$2"; shift 2 ;;
    --skip-nginx) SKIP_NGINX=1; shift ;;
    --skip-tls)   SKIP_TLS=1; shift ;;
    -h|--help)   sed -n '2,12p' "$0"; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "请用 root 或 sudo 运行"
[[ -n "$REPO" ]] || die "必须指定 --repo"

# ── 1. 系统与基础包 ──────────────────────────────────────
log "检测系统环境"
. /etc/os-release
case "${ID:-} ${ID_LIKE:-}" in
  *ubuntu*|*debian*) PKGS="curl ca-certificates gnupg git nginx python3 build-essential" ;;
  *centos*|*rhel*|*tencentos*) PKGS="curl ca-certificates git nginx python3 gcc gcc-c++ make" ;;
  *) warn "未识别的发行版 ${PRETTY_NAME:-}，按通用方式安装依赖"; PKGS="curl ca-certificates git python3" ;;
esac

log "安装基础依赖：$PKGS"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq $PKGS
else
  yum install -y -q $PKGS
fi

# ── 2. Node.js ${NODE_MAJOR} ───────────────────────────────
install_node() {
  log "安装 Node.js ${NODE_MAJOR}.x"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -qq nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    yum install -y -q nodejs
  fi
}
command -v node >/dev/null 2>&1 || install_node
NODE_VER="$(node -v)"
log "Node 版本：$NODE_VER"
node -e "process.exit(process.versions.node.split('.')[0] >= 22 ? 0 : 1)" \
  || die "Node 版本过低（$NODE_VER），项目要求 >= 22.12"

# ── 3. 服务用户与目录 ────────────────────────────────────
id "$APP_USER" >/dev/null 2>&1 || { log "创建服务用户 $APP_USER"; useradd -r -m -s /bin/bash "$APP_USER"; }

# ── 4. 仓库访问凭据（私有仓库 Deploy Key）────────────────
DEPLOY_KEY="/root/.ssh/celano_github_ed25519"
SSH_DIR="/root/.ssh"
install -d -m 700 "$SSH_DIR"
if [[ ! -f "$DEPLOY_KEY" ]]; then
  log "生成仓库 Deploy Key（只读用途）"
  ssh-keygen -t ed25519 -N '' -C "celano-ppt@$(hostname -f 2>/dev/null || hostname)" -f "$DEPLOY_KEY" -q
  install -m 600 "$DEPLOY_KEY" "$SSH_DIR/config_celano_ppt.tmp"
  cat >> "$SSH_DIR/config_celano_ppt.tmp" <<EOF
Host github.com
  IdentityFile $DEPLOY_KEY
  IdentitiesOnly yes
EOF
  mkdir -p "$SSH_DIR/config.d"
  mv "$SSH_DIR/config_celano_ppt.tmp" "$SSH_DIR/config.d/celano-ppt.conf"
  chmod 600 "$SSH_DIR/config.d/celano-ppt.conf"
  grep -q 'Include.*config.d' "$SSH_DIR/config" 2>/dev/null || echo "Include $SSH_DIR/config.d/*" >> "$SSH_DIR/config"
  chmod 600 "$SSH_DIR/config"
  warn "请把下面这行公钥添加到 GitHub 仓库 Settings → Deploy keys，然后重新运行本脚本："
  echo ""
  echo "    $(cat "${DEPLOY_KEY}.pub")"
  echo ""
  die "等待 Deploy Key 配置完成后重跑本脚本"
fi
chmod 600 "$DEPLOY_KEY"

# ── 5. 获取代码 ──────────────────────────────────────────
if [[ -d "$APP_DIR/.git" ]]; then
  log "更新已有代码"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  log "克隆代码到 $APP_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  git clone --branch "$BRANCH" --single-branch "$REPO" "$APP_DIR"
fi

# ── 6. 环境变量 ──────────────────────────────────────────
ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  log ".env 已存在，保留现有密钥（升级场景不应重新生成）"
else
  log "生成 .env（含随机密钥与初始管理员口令）"
  gen() { node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"; }
  ADMIN_PW="$(node -e "process.stdout.write(require('crypto').randomBytes(12).toString('base64url'))")"
  umask 077
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
NODE_ENV=production
# 初始管理员口令：仅在 data/ 首次初始化时生效，改密请登录 /admin
ADMIN_INITIAL_PASSWORD=$ADMIN_PW
ADMIN_TOKEN_SECRET=$(gen)
USER_SESSION_SECRET=$(gen)
CANVAS_PROXY_TOKEN=$(gen)
# 模型接口留空，登录后台「AI 接口配置」填写
PIAO_BASE_URL=
PIAO_API_KEY=
XIAOYI_BASE_URL=
XIAOYI_API_KEY=
EOF
  chmod 600 "$ENV_FILE"
  ADMIN_PW=""
  warn "管理员初始口令见下方输出，请立即保存："
  grep ADMIN_INITIAL_PASSWORD "$ENV_FILE" || true
fi

# ── 7. 安装与构建 ────────────────────────────────────────
cd "$APP_DIR"
log "安装依赖（npm ci，约 1–2 分钟）"
npm ci --no-audit --no-fund
log "构建主站与智能画布"
npm run build
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/data"
chown "$APP_USER:$APP_USER" "$ENV_FILE"

# ── 8. systemd ───────────────────────────────────────────
log "安装 systemd 服务"
install -m 644 "$APP_DIR/deploy/systemd/celano-ppt.service" /etc/systemd/system/celano-ppt.service
sed -i "s#/opt/celano-ppt#$APP_DIR#g; s#PORT=3000#PORT=$PORT#g" /etc/systemd/system/celano-ppt.service
systemctl daemon-reload
systemctl enable celano-ppt >/dev/null 2>&1 || true
systemctl restart celano-ppt
sleep 2
systemctl --no-pager --lines=8 status celano-ppt || die "服务未能启动，请查看 journalctl -u celano-ppt"

# ── 9. Nginx + HTTPS ─────────────────────────────────────
if [[ "$SKIP_NGINX" -eq 0 ]]; then
  if [[ -n "$DOMAIN" ]]; then
    log "写入 Nginx 配置（域名 $DOMAIN）"
    sed "s#example.com#$DOMAIN#g" "$APP_DIR/deploy/nginx/celano-ppt.conf" > /etc/nginx/conf.d/celano-ppt.conf
    if [[ "$SKIP_TLS" -eq 0 && -n "$EMAIL" ]]; then
      log "签发 Let's Encrypt 证书"
      apt-get install -y -qq certbot python3-certbot-nginx || yum install -y -q certbot
      certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive \
        || warn "证书签发失败，先用 HTTP 访问，稍后重跑：certbot --nginx -d $DOMAIN"
    else
      warn "跳过 TLS，仅生成 HTTP 配置"
    fi
    systemctl reload nginx || systemctl restart nginx
  else
    warn "未指定 --domain，跳过 Nginx 配置；若需从公网访问，请手动把 80/443 转发到 127.0.0.1:$PORT"
  fi
fi

log "完成。健康检查： curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/"
