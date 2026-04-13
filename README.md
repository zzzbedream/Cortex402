# Cortex402

**AI-native payment middleware for the x402 protocol on Stellar.**

Cortex402 enables autonomous AI agents to pay for API access using HTTP 402 Payment Required + real Stellar transactions. No wallet popups, no browser extensions — just code paying code.

---

## Problem

APIs today are either free (unsustainable) or gated behind API keys (centralized). The **x402 protocol** proposes a third way: HTTP 402 responses with on-chain payment challenges. Cortex402 makes this practical by:

- Handling the full payment lifecycle server-side
- Providing AI agents with typed Stellar tools (`sign_stellar_transaction`, `check_payment_status`)
- Enforcing trustline validation and replay protection at the middleware layer

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Client / AI Agent                            │
│  ┌─────────────┐    ┌─────────────────────┐   ┌──────────────────┐  │
│  │ LLM (Claude)│───▶│ Stellar Tool (sign) │──▶│ Horizon (Testnet)│  │
│  └─────────────┘    └─────────────────────┘   └──────────────────┘  │
│         │                                              │             │
│         ▼                                              ▼             │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    HTTP Request + Tx Hash                    │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Tunnel                             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    VPS (205.164.114.78)                               │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                 Cortex402 Middleware (Express)                │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │    │
│  │  │ Rate Limiter │  │ Memo Store   │  │ Payment Cache      │  │    │
│  │  │ (per IP)     │  │ (anti-replay)│  │ (verification TTL) │  │    │
│  │  └─────────────┘  └──────────────┘  └────────────────────┘  │    │
│  │                                                              │    │
│  │  Endpoints:                                                  │    │
│  │    GET  /health          — VPS status                        │    │
│  │    POST /payment/intent  — Generate memo_hash challenge      │    │
│  │    POST /payment/verify  — Verify on-chain payment           │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Stellar Testnet (Horizon)                        │
│  ┌───────────────┐  ┌─────────────┐  ┌───────────────────────────┐  │
│  │ USDC (Testnet) │  │ Trustlines  │  │ MemoHash (anti-replay)   │  │
│  │ GBBD...LWRC    │  │ per account │  │ embedded in each tx      │  │
│  └───────────────┘  └─────────────┘  └───────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Landing Page (Vercel / Next.js)                      │
│  ┌────────────┐  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Hero + CTA  │  │ Try It Live     │  │ Dashboard (/app)         │  │
│  │ How it works│  │ (live VPS demo) │  │ VPS monitor, simulator   │  │
│  └────────────┘  └─────────────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Directory | Description |
|-----------|-----------|-------------|
| **Middleware** | `/` (root) | Express server with 402 payment flow, rate limiting, helmet |
| **AI Agent** | `/agent` | TypeScript agent with Stellar tools, LLM orchestration |
| **Landing Page** | `/web` | Next.js 14 + TailwindCSS with live demo and dashboard |

## Quick Start

### Prerequisites

- Node.js >= 18
- npm or pnpm
- A Stellar Testnet account (get one via [Friendbot](https://friendbot.stellar.org))

### 1. Middleware (VPS or local)

```bash
# Clone and install
git clone https://github.com/tu-usuario/cortex402.git
cd cortex402
npm install

# Configure
cp .env.example .env
# Edit .env: set MERCHANT_WALLET, HORIZON_URL

# Run
npm start
# Or with PM2:
npm run start:pm2
```

### 2. AI Agent

```bash
cd agent
npm install

# Configure
cp .env.example .env
# Edit .env: set MIDDLEWARE_URL, ANTHROPIC_API_KEY, MASTER_SECRET

# Initialize wallet (creates keypair + trustline + funds)
npm run dev -- init

# Direct payment test
npm run dev -- direct 0.5 USDC

# Full LLM agent flow
npm run dev -- agent /api/compute
```

### 3. Landing Page

```bash
cd web
npm install

# Configure
cp .env.example .env.local
# Edit .env.local: set NEXT_PUBLIC_API_URL

# Development
npm run dev

# Production build
npm run build && npm start
```

## Deployment

### VPS (Production)

```bash
# On your VPS (Ubuntu/Debian):
ssh user@205.164.114.78

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repo
git clone https://github.com/tu-usuario/cortex402.git
cd cortex402 && npm install

# Configure
cp .env.example .env
nano .env  # Set MERCHANT_WALLET, HORIZON_URL, NODE_ENV=production

# Start with PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup

# Cloudflare Tunnel (expose port 3000)
cloudflared tunnel --url http://localhost:3000
```

### Landing Page (Vercel)

1. Push the repo to GitHub.
2. Import the project in [Vercel](https://vercel.com).
3. Set **Root Directory** to `web`.
4. Add environment variable: `NEXT_PUBLIC_API_URL=https://your-tunnel.trycloudflare.com`
5. Deploy.

### Agent (Local)

```bash
cd agent
cp .env.example .env
# Fill in MIDDLEWARE_URL, ANTHROPIC_API_KEY, MASTER_SECRET
npm install && npm run dev -- init
```

## Environment Variables

### Middleware (`/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MERCHANT_WALLET` | Yes | — | Stellar address to receive payments |
| `HORIZON_URL` | Yes | — | Stellar Horizon URL |
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | — | `production` for strict CORS |
| `CORS_ORIGIN` | No | — | Allowed origin in production |
| `RATE_LIMIT_WINDOW_MS` | No | 60000 | Rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | No | 100 | Max requests per window |
| `CACHE_TTL_SECONDS` | No | 300 | Payment verification cache TTL |

### Agent (`/agent/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MIDDLEWARE_URL` | Yes | — | Full URL of the middleware |
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `HORIZON_URL` | No | Testnet | Stellar Horizon URL |
| `NETWORK_PASSPHRASE` | No | Testnet | Stellar network passphrase |
| `MASTER_SECRET` | Yes* | — | Master account secret for funding |
| `AGENT_SECRET` | No | — | Reuse an existing agent wallet |

### Landing Page (`/web/.env.local`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | — | VPS middleware URL |
| `NEXT_PUBLIC_HORIZON_URL` | No | Testnet | Horizon URL |
| `NEXT_PUBLIC_USDC_ISSUER` | No | GBBD...LWRC | USDC issuer on Testnet |

## Security Highlights

- **Replay protection**: Each `memo_hash` is single-use. Resubmission returns 400.
- **Trustline enforcement**: Payments only accepted for assets the destination trusts.
- **Rate limiting**: Per-IP rate limits via `express-rate-limit`.
- **Helmet**: Security headers (CSP, HSTS, X-Frame-Options, etc.).
- **Log redaction**: Secrets, IPs, and hashes are masked in all logs.
- **Ephemeral wallets**: Agent keypairs exist only in memory, never written to disk.
- **Input validation**: All Stellar addresses, amounts, and memo_hashes are validated before processing.

## Links

- **Landing Page**: (https://web-eight-eta-28.vercel.app/#waitlist)
- **Stellar Expert (Testnet)**: https://stellar.expert/explorer/testnet

## License

MIT

## Credits

Built by Luis Cifuentes for the Stellar hackathon.

Powered by [Stellar](https://stellar.org), [Anthropic Claude](https://anthropic.com), and [Cloudflare](https://cloudflare.com).
