#!/usr/bin/env bash
# =============================================================================
# deploy_secure_middleware.sh — Cortex402 secure deployment
# Run as root on a fresh Ubuntu 22.04 VPS
# Usage: sudo bash deploy_secure_middleware.sh
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Variables — edit these before running
# ---------------------------------------------------------------------------
APP_USER="cortex"
APP_DIR="/opt/cortex402"
NODE_VERSION="18"
REPO_URL="https://github.com/YOUR_ORG/cortex402.git"  # <-- set your repo
SSH_PORT=22
CLOUDFLARE_TUNNEL_NAME="cortex402"
CLOUDFLARE_HOSTNAME="cortex402.yourdomain.com"         # <-- set your domain

# Colors
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${G}[INFO]${NC}  $*"; }
warn()  { echo -e "${Y}[WARN]${NC}  $*"; }
error() { echo -e "${R}[ERROR]${NC} $*"; exit 1; }

# Must be root
[[ $EUID -eq 0 ]] || error "Run this script as root (sudo)."

# ============================================================================
# 1. SYSTEM UPDATE & BASE PACKAGES
# ============================================================================
info "Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl wget gnupg2 unzip ufw fail2ban jq

# ============================================================================
# 2. CREATE NON-ROOT USER
# ============================================================================
if id "$APP_USER" &>/dev/null; then
  info "User '$APP_USER' already exists."
else
  info "Creating user '$APP_USER'..."
  adduser --disabled-password --gecos "" "$APP_USER"
  # Limited sudo: only pm2, systemctl for cloudflared, and ufw status
  echo "$APP_USER ALL=(ALL) NOPASSWD: /usr/bin/pm2, /usr/bin/systemctl restart cloudflared, /usr/bin/systemctl status cloudflared, /usr/sbin/ufw status" \
    > /etc/sudoers.d/cortex
  chmod 440 /etc/sudoers.d/cortex
fi

# Copy root's SSH authorized_keys to new user (if present)
if [[ -f /root/.ssh/authorized_keys ]]; then
  info "Copying SSH keys to $APP_USER..."
  mkdir -p /home/$APP_USER/.ssh
  cp /root/.ssh/authorized_keys /home/$APP_USER/.ssh/
  chown -R $APP_USER:$APP_USER /home/$APP_USER/.ssh
  chmod 700 /home/$APP_USER/.ssh
  chmod 600 /home/$APP_USER/.ssh/authorized_keys
fi

# ============================================================================
# 3. HARDEN SSH
# ============================================================================
info "Hardening SSH..."
SSHD_CONF="/etc/ssh/sshd_config"
cp "$SSHD_CONF" "${SSHD_CONF}.bak.$(date +%s)"

# Disable root login & password auth
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONF"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONF"
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' "$SSHD_CONF"
sed -i 's/^#\?UsePAM.*/UsePAM no/' "$SSHD_CONF"

# Limit SSH to key-based auth only
grep -q "^AllowUsers" "$SSHD_CONF" || echo "AllowUsers $APP_USER" >> "$SSHD_CONF"

systemctl reload sshd
info "SSH hardened: root login disabled, password auth disabled."

# ============================================================================
# 4. FIREWALL (UFW)
# ============================================================================
info "Configuring UFW firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT/tcp" comment "SSH"
ufw allow 443/tcp comment "HTTPS (Cloudflare Tunnel)"

# Port 3000 only on localhost — no UFW rule needed (it's blocked by default deny)
# Explicitly confirm it's NOT open externally
ufw deny 3000/tcp comment "Block external access to app port"

ufw --force enable
info "Firewall active. Open ports: $SSH_PORT (SSH), 443 (HTTPS)."

# ============================================================================
# 5. FAIL2BAN
# ============================================================================
info "Configuring fail2ban..."
cat > /etc/fail2ban/jail.local <<'JAIL'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = ssh
filter  = sshd
logpath = /var/log/auth.log
maxretry = 3
JAIL
systemctl enable fail2ban
systemctl restart fail2ban
info "fail2ban active — 3 failed SSH attempts = 1h ban."

