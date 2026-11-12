import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './encryption.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import { generateRecoveryCodes, hashRecoveryCode, isRecoveryCodeFormat } from './recovery-codes.js';
import { generateToken, hashToken, safeEqual } from './tokens.js';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotp,
  hotp,
  verifyTotp,
} from './totp.js';

describe('tokens', () => {
  it('are random, URL-safe and hashed deterministically', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(generateToken());
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });
});

describe('password hashing (Argon2id)', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=19456,t=2,p=1');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong password!!')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    await expect(burnPasswordCheck('anything')).resolves.toBeUndefined();
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 4226 Appendix D test vectors (secret "12345678901234567890").
  const rfcSecret = Buffer.from('12345678901234567890');
  it('matches RFC 4226 HOTP vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314'];
    expected.forEach((code, counter) => expect(hotp(rfcSecret, counter)).toBe(code));
  });

  it('matches RFC 6238 SHA-1 vectors (last 6 digits)', () => {
    const b32 = base32Encode(rfcSecret);
    expect(generateTotp(b32, 59_000)).toBe('287082');
    expect(generateTotp(b32, 1_111_111_109_000)).toBe('081804');
    expect(generateTotp(b32, 1_234_567_890_000)).toBe('005924');
    expect(generateTotp(b32, 2_000_000_000_000)).toBe('279037');
  });

  it('round-trips base32', () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('verifies with ±1 step drift and blocks replay', () => {
    const b32 = base32Encode(rfcSecret);
    const now = 1_700_000_000_000;
    const code = generateTotp(b32, now - 30_000);
    const step = verifyTotp(b32, code, { nowMs: now });
    expect(step).not.toBeNull();
    expect(verifyTotp(b32, code, { nowMs: now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(b32, generateTotp(b32, now - 90_000), { nowMs: now })).toBeNull();
    expect(verifyTotp(b32, '12a456', { nowMs: now })).toBeNull();
  });

  it('builds an otpauth URI', () => {
    const uri = buildOtpauthUri('ABC', 'a@b.com', 'Migration CRM');
    expect(uri).toBe(
      'otpauth://totp/Migration%20CRM%3Aa%40b.com?secret=ABC&issuer=Migration+CRM&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('encryption (AES-256-GCM)', () => {
  const key = randomBytes(32);
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(encryptSecret('JBSWY3DPEHPK3PXP', key));
    expect(decryptSecret(a, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering and wrong keys', () => {
    const payload = Buffer.from(encryptSecret('secret', key), 'base64');
    payload[payload.length - 1] = (payload[payload.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(payload.toString('base64'), key)).toThrow();
    expect(() => decryptSecret(encryptSecret('secret', key), randomBytes(32))).toThrow();
  });
});

describe('recovery codes', () => {
  it('generates 10 unique readable codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(isRecoveryCodeFormat(code)).toBe(true);
    expect(hashRecoveryCode(' ABCDE-fghjk ')).toBe(hashRecoveryCode('abcde-fghjk'));
  });
});
