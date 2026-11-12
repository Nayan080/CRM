import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. Sent to the user once (email link / cookie), never stored raw. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 of a high-entropy token. Fast hashing is fine here because tokens are random
 * (not guessable like passwords); storing only the hash means a DB leak exposes no usable tokens.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
