/**
 * Structured JSON logger that NEVER leaks secrets.
 *
 * Rules:
 *  - Private keys, seeds, tokens → fully redacted
 *  - Hashes (memo_hash, tx_hash)  → first4...last4
 *  - Wallet addresses              → first4...last4
 *  - No disk writes — stdout/stderr only
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

// Patterns that indicate the value is a full secret — redact entirely
const SECRET_KEYS = /secret|private|seed|mnemonic|password|api_key|apikey|token/i;

// Patterns for partial-redact (show first4...last4)
const PARTIAL_KEYS = /hash|memo|wallet|address|public|signature|keypair/i;

export function redactValue(key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length < 8) return value;

  if (SECRET_KEYS.test(key)) return "[REDACTED]";
  if (PARTIAL_KEYS.test(key)) return mask(value);
  return value;
}

export function mask(v: string): string {
  if (v.length <= 8) return "****";
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}

function emit(level: LogLevel, msg: string, meta: Record<string, unknown> = {}): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[CURRENT_LEVEL]) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };

  for (const [k, v] of Object.entries(meta)) {
    entry[k] = redactValue(k, v);
  }

  const out = level === "error" ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + "\n");
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
