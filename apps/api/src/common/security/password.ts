import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * Argon2id with OWASP-recommended minimum parameters (19 MiB memory, 2 iterations, 1 lane).
 * `algorithm: 2` = Argon2id (the library exports it as a const enum, which isolatedModules can't import).
 */
const ARGON2_OPTIONS: Options = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Verify against a throwaway hash when the account does not exist, so login takes the same time
 * whether or not the email is registered (prevents account discovery by timing).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  await verifyPassword(await dummyHash, password);
}
