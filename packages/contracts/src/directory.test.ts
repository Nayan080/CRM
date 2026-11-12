import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REFERENCE_OPTIONS,
  createBranchSchema,
  createCredentialSchema,
  createPartnerSchema,
  listQuerySchema,
  updateProfessionalSchema,
  updateTenantSchema,
} from './index.js';

const id = '0199c2f0-0000-7000-8000-000000000001';

describe('directory contracts', () => {
  it('empty optional text clears the value; omitted means no change', () => {
    const parsed = updateProfessionalSchema.parse({ phone: '', email: '' });
    expect(parsed).toEqual({ phone: null, email: null });
    expect('notes' in parsed).toBe(false);
  });

  it('validates branch time zone', () => {
    expect(
      createBranchSchema.safeParse({ name: 'Sydney', timezone: 'Australia/Sydney' }).success,
    ).toBe(true);
    expect(createBranchSchema.safeParse({ name: 'X', timezone: 'Mars/Phobos' }).success).toBe(
      false,
    );
    expect(updateTenantSchema.safeParse({ timezone: 'Not/AZone' }).success).toBe(false);
  });

  it('credential expiry cannot be before issue date', () => {
    const base = { credentialType: 'MARN', issuer: 'OMARA', identifier: '1234567' };
    expect(
      createCredentialSchema.safeParse({ ...base, issuedOn: '2025-01-01', expiresOn: '2026-01-01' })
        .success,
    ).toBe(true);
    expect(
      createCredentialSchema.safeParse({ ...base, issuedOn: '2026-01-01', expiresOn: '2025-01-01' })
        .success,
    ).toBe(false);
    expect(createCredentialSchema.safeParse({ ...base, expiresOn: '01/02/2026' }).success).toBe(
      false,
    );
  });

  it('partner needs a name and a type; website must be a full URL', () => {
    expect(
      createPartnerSchema.safeParse({
        name: 'Acme Law',
        typeId: id,
        website: 'https://acme.example',
      }).success,
    ).toBe(true);
    expect(
      createPartnerSchema.safeParse({ name: 'Acme Law', typeId: id, website: 'acme' }).success,
    ).toBe(false);
    expect(createPartnerSchema.safeParse({ name: '', typeId: id }).success).toBe(false);
  });

  it('list query has safe defaults and limits', () => {
    expect(listQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(listQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(false);
  });

  it('default reference keys are unique per category', () => {
    for (const options of Object.values(DEFAULT_REFERENCE_OPTIONS)) {
      const keys = options.map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