# ============================================================================
# 6. INSTALL NODE.JS 18 LTS
# ============================================================================
if command -v node &>/dev/null && node -v | grep -q "^v${NODE_VERSION}"; then
  info "Node.js $(node -v) already installed."
else
  info "Installing Node.js ${NODE_VERSION}.x..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -qq nodejs
fi
info "Node $(node -v) / npm $(npm -v)"

# Install PM2 globally
npm install -g pm2 --loglevel=error
info "PM2 $(pm2 -v) installed."

# ============================================================================
# 7. DEPLOY APPLICATION
# ============================================================================
info "Deploying application to $APP_DIR..."

if [[ -d "$APP_DIR/.git" ]]; then
  info "Repo exists, pulling latest..."
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  # If the repo URL is a placeholder, copy local files instead
  if [[ "$REPO_URL" == *"YOUR_ORG"* ]]; then
    warn "REPO_URL not set — copying local files from script directory."
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    mkdir -p "$APP_DIR"
    cp "$SCRIPT_DIR"/package.json "$APP_DIR/"
    cp "$SCRIPT_DIR"/server.js "$APP_DIR/"
    cp "$SCRIPT_DIR"/ecosystem.config.js "$APP_DIR/"
    [[ -f "$SCRIPT_DIR/package-lock.json" ]] && cp "$SCRIPT_DIR/package-lock.json" "$APP_DIR/"
  else
    git clone "$REPO_URL" "$APP_DIR"
  fi
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Create logs directory
mkdir -p "$APP_DIR/logs"
chown "$APP_USER:$APP_USER" "$APP_DIR/logs"

# ============================================================================
# 8. ENVIRONMENT FILE
# ============================================================================
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  info "Creating .env file (edit values before starting!)..."
  cat > "$ENV_FILE" <<'DOTENV'
PORT=3000
NODE_ENV=production
MERCHANT_WALLET=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
HORIZON_URL=https://horizon-testnet.stellar.org
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
CACHE_TTL_SECONDS=300
DISCORD_WEBHOOK_URL=
DOTENV
  warn ">>> EDIT $ENV_FILE with your real MERCHANT_WALLET before starting! <<<"
else
  info ".env file already exists, skipping."
fi

chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ============================================================================
# 9. INSTALL DEPENDENCIES
# ============================================================================
info "Installing Node dependencies..."
cd "$APP_DIR"

if [[ -f package-lock.json ]]; then
  sudo -u "$APP_USER" npm ci --production --loglevel=error
else
  warn "No package-lock.json found — running npm install (generate lock file after)."
  sudo -u "$APP_USER" npm install --production --loglevel=error
fi

# ============================================================================
# 10. PM2 STARTUP & LAUNCH
# ============================================================================
info "Configuring PM2..."

# Stop existing instance if running
sudo -u "$APP_USER" pm2 delete cortex402 2>/dev/null || true

cd "$APP_DIR"
sudo -u "$APP_USER" pm2 start ecosystem.config.js --env production

# PM2 startup — generates the systemd unit for the cortex user
pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" --service-name pm2-cortex
sudo -u "$APP_USER" pm2 save

info "PM2 process started and saved."

# ============================================================================
# 11. CLOUDFLARE TUNNEL
# ============================================================================
info "Installing cloudflared..."

if ! command -v cloudflared &>/dev/null; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
    -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
  rm /tmp/cloudflared.deb
fi

info "cloudflared $(cloudflared --version) installed."

# Create cloudflared config directory for the app user
CF_DIR="/home/$APP_USER/.cloudflared"
mkdir -p "$CF_DIR"

cat > "$CF_DIR/config.yml" <<CFEOF
tunnel: $CLOUDFLARE_TUNNEL_NAME
credentials-file: $CF_DIR/credentials.json

ingress:
  - hostname: $CLOUDFLARE_HOSTNAME
    service: http://localhost:3000
    originRequest:
      noTLSVerify: false
  - service: http_status:404

