import { describe, expect, it } from 'vitest';
import {
  createInvitationSchema,
  createTenantSchema,
  emailSchema,
  mfaCodeSchema,
  passwordSchema,
  updateMemberSchema,
} from './index.js';

describe('auth contracts', () => {
  it('normalises email', () => {
    expect(emailSchema.parse('  Owner@Acme.COM ')).toBe('owner@acme.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('password needs 12–128 characters', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('accepts TOTP and recovery codes only', () => {
    expect(mfaCodeSchema.safeParse('123456').success).toBe(true);
    expect(mfaCodeSchema.safeParse('ab12c-9xk3m').success).toBe(true);
    expect(mfaCodeSchema.safeParse('12345').success).toBe(false);
  });
});

describe('workspace contracts', () => {
  it('validates tenant slug format and reserved words', () => {
    expect(createTenantSchema.safeParse({ name: 'Acme', slug: 'acme-migration' }).success).toBe(
      true,
    );
    expect(createTenantSchema.safeParse({ name: 'Acme', slug: '-acme' }).success).toBe(false);
    expect(createTenantSchema.safeParse({ name: 'Acme', slug: 'admin' }).success).toBe(false);
  });

  it('STAFF invites require a role; EXTERNAL invites cannot carry one', () => {
    expect(createInvitationSchema.safeParse({ kind: 'STAFF', email: 'a@b.com' }).success).toBe(
      false,
    );
    const external = createInvitationSchema.parse({
      kind: 'EXTERNAL',
      email: 'lawyer@firm.com',
      roleKey: 'owner',
    });
    expect('roleKey' in external).toBe(false);
  });

  it('member update needs at least one field', () => {
    expect(updateMemberSchema.safeParse({}).success).toBe(false);
    expect(updateMemberSchema.safeParse({ status: 'SUSPENDED' }).success).toBe(true);
  });
});
