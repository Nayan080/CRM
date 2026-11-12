import { createPrismaClient } from '@crm/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotp } from '../src/common/security/totp.js';
import {
  CSRF,
  PASSWORD,
  bearer,
  enableMfa,
  freshCode,
  login,
  refreshCookieFrom,
  signUp,
} from './helpers/flows.js';
import {
  type TestApp,
  createTestApp,
  testDatabaseUrl,
  tokenFromLastEmail,
  uniqueEmail,
} from './helpers/test-app.js';

let t: TestApp;
// Direct DB access for test setup only (users/sessions tables are not tenant-owned).
const db = createPrismaClient({ connectionString: testDatabaseUrl });

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await db.$disconnect();
});

describe('registration and email verification', () => {
  it('gives the same response for new and existing emails (no account discovery)', async () => {
    const email = uniqueEmail('reg');
    const first = await request(t.server)
      .post('/api/v1/auth/register')
      .send({ name: 'A', email, password: PASSWORD });
    await request(t.server)
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenFromLastEmail(t.mailer, email) })
      .expect(200);
    const second = await request(t.server)
      .post('/api/v1/auth/register')
      .send({ name: 'B', email, password: PASSWORD });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual(first.body);
    expect(t.mailer.lastTo(email)?.subject).toBe('Sign-up attempt for your account');
  });

  it('blocks login until the email is verified; links are single-use', async () => {
    const email = uniqueEmail('verify');
    await request(t.server)
      .post('/api/v1/auth/register')
      .send({ name: 'V', email, password: PASSWORD })
      .expect(202);
    const res = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('EMAIL_NOT_VERIFIED');

    const token = tokenFromLastEmail(t.mailer, email);
    await request(t.server).post('/api/v1/auth/verify-email').send({ token }).expect(200);
    const again = await request(t.server).post('/api/v1/auth/verify-email').send({ token });
    expect((again.body as { code: string }).code).toBe('INVALID_OR_EXPIRED_TOKEN');
    await login(t, email);
  });

  it('stores emails normalised and only Argon2id password hashes', async () => {
    const email = uniqueEmail('norm');
    await request(t.server)
      .post('/api/v1/auth/register')
      .send({ name: 'N', email: `  ${email.toUpperCase()} `, password: PASSWORD })
      .expect(202);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash?.startsWith('$argon2id$')).toBe(true);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('re-registering an unverified email replaces the password and invalidates old links', async () => {
    const email = uniqueEmail('prereg');
    await request(t.server)
      .post('/api/v1/auth/register')
      .send({ name: 'Attacker', email, password: 'attacker password 1' });
    const oldToken = tokenFromLastEmail(t.mailer, email);
    await request(t.server)
      .post('/api/v1/auth/register')
      .send({ name: 'Owner', email, password: PASSWORD });
    const newToken = tokenFromLastEmail(t.mailer, email);
    await request(t.server).post('/api/v1/auth/verify-email').send({ token: oldToken }).expect(400);
    await request(t.server).post('/api/v1/auth/verify-email').send({ token: newToken }).expect(200);
    await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'attacker password 1' })
      .expect(401);
    await login(t, email);
  });
});

describe('login protection', () => {
  it('uses one generic error for unknown email and wrong password', async () => {
    const user = await signUp(t, 'generic');
    const wrong = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong password here' });
    const unknown = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('nobody'), password: 'wrong password here' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((wrong.body as { detail: string }).detail).toBe(
      (unknown.body as { detail: string }).detail,
    );
  });

  it('locks the account for 15 minutes after 10 failed attempts', async () => {
    const user = await signUp(t, 'lock');
    for (let i = 0; i < 10; i += 1) {
      await request(t.server)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong password here' })
        .expect(401);
    }
    // Even the correct password is refused while locked.
    await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(401);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(row.lockedUntil && row.lockedUntil > new Date()).toBe(true);
  });

  it('rejects requests without a valid access token', async () => {
    await request(t.server).get('/api/v1/me').expect(401);
    await request(t.server).get('/api/v1/me').set(bearer('not-a-jwt')).expect(401);
  });
});

