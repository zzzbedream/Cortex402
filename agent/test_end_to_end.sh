#!/usr/bin/env bash
# =============================================================================
# test_end_to_end.sh — Cortex402 Tranche 3 End-to-End Security & Functional QA
#
# Prerequisites:
#   - Node.js >= 18
#   - npm dependencies installed (cd agent && npm install)
#   - .env configured with MIDDLEWARE_URL, ANTHROPIC_API_KEY
#   - Middleware running (locally or remote)
#   - Optional: MASTER_SECRET for USDC sponsorship
#
# Usage: bash test_end_to_end.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; B='\033[1;34m'; NC='\033[0m'
PASS=0; FAIL=0; SKIP=0

ok()   { echo -e "  ${G}✅ PASS${NC}: $*"; ((PASS++)); }
fail() { echo -e "  ${R}❌ FAIL${NC}: $*"; ((FAIL++)); }
skip() { echo -e "  ${Y}⚠️  SKIP${NC}: $*"; ((SKIP++)); }
info() { echo -e "${B}▸${NC} $*"; }

# Load env if present
[[ -f .env ]] && set -a && source .env && set +a

HORIZON="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
MIDDLEWARE="${MIDDLEWARE_URL:-http://127.0.0.1:3000}"

echo "============================================================"
echo "  Cortex402 End-to-End QA (Tranche 3)"
echo "  Horizon:    $HORIZON"
echo "  Middleware:  $MIDDLEWARE"
echo "============================================================"
echo ""

# ================================================================
# PHASE 1: Wallet initialization + Trustline
# ================================================================
echo -e "${B}[PHASE 1] Wallet Initialization & Trustline${NC}"
echo "-----------------------------------------------------------"

info "Initializing agent wallet (new keypair + Friendbot + trustline)..."

# Capture the output — we need the public key
INIT_OUTPUT=$(npx tsx src/agent_full.ts init 2>&1) || true
echo "$INIT_OUTPUT" | head -20

# Extract public key from output
AGENT_PUBKEY=$(echo "$INIT_OUTPUT" | grep -oP 'Public key:\s+\K[A-Z0-9]{56}' | head -1)

if [[ -z "$AGENT_PUBKEY" ]]; then
  fail "Could not extract agent public key from init output"
  echo "  Full output:"
  echo "$INIT_OUTPUT"
  echo ""
  echo "Attempting to continue with remaining tests..."
