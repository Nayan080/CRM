import { randomInt } from 'node:crypto';
import { hashToken } from './tokens.js';

// No 0/o, 1/l/i — easy to read and type from paper.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_CODE_COUNT = 10;

function randomChunk(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Ten single-use codes like "k7m2p-x9qrt" (~50 bits each). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => `${randomChunk(5)}-${randomChunk(5)}`);
}

export function normaliseRecoveryCode(code: string): string {
  return code.trim().toLowerCase();
}

export function hashRecoveryCode(code: string): string {
  return hashToken(normaliseRecoveryCode(code));
}

export function isRecoveryCodeFormat(code: string): boolean {
  return /^[a-z0-9]{5}-[a-z0-9]{5}$/i.test(code.trim());
}