# TLS settings
transport:
  tls:
    minVersion: "1.3"

# Do not log request bodies
loglevel: warn
CFEOF

chown -R "$APP_USER:$APP_USER" "$CF_DIR"
chmod 700 "$CF_DIR"

cat <<'NOTE'

╔══════════════════════════════════════════════════════════════════╗
║  CLOUDFLARE TUNNEL — MANUAL STEPS REQUIRED:                     ║
║                                                                  ║
║  1. Login:    sudo -u cortex cloudflared tunnel login             ║
║  2. Create:   sudo -u cortex cloudflared tunnel create cortex402  ║
║  3. Route:    sudo -u cortex cloudflared tunnel route dns \       ║
║               cortex402 cortex402.yourdomain.com                  ║
║  4. Start:    sudo -u cortex cloudflared tunnel run cortex402     ║
║                                                                  ║
║  Then install as systemd service:                                ║
║     cloudflared service install                                   ║
║     systemctl enable cloudflared                                  ║
╚══════════════════════════════════════════════════════════════════╝
NOTE

# ============================================================================
# 12. INSTALL MONITORING SCRIPT
# ============================================================================
info "Installing monitoring script..."

cat > /opt/cortex402/monitor.sh <<'MONITOR'
#!/usr/bin/env bash
# monitor.sh — checks PM2 + cloudflared health every 5 minutes
# Install in crontab: */5 * * * * /opt/cortex402/monitor.sh

WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"
ALERT_LOG="/opt/cortex402/logs/monitor.log"

send_alert() {
  local msg="$1"
  echo "$(date -u +%FT%TZ) ALERT: $msg" >> "$ALERT_LOG"

  if [[ -n "$WEBHOOK_URL" ]]; then
    curl -s -o /dev/null -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"content\":\"🚨 **cortex402 alert**: $msg\"}"
  fi
}

# Check PM2 process
if ! pm2 pid cortex402 | grep -q '[0-9]'; then
  send_alert "PM2 process 'cortex402' is NOT running! Attempting restart..."
  cd /opt/cortex402 && pm2 start ecosystem.config.js --env production
fi

# Check cloudflared
if ! systemctl is-active --quiet cloudflared 2>/dev/null; then
  send_alert "cloudflared tunnel is NOT running!"
fi

# Check health endpoint
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/health 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" != "200" ]]; then
  send_alert "Health check failed (HTTP $HTTP_CODE)"
fi
MONITOR

chmod +x /opt/cortex402/monitor.sh
chown "$APP_USER:$APP_USER" /opt/cortex402/monitor.sh

# Install crontab for cortex user
(sudo -u "$APP_USER" crontab -l 2>/dev/null | grep -v monitor.sh; \
 echo "*/5 * * * * /opt/cortex402/monitor.sh") | sudo -u "$APP_USER" crontab -

info "Monitor cron installed (every 5 min)."

# ============================================================================
# 13. FINAL VERIFICATION
# ============================================================================
echo ""
echo "================================================================"
echo "  DEPLOYMENT SUMMARY"
echo "================================================================"
echo "  User:          $APP_USER"
echo "  App dir:       $APP_DIR"
echo "  Node:          $(node -v)"
echo "  PM2:           $(pm2 -v)"
echo "  Firewall:      $(ufw status | head -1)"
echo "  fail2ban:      $(systemctl is-active fail2ban)"
echo "  .env perms:    $(stat -c '%a' $ENV_FILE)"
echo ""
echo "  PM2 status:"
sudo -u "$APP_USER" pm2 list
echo ""

# Quick health check
sleep 2
HEALTH=$(curl -s http://127.0.0.1:3000/health 2>/dev/null || echo '{"error":"not reachable"}')
echo "  Health check:  $HEALTH"
echo "================================================================"

info "Deployment complete!"
warn "REMEMBER: Edit $ENV_FILE with your real MERCHANT_WALLET."
warn "REMEMBER: Complete Cloudflare Tunnel setup (see instructions above)."
