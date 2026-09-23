import { createHash, randomBytes } from "node:crypto";

/*
 * Device tokens: the credential `shelra login` stores so the CLI can act for an account without holding the
 * person's Supabase session. The server keeps only a token's SHA-256; a slow password hash buys nothing
 * for 256 random bits, and the digest lets a lookup use the unique index.
 */

/** Every token starts with this, so a person or a secret scanner can tell what leaked. */
export const TOKEN_PREFIX = "shr_";

const TOKEN_PATTERN = /^shr_[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** What may be shown of a token after it is issued: the prefix and its first 8 characters. */
export function displayPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 8);
}

export function isWellFormedToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
