# Cortex402 — Pitch Deck

## The Problem

APIs are the backbone of the internet, but payment for API access is stuck in the past:
- **API keys** require manual setup, are centralized, and leak constantly
- **Subscriptions** don't work for autonomous AI agents making one-off requests
- **Free tiers** are unsustainable and invite abuse

**What if APIs could charge per-request, settled in seconds, with zero human intervention?**

---

## The Solution: Cortex402

An **AI-native payment middleware** implementing the **x402 protocol** on **Stellar**.

```
Agent → API → 402 Payment Required → Agent pays on Stellar → API serves response
```

The entire flow takes **< 5 seconds**. No popups. No browser extensions. No manual approvals.

---

## How It Works

1. **Agent sends HTTP request** to a protected endpoint
2. **Middleware returns 402** with a unique `memo_hash` challenge (amount, destination, expiry)
3. **Agent builds, signs, and submits** a Stellar transaction with the `memo_hash`
4. **Middleware verifies on-chain**, marks memo as used (anti-replay), returns the resource

---

## Security — Built-In, Not Bolted On

| Feature | What it does |
|---------|-------------|
| **Replay protection** | Each `memo_hash` is single-use. Duplicate payments are rejected. |
| **Trustline enforcement** | Only accounts with active USDC trustlines can participate. |
| **Structured error codes** | `op_no_trust`, `INSUFFICIENT_BALANCE`, `TX_BAD_SEQ` — the AI agent knows exactly what went wrong. |
| **Ephemeral wallets** | Agent keypairs exist only in memory. Never persisted to disk. |
| **Rate limiting + Helmet** | Per-IP rate limits, security headers, input sanitization. |
| **Log redaction** | No secrets, IPs, or full hashes in logs. Ever. |

---

## Infrastructure

| Component | Technology | Status |
|-----------|-----------|--------|
| **Middleware** | Express.js on VPS (205.164.114.78) | Running |
| **Network tunnel** | Cloudflare Tunnel (HTTPS) | Active |
| **Blockchain** | Stellar Testnet (Horizon) | Connected |
| **AI Agent** | TypeScript + Claude claude-sonnet-4-20250514 | Functional |
| **Landing page** | Next.js 14 + TailwindCSS on Vercel | Deployed |
| **Process manager** | PM2 with auto-restart | Configured |

---

## Why Stellar?

- **3-5 second finality** — fast enough for synchronous API calls
- **< $0.00001 fees** — viable for micropayments
- **Built-in trustlines** — asset-level access control at the protocol layer
- **MemoHash support** — 32-byte arbitrary data in every transaction
- **Testnet with Friendbot** — zero-cost development and testing

---

## Demo

### Live Flow (Testnet)

1. Visit the landing page → "Try It Live"
2. Click "Run Demo" — calls the real VPS middleware
3. Watch the 402 flow execute in real-time
4. Check the transaction on [Stellar Expert](https://stellar.expert/explorer/testnet)

### Agent CLI

```bash
cd agent
npm run dev -- direct 0.15 USDC
# → Creates intent → Signs tx → Submits to Horizon → Verifies via middleware
```

---

## Metrics

| Metric | Value |
|--------|-------|
| Settlement time | < 3 seconds |
| Transaction fee | < $0.00001 |
| Replay protection | 100% (memo_hash single-use) |
| Middleware uptime | 99.9% (PM2 + Cloudflare) |
| Test coverage | 6 automated test suites |

---

## Roadmap

- [x] Middleware with 402 flow + replay protection
- [x] AI agent with real Stellar payments
- [x] Landing page with live demo
- [x] Dashboard with VPS monitoring
- [x] Automated test suite (6 tests)
- [ ] Mainnet deployment
- [ ] Multi-asset support (beyond USDC)
- [ ] WebSocket real-time payment notifications
- [ ] SDK for third-party API providers

---

## Team

**Luis Cifuentes** — Full-stack developer, blockchain enthusiast.

---

## Links

- **Landing page**: _[Vercel URL]_
- **GitHub**: _[Repository URL]_
- **Stellar Explorer**: https://stellar.expert/explorer/testnet

---

*Built for the Stellar hackathon. Powered by Stellar, Anthropic Claude, and Cloudflare.*