describe('sessions and refresh-token rotation', () => {
  it('refresh rotates the cookie; requires the CSRF header', async () => {
    const user = await signUp(t, 'refresh');
    await request(t.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(403);
    const res = await request(t.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .set(CSRF)
      .expect(200);
    const rotated = refreshCookieFrom(res);
    expect(rotated).not.toBe(user.refreshCookie);
    const raw = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\/api\/v1\/auth/);
    await request(t.server)
      .get('/api/v1/me')
      .set(bearer((res.body as { accessToken: string }).accessToken))
      .expect(200);
  });

  it('re-use of an old refresh token (after the grace window) revokes the session', async () => {
    const user = await signUp(t, 'reuse');
    const first = await request(t.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .set(CSRF)
      .expect(200);
    // Immediate parallel re-use (two tabs) is tolerated, not treated as theft.
    const parallel = await request(t.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .set(CSRF);
    expect((parallel.body as { code: string }).code).toBe('TOKEN_ROTATED');

    // Simulate the stolen old token being replayed later.
    await db.refreshToken.updateMany({
      where: { session: { userId: user.userId }, usedAt: { not: null } },
      data: { usedAt: new Date(Date.now() - 60_000) },
    });
    const replay = await request(t.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .set(CSRF);
    expect(replay.status).toBe(401);
    // The whole session is gone: the newest token and the access token stop working.
    await request(t.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookieFrom(first))
      .set(CSRF)
      .expect(401);
    await request(t.server).get('/api/v1/me').set(bearer(user.accessToken)).expect(401);
  });

  it('logout revokes the session immediately', async () => {
    const user = await signUp(t, 'logout');
    await request(t.server).get('/api/v1/me').set(bearer(user.accessToken)).expect(200);
    await request(t.server)
      .post('/api/v1/auth/logout')
      .set('Cookie', user.refreshCookie)
      .set(CSRF)
      .expect(204);
    await request(t.server).get('/api/v1/me').set(bearer(user.accessToken)).expect(401);
  });

  it('lists and revokes own sessions only', async () => {
    const user = await signUp(t, 'sessions');
    const second = await login(t, user.email);
    const list = await request(t.server)
      .get('/api/v1/me/sessions')
      .set(bearer(user.accessToken))
      .expect(200);
    const sessions = list.body as { id: string; current: boolean }[];
    expect(sessions.length).toBe(2);
    const other = sessions.find((s) => !s.current);
    await request(t.server)
      .delete(`/api/v1/me/sessions/${other?.id}`)
      .set(bearer(user.accessToken))
      .expect(204);
    await request(t.server).get('/api/v1/me').set(bearer(second.accessToken)).expect(401);

    const stranger = await signUp(t, 'stranger');
    const strangerSessions = await request(t.server)
      .get('/api/v1/me/sessions')
      .set(bearer(stranger.accessToken));
    const strangerSessionId = (strangerSessions.body as { id: string }[])[0]?.id;
    await request(t.server)
      .delete(`/api/v1/me/sessions/${strangerSessionId}`)
      .set(bearer(user.accessToken))
      .expect(404);
  });
});

describe('password reset', () => {
  it('resets once, signs out everywhere, and new password works', async () => {
    const user = await signUp(t, 'reset');
    const unknown = await request(t.server)
      .post('/api/v1/auth/password/forgot')
      .send({ email: uniqueEmail('ghost') });
    const known = await request(t.server)
      .post('/api/v1/auth/password/forgot')
      .send({ email: user.email });
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);

    const token = tokenFromLastEmail(t.mailer, user.email);
    const newPassword = 'a brand new long password';
    await request(t.server)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: newPassword })
      .expect(200);
    await request(t.server)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'another new long password' })
      .expect(400);
    await request(t.server).get('/api/v1/me').set(bearer(user.accessToken)).expect(401);
    await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: newPassword })
      .expect(200);
  });
});

describe('MFA (TOTP)', () => {
  it('requires a code at login; TOTP codes cannot be replayed; recovery codes work once', async () => {
    const user = await enableMfa(t, await signUp(t, 'mfa'));
    const secret = user.mfaSecret ?? '';
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored.mfaSecretEnc).not.toContain(secret); // encrypted at rest

    const step1 = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const challenge = step1.body as { status: string; mfaToken: string };
    expect(challenge.status).toBe('mfa_required');
    expect(step1.headers['set-cookie']).toBeUndefined();

    await request(t.server)
      .post('/api/v1/auth/login/mfa')
      .send({ mfaToken: challenge.mfaToken, code: '000000' })
      .expect(401);
    const code = freshCode(secret);
    await request(t.server)
      .post('/api/v1/auth/login/mfa')
      .send({ mfaToken: challenge.mfaToken, code })
      .expect(200);
    // Same code again → rejected (replay protection).
    await request(t.server)
      .post('/api/v1/auth/login/mfa')
      .send({ mfaToken: challenge.mfaToken, code })
      .expect(401);

    const recovery = user.recoveryCodes?.[0] ?? '';
    await request(t.server)
      .post('/api/v1/auth/login/mfa')
      .send({ mfaToken: challenge.mfaToken, code: recovery })
      .expect(200);
    await request(t.server)
      .post('/api/v1/auth/login/mfa')
      .send({ mfaToken: challenge.mfaToken, code: recovery })
      .expect(401);
  });

  it('setup cannot be confirmed with a wrong code', async () => {
    const user = await signUp(t, 'mfa-wrong');
    const setup = await request(t.server)
      .post('/api/v1/me/mfa/setup')
      .set(bearer(user.accessToken))
      .expect(200);
    const secret = (setup.body as { secret: string; otpauthUri: string }).secret;
    expect((setup.body as { otpauthUri: string }).otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const wrong = generateTotp(secret) === '111111' ? '222222' : '111111';
    await request(t.server)
      .post('/api/v1/me/mfa/enable')
      .set(bearer(user.accessToken))
      .send({ code: wrong })
      .expect(400);
    const me = await request(t.server).get('/api/v1/me').set(bearer(user.accessToken));
    expect((me.body as { mfaEnabled: boolean }).mfaEnabled).toBe(false);
  });
});
