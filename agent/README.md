# Cortex402 Secure AI Agent

AI-powered payment agent for the x402 protocol on Stellar testnet. Consumes the cortex402 middleware API with full security hardening.

## Security Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Agent Process (Node.js)                                │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ LLM      │  │ Secure Fetch │  │ Ephemeral Wallet │  │
│  │ (Claude) │──│ HTTPS only   │  │ Ed25519 in-mem   │  │
│  │          │  │ TLS ≥ 1.2    │  │ crypto.generate  │  │
│  │ System   │  │ 30s timeout  │  │ never on disk    │  │
│  │ prompt   │  │ 3x retry     │  └──────────────────┘  │
│  │ locked   │  │ no disk I/O  │                         │
│  └──────────┘  └──────┬───────┘  ┌──────────────────┐  │
│                       │          │ Structured Logger │  │
│                       │          │ secrets redacted  │  │
│                       │          │ IPs masked        │  │
│                       │          │ stdout only       │  │
│                       │          └──────────────────┘  │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTPS (TLS 1.2+)
                        │ rejectUnauthorized: true
                        ▼
              ┌──────────────────┐
              │ cortex402        │
              │ middleware (VPS) │
              │ :3000 localhost  │
              │ via CF Tunnel    │
              └──────────────────┘
```

## Security Measures

| Layer | Measure | File |
|-------|---------|------|
| Network | HTTPS enforced, self-signed certs rejected | `secure_fetch.ts` |
| Network | 30s timeout + exponential backoff (max 3 retries) | `secure_fetch.ts` |
| Network | 402 Base64 decoding in try/catch — malformed payloads can't crash | `secure_fetch.ts` |
| Crypto | Ed25519 keypair via `crypto.generateKeyPairSync` (NOT `Math.random`) | `wallet.ts` |
| Crypto | Private key exists only in closure — no property access, no disk | `wallet.ts` |
| Validation | `memo_hash` must be exactly 64 hex chars `[a-f0-9]{64}` | `tools.ts` |
| Logging | Private keys/tokens → `[REDACTED]` | `logger.ts` |
| Logging | Hashes/addresses → `first4...last4` | `logger.ts` |
| Logging | No disk writes — stdout/stderr only | `logger.ts` |
| LLM | System prompt forbids: code execution, key disclosure, external downloads | `agent_secure.ts` |
| LLM | Tool inputs validated before execution | `tools.ts` |
| Config | All secrets via env vars (dotenv), never hardcoded | `.env.example` |

## Setup

```bash
cd agent

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your values:
#   MIDDLEWARE_URL=https://cortex402.yourdomain.com
#   ANTHROPIC_API_KEY=sk-ant-...

# Build TypeScript
npm run build
```

## Usage

### Health check (verify middleware is reachable)
```bash
npm start -- health
# or in dev mode:
npx tsx src/agent_secure.ts health
```

### Direct payment flow (no LLM, for testing)
```bash
npm start -- direct
# Creates intent → mock signs → verifies
```

### Full AI agent flow (LLM-driven)
```bash
npm start -- agent /protected/resource
# Fetches resource → handles 402 → LLM orchestrates payment via tools
```

### Security test suite
```bash
npm run test:security
```

## Security Tests

The `test:security` suite validates:

- [ ] **Secret isolation**: Private key not in `process.env` after wallet creation
- [ ] **Crypto correctness**: `crypto.generateKeyPairSync` produces valid Ed25519 sigs
- [ ] **Malformed 402**: Corrupted Base64, invalid JSON, missing fields → graceful error
- [ ] **memo_hash validation**: Non-hex, wrong length, SQL injection, empty → all rejected
- [ ] **Log redaction**: Private keys fully redacted, hashes partially masked
- [ ] **HTTPS enforcement**: HTTP in production and FTP URLs both rejected
- [ ] **Header awareness**: Auth-related headers redacted in all log output

## File Structure

```
agent/
├── src/
│   ├── agent_secure.ts          # Main agent — LLM loop + direct payment flow
│   ├── secure_fetch.ts          # HTTPS-only fetch with retries + Base64 decode
│   ├── wallet.ts                # Ephemeral Ed25519 wallet (in-memory only)
│   ├── tools.ts                 # LLM tool definitions + mock implementations
│   ├── logger.ts                # Structured JSON logger with secret redaction
│   └── test_agent_security.ts   # Security QA test suite
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

## Tranche Roadmap

- **Tranche 2 (current)**: Mock signing with 3s delay, tool definitions ready for LLM
- **Tranche 3**: Real Stellar SDK keypair generation + transaction submission
- **Tranche 4**: Full end-to-end with live testnet payments

## Development

```bash
# Watch mode (auto-rebuild on changes)
npx tsx watch src/agent_secure.ts health

# Type checking only (no emit)
npx tsc --noEmit
```
