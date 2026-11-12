import request from 'supertest';
import { expect } from 'vitest';
import { generateTotp } from '../../src/common/security/totp.js';
import { type TestApp, tokenFromLastEmail, uniqueEmail, uniqueSlug } from './test-app.js';

export const PASSWORD = 'correct horse battery staple';
export const CSRF = { 'X-CRM-CSRF': '1' };

export interface SignedInUser {
  userId: string;
  email: string;
  accessToken: string;
  /** "crm_rt=..." cookie for refresh/logout calls. */
  refreshCookie: string;
  mfaSecret?: string;
  recoveryCodes?: string[];
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function tenantHeaders(user: SignedInUser, tenantId: string) {
  return { ...bearer(user.accessToken), 'X-Tenant-Id': tenantId };
}

export function refreshCookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('crm_rt='));
  if (!cookie) throw new Error('No refresh cookie set');
  return cookie.split(';')[0] ?? '';
}

/** Register → verify email → login. */
export async function signUp(
  t: TestApp,
  label: string,
  email = uniqueEmail(label),
): Promise<SignedInUser> {
  await request(t.server)
    .post('/api/v1/auth/register')
    .send({ name: `User ${label}`, email, password: PASSWORD })
    .expect(202);
  const token = tokenFromLastEmail(t.mailer, email);
  await request(t.server).post('/api/v1/auth/verify-email').send({ token }).expect(200);
  return login(t, email);
}

export async function login(t: TestApp, email: string): Promise<SignedInUser> {
  const res = await request(t.server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = res.body as { status: string; accessToken: string; user: { id: string } };
  expect(body.status).toBe('authenticated');
  return {
    userId: body.user.id,
    email,
    accessToken: body.accessToken,
    refreshCookie: refreshCookieFrom(res),
  };
}

/** A code the server has not seen yet (next 30-second step; ±1 step drift is accepted). */
export function freshCode(secret: string, stepsAhead = 1): string {
  return generateTotp(secret, Date.now() + stepsAhead * 30_000);
}

/** Turn on MFA for the signed-in user (also marks the current session MFA-verified). */
export async function enableMfa(t: TestApp, user: SignedInUser): Promise<SignedInUser> {
  const setup = await request(t.server)
    .post('/api/v1/me/mfa/setup')
    .set(bearer(user.accessToken))
    .expect(200);
  const secret = (setup.body as { secret: string }).secret;
  const enabled = await request(t.server)
    .post('/api/v1/me/mfa/enable')
    .set(bearer(user.accessToken))
    .send({ code: generateTotp(secret) })
    .expect(200);
  return {
    ...user,
    mfaSecret: secret,
    recoveryCodes: (enabled.body as { recoveryCodes: string[] }).recoveryCodes,
  };
}

export async function createWorkspace(
  t: TestApp,
  owner: SignedInUser,
  label: string,
): Promise<{ tenantId: string; slug: string }> {
  const slug = uniqueSlug(label);
  const res = await request(t.server)
    .post('/api/v1/tenants')
    .set(bearer(owner.accessToken))
    .send({ name: `Agency ${label}`, slug })
    .expect(201);
  return { tenantId: (res.body as { tenantId: string }).tenantId, slug };
}

/** Owner with MFA on + a workspace — ready to use tenant routes. */
export async function ownerWithWorkspace(t: TestApp, label: string) {
  const owner = await enableMfa(t, await signUp(t, `${label}-owner`));
  const workspace = await createWorkspace(t, owner, label);
  return { owner, ...workspace };
}

/** Invite → invitee creates an account via the invitation (signed in afterwards). */
export async function inviteNewUser(
  t: TestApp,
  inviter: SignedInUser,
  tenantId: string,
  invite: { kind: 'STAFF'; roleKey: string; branchIds?: string[] } | { kind: 'EXTERNAL' },
  label: string,
): Promise<SignedInUser & { membershipTenantId: string }> {
  const email = uniqueEmail(label);
  await request(t.server)
    .post('/api/v1/invitations')
    .set(tenantHeaders(inviter, tenantId))
    .send({ ...invite, email })
    .expect(201);
  const token = tokenFromLastEmail(t.mailer, email);
  const res = await request(t.server)
    .post('/api/v1/invitations/accept-new')
    .send({ token, name: `User ${label}`, password: PASSWORD })
    .expect(200);
  const body = res.body as { accessToken: string; user: { id: string } };
  return {
    userId: body.user.id,
    email,
    accessToken: body.accessToken,
    refreshCookie: refreshCookieFrom(res),
    membershipTenantId: tenantId,
  };
}
