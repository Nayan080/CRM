import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  OWNER_ROLE_KEY,
  PERMISSIONS,
  ROLE_TEMPLATES,
  canGrantRole,
  findRoleTemplate,
  isValidPermissionCode,
  scopeFor,
} from './index.js';

describe('permission catalogue', () => {
  it('every permission follows resource:action and is unique', () => {
    for (const code of ALL_PERMISSIONS) expect(isValidPermissionCode(code)).toBe(true);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('rejects malformed codes', () => {
    expect(isValidPermissionCode('Matter:Read')).toBe(false);
    expect(isValidPermissionCode('matter')).toBe(false);
  });
});

describe('role templates (DEC-08)', () => {
  it('has the 9 system roles with unique keys', () => {
    const keys = ROLE_TEMPLATES.map((r) => r.key);
    expect(keys).toEqual([
      'owner',
      'admin',
      'branch_manager',
      'migration_agent',
      'migration_lawyer',
      'case_manager',
      'sales_manager',
      'receptionist',
      'finance_manager',
    ]);
  });

  it('only owner and admin require MFA (DEC-06)', () => {
    expect(ROLE_TEMPLATES.filter((r) => r.requiresMfa).map((r) => r.key)).toEqual([
      'owner',
      'admin',
    ]);
  });

  it('roles never repeat a permission and use only catalogue codes', () => {
    for (const role of ROLE_TEMPLATES) {
      const codes = role.grants.map((g) => g.permission);
      expect(new Set(codes).size, role.key).toBe(codes.length);
      for (const code of codes) expect(ALL_PERMISSIONS).toContain(code);
    }
  });

  it('admin has no billing permissions; owner has everything', () => {
    const admin = findRoleTemplate('admin');
    const owner = findRoleTemplate(OWNER_ROLE_KEY);
    expect(scopeFor(admin?.grants ?? [], PERMISSIONS.BILLING_READ)).toBeNull();
    expect(owner?.grants).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('appointments and tasks (v2): reception books consultations; finance has neither', () => {
    const scopeOf = (role: string, p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) =>
      scopeFor(findRoleTemplate(role)?.grants ?? [], p);
    expect(scopeOf('receptionist', PERMISSIONS.APPOINTMENT_MANAGE)).toBe('TENANT');
    expect(scopeOf('receptionist', PERMISSIONS.TASK_READ)).toBeNull();
    expect(scopeOf('migration_agent', PERMISSIONS.TASK_MANAGE)).toBe('OWN');
    expect(scopeOf('branch_manager', PERMISSIONS.APPOINTMENT_READ)).toBe('BRANCH');
    expect(scopeOf('finance_manager', PERMISSIONS.APPOINTMENT_READ)).toBeNull();
  });

  it('agents see only their own matters', () => {
    const agent = findRoleTemplate('migration_agent');
    expect(scopeFor(agent?.grants ?? [], PERMISSIONS.MATTER_READ)).toBe('OWN');
  });
});

describe('canGrantRole (privilege escalation guard)', () => {
  const owner = findRoleTemplate('owner')?.grants ?? [];
  const admin = findRoleTemplate('admin')?.grants ?? [];
  const branchManager = findRoleTemplate('branch_manager')?.grants ?? [];
  const agent = findRoleTemplate('migration_agent')?.grants ?? [];

  it('owner can grant any role', () => {
    for (const role of ROLE_TEMPLATES) expect(canGrantRole(owner, role.grants)).toBe(true);
  });

  it('admin cannot grant owner (billing) but can grant agent', () => {
    expect(canGrantRole(admin, owner)).toBe(false);
    expect(canGrantRole(admin, agent)).toBe(true);
  });

  it('branch manager cannot grant admin, and cannot widen a scope', () => {
    expect(canGrantRole(branchManager, admin)).toBe(false);
    expect(canGrantRole(agent, branchManager)).toBe(false);
  });
});
