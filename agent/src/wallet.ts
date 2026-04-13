/**
 * Ephemeral wallet management — keys exist ONLY in memory.
 *
 * Security:
 *  - Keypair generated via crypto.randomBytes (NOT Math.random)
 *  - Private key never logged, never written to disk
 *  - Wallet object is frozen after creation
 */

import * as crypto from "node:crypto";
import { log, mask } from "./logger.js";

export interface EphemeralWallet {
  readonly publicKey: string;
  /** Sign a message — the private key is captured in closure, never exposed */
  sign(message: string): string;
  /** Returns the public key for logging (masked) */
  toString(): string;
}

/**
 * Generate an ephemeral Stellar-compatible keypair.
 * In Tranche 3 this will use stellar-sdk Keypair; for now we use
 * raw Ed25519 via Node crypto to avoid importing the full SDK.
 */
export function createEphemeralWallet(): EphemeralWallet {
  // Generate Ed25519 keypair using crypto (NOT Math.random)
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });

  const pubHex = publicKey.toString("hex");
  const privKeyObj = crypto.createPrivateKey({
    key: privateKey,
    format: "der",
    type: "pkcs8",
  });

  log.info("wallet_created", { publicKey_hash: pubHex });

  const wallet: EphemeralWallet = {
    publicKey: pubHex,

    sign(message: string): string {
      const sig = crypto.sign(null, Buffer.from(message), privKeyObj);
      return sig.toString("hex");
    },

    toString(): string {
      return `Wallet(${mask(pubHex)})`;
    },
  };

  return Object.freeze(wallet);
}
