#!/usr/bin/env bash
# =============================================================================
# deploy_all.sh — Push to GitHub, trigger Vercel redeploy, verify landing page
#
# Usage: bash deploy_all.sh [--skip-push] [--skip-verify]
# =============================================================================
set -euo pipefail

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; B='\033[1;34m'; NC='\033[0m'
info()  { echo -e "${B}[deploy]${NC} $*"; }
ok()    { echo -e "${G}[deploy]${NC} $*"; }
warn()  { echo -e "${Y}[deploy]${NC} $*"; }
fail()  { echo -e "${R}[deploy]${NC} $*"; exit 1; }

SKIP_PUSH=false
SKIP_VERIFY=false
for arg in "$@"; do
  case "$arg" in
    --skip-push)   SKIP_PUSH=true ;;
    --skip-verify) SKIP_VERIFY=true ;;
  esac
done

# ---------------------------------------------------------------------------
# 1. Pre-flight checks
# ---------------------------------------------------------------------------
info "Running pre-flight checks..."

# Ensure no secrets in tracked files
if git diff --cached --name-only 2>/dev/null | grep -qE '\.env$|\.env\.local$|credentials'; then
  fail "Staged files contain potential secrets (.env). Unstage them first."
fi

# Check .gitignore
for pattern in ".env" "node_modules" ".next"; do
  if ! grep -q "$pattern" .gitignore 2>/dev/null; then
    warn ".gitignore missing pattern: $pattern"
  fi
done

ok "Pre-flight checks passed."

# ---------------------------------------------------------------------------
# 2. Git push
# ---------------------------------------------------------------------------
if [ "$SKIP_PUSH" = false ]; then
  info "Pushing to main branch..."

  BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
  if [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
    warn "Current branch is '$BRANCH', not main/master."
    read -rp "Continue? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
  fi

  git add -A
  git status --short

  read -rp "Commit message (or Enter to skip commit): " MSG
  if [ -n "$MSG" ]; then
    git commit -m "$MSG"
  fi

  git push origin "$BRANCH"
  ok "Pushed to origin/$BRANCH."
else
  info "Skipping git push (--skip-push)."
fi

# ---------------------------------------------------------------------------
# 3. Trigger Vercel redeploy (if webhook URL is set)
# ---------------------------------------------------------------------------
VERCEL_DEPLOY_HOOK="${VERCEL_DEPLOY_HOOK:-}"
if [ -n "$VERCEL_DEPLOY_HOOK" ]; then
  info "Triggering Vercel redeploy..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$VERCEL_DEPLOY_HOOK")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    ok "Vercel deploy triggered (HTTP $HTTP_CODE). Building..."
  else
    warn "Vercel webhook returned HTTP $HTTP_CODE."
  fi
else
  info "No VERCEL_DEPLOY_HOOK set — Vercel will auto-deploy on push."
fi

# ---------------------------------------------------------------------------
# 4. Verify landing page is accessible
# ---------------------------------------------------------------------------
if [ "$SKIP_VERIFY" = false ]; then
  LANDING_URL="${LANDING_URL:-}"
  VPS_URL="${VPS_URL:-}"

  if [ -n "$LANDING_URL" ]; then
    info "Waiting 30s for Vercel build..."
    sleep 30

    info "Checking landing page at $LANDING_URL..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$LANDING_URL" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      ok "Landing page is live ($LANDING_URL)."
    else
      warn "Landing page returned HTTP $HTTP_CODE. It may still be building."
    fi
  else
    info "Set LANDING_URL to verify the landing page after deploy."
  fi

  if [ -n "$VPS_URL" ]; then
    info "Checking VPS health at $VPS_URL/health..."
    HEALTH=$(curl -s --max-time 5 "$VPS_URL/health" 2>/dev/null || echo '{}')
    if echo "$HEALTH" | grep -q '"status":"ok"'; then
      ok "VPS is healthy."
    else
      warn "VPS health check failed or returned unexpected response."
    fi
  else
    info "Set VPS_URL to verify VPS health after deploy."
  fi
else
  info "Skipping verification (--skip-verify)."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
ok "Deploy complete."
echo ""
echo "  Next steps:"
echo "    1. Check Vercel dashboard for build status"
echo "    2. Visit the landing page and test the demo"
echo "    3. Verify VPS health: curl \$VPS_URL/health"
echo ""