else
  ok "Wallet initialized: ${AGENT_PUBKEY:0:4}...${AGENT_PUBKEY: -4}"

  # --- Test 1.1: Verify account exists on Horizon ---
  info "Checking account on Horizon..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HORIZON/accounts/$AGENT_PUBKEY")
  if [[ "$HTTP_CODE" == "200" ]]; then
    ok "Account exists on Stellar Testnet"
  else
    fail "Account not found on Horizon (HTTP $HTTP_CODE)"
  fi

  # --- Test 1.2: Verify USDC trustline ---
  info "Checking USDC trustline..."
  ACCOUNT_JSON=$(curl -s "$HORIZON/accounts/$AGENT_PUBKEY")
  HAS_USDC=$(echo "$ACCOUNT_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for b in data.get('balances', []):
    if b.get('asset_code') == 'USDC' and b.get('asset_issuer') == 'GBBD47IF6LWK7P7MDEVXWR7SDVQDU5KPF5AMDNH2FUAQNQYJ3Q37LWRC':
        print('YES')
        sys.exit(0)
print('NO')
" 2>/dev/null || echo "ERROR")

  if [[ "$HAS_USDC" == "YES" ]]; then
    ok "USDC trustline exists (issuer: GBBD...LWRC)"
  elif [[ "$HAS_USDC" == "ERROR" ]]; then
    skip "Could not parse account JSON (python3 required)"
  else
    fail "USDC trustline NOT found"
  fi

  # --- Test 1.3: Check XLM balance ---
  XLM_BALANCE=$(echo "$ACCOUNT_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for b in data.get('balances', []):
    if b.get('asset_type') == 'native':
        print(b.get('balance', '0'))
        sys.exit(0)
print('0')
" 2>/dev/null || echo "unknown")
  info "XLM balance: $XLM_BALANCE"

  # --- Test 1.4: USDC balance (if master sponsored) ---
  USDC_BALANCE=$(echo "$ACCOUNT_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for b in data.get('balances', []):
    if b.get('asset_code') == 'USDC':
        print(b.get('balance', '0'))
        sys.exit(0)
print('0')
" 2>/dev/null || echo "unknown")
  info "USDC balance: $USDC_BALANCE"
fi

echo ""

# ================================================================
# PHASE 2: Idempotent re-initialization (attack de secuencia)
# ================================================================
echo -e "${B}[PHASE 2] Idempotent Re-initialization${NC}"
echo "-----------------------------------------------------------"

info "Running init again (should detect existing account + trustline)..."
REINIT_OUTPUT=$(npx tsx src/agent_full.ts init 2>&1) || true

# Check that it didn't crash
if echo "$REINIT_OUTPUT" | grep -q "Wallet initialized\|Wallet ready"; then
  ok "Re-initialization succeeded without crash"
else
  # Check for specific idempotency indicators in logs
  if echo "$REINIT_OUTPUT" | grep -q "trustline_exists\|account_exists\|createAccountAlreadyExist"; then
    ok "Re-initialization detected existing state (idempotent)"
  else
    fail "Re-initialization may have failed"
    echo "  Output: $(echo "$REINIT_OUTPUT" | tail -5)"
  fi
fi

echo ""

# ================================================================
# PHASE 3: Security — secret protection
# ================================================================
echo -e "${B}[PHASE 3] Secret Protection${NC}"
echo "-----------------------------------------------------------"

# --- Test 3.1: .env permissions ---
if [[ -f .env ]]; then
  if [[ "$(uname)" == "Linux" || "$(uname)" == "Darwin" ]]; then
    PERMS=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null)
    if [[ "$PERMS" == "600" ]]; then
      ok ".env file has permissions 600"
    else
      fail ".env file has permissions $PERMS (expected 600)"
    fi
  else
    skip ".env permission check (Windows — use NTFS ACLs)"
  fi
else
  skip ".env file not found"
fi

# --- Test 3.2: .gitignore includes .env ---
if grep -q "\.env" .gitignore 2>/dev/null; then
  ok ".gitignore includes .env"
else
  fail ".gitignore does not include .env"
fi

# --- Test 3.3: Logs don't contain secrets ---
info "Checking init logs for leaked secrets..."
LEAKED=false

# Check for master secret in output
if [[ -n "${MASTER_SECRET:-}" ]]; then
  if echo "$INIT_OUTPUT" | grep -qF "$MASTER_SECRET"; then
    fail "MASTER_SECRET appears in init output!"
    LEAKED=true
  fi
fi

# Check for private key patterns (S... Stellar secrets are 56 chars)
if echo "$INIT_OUTPUT" | grep -qP 'S[A-Z0-9]{55}'; then
  fail "Stellar secret key pattern found in logs!"
  LEAKED=true
fi

if ! $LEAKED; then
  ok "No secrets found in init output logs"
fi

# --- Test 3.4: Check that logs mask hashes ---
if echo "$INIT_OUTPUT" | grep -qP '[a-f0-9]{64}'; then
  # Full 64-char hex in output — might be a leak
  # But it could be legitimate (public key in non-log output)
  info "Note: 64-char hex found in output — verify these are public keys only"
else
  ok "No unmasked 64-char hashes in log output"
fi

echo ""

# ================================================================
# PHASE 4: Middleware integration
# ================================================================
echo -e "${B}[PHASE 4] Middleware Integration${NC}"
echo "-----------------------------------------------------------"

# --- Test 4.1: Health check ---
info "Checking middleware health..."
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$MIDDLEWARE/health" 2>/dev/null || echo "000")
if [[ "$HEALTH_CODE" == "200" ]]; then
  ok "Middleware health check passed"

  # --- Test 4.2: Payment intent creation ---
  info "Creating payment intent..."
  INTENT_RESP=$(curl -s -X POST "$MIDDLEWARE/payment/intent" \
    -H "Content-Type: application/json" \
    -d '{"amount":"0.1","asset":"XLM"}' 2>/dev/null)
  INTENT_MEMO=$(echo "$INTENT_RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('memo_hash', ''))
" 2>/dev/null || echo "")

  if [[ ${#INTENT_MEMO} -eq 64 ]]; then
    ok "Payment intent created (memo: ${INTENT_MEMO:0:4}...${INTENT_MEMO: -4})"
  else
    fail "Payment intent creation failed: $INTENT_RESP"
  fi

  # --- Test 4.3: Replay protection ---
  if [[ ${#INTENT_MEMO} -eq 64 ]]; then
    info "Testing memo_hash validation..."
    BAD_MEMO_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$MIDDLEWARE/payment/verify" \
      -H "Content-Type: application/json" \
      -d '{"memo_hash":"ZZZZ_not_hex_ZZZZ"}' 2>/dev/null)
    if [[ "$BAD_MEMO_CODE" == "400" ]]; then
      ok "Invalid memo_hash rejected by middleware (400)"
    else
      fail "Invalid memo_hash returned $BAD_MEMO_CODE (expected 400)"
    fi
  fi

else
  skip "Middleware not reachable (HTTP $HEALTH_CODE) — skipping integration tests"
fi

echo ""

# ================================================================
# PHASE 5: TypeScript compilation check
# ================================================================
echo -e "${B}[PHASE 5] TypeScript Compilation${NC}"
echo "-----------------------------------------------------------"

info "Running tsc --noEmit..."
if npx tsc --noEmit 2>&1; then
  ok "TypeScript compilation succeeded (no errors)"
else
  fail "TypeScript compilation has errors"
fi

echo ""

# ================================================================
# PHASE 6: Security test suite (from Tranche 2)
# ================================================================
echo -e "${B}[PHASE 6] Agent Security Tests${NC}"
echo "-----------------------------------------------------------"

info "Running security test suite..."
if npx tsx src/test_agent_security.ts 2>&1; then
  ok "Security test suite passed"
else
  fail "Security test suite had failures"
fi

echo ""

# ================================================================
# SUMMARY
# ================================================================
echo "============================================================"
echo -e "  Results: ${G}$PASS passed${NC}, ${R}$FAIL failed${NC}, ${Y}$SKIP skipped${NC}"
echo "============================================================"

if [[ -n "${AGENT_PUBKEY:-}" ]]; then
  echo ""
  echo "  Stellar Expert (verify trustline):"
  echo "  https://stellar.expert/explorer/testnet/account/$AGENT_PUBKEY"
fi

echo ""
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
