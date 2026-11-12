import { describe, expect, it } from 'vitest';
import {
  createDeadlineSchema,
  createParticipantSchema,
  createTaskSchema,
  transitionMatterSchema,
} from './matters.js';

const id = '01a1c595-158b-7363-88f0-46473bc90437';

describe('matter contracts', () => {
  it('a participant is exactly one client, professional or partner', () => {
    expect(createParticipantSchema.safeParse({ roleId: id, clientId: id }).success).toBe(true);
    expect(createParticipantSchema.safeParse({ roleId: id }).success).toBe(false);
    expect(
      createParticipantSchema.safeParse({ roleId: id, clientId: id, partnerOrgId: id }).success,
    ).toBe(false);
  });

  it('a task links to at most one record', () => {
    expect(createTaskSchema.safeParse({ title: 'x' }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: 'x', matterId: id, leadId: id }).success).toBe(
      false,
    );
  });

  it('a reminder cannot be after the due time', () => {
    const dueAt = '2026-12-01T10:00:00Z';
    expect(
      createDeadlineSchema.safeParse({ title: 'x', dueAt, remindAt: '2026-11-30T10:00:00Z' })
        .success,
    ).toBe(true);
    expect(
      createDeadlineSchema.safeParse({ title: 'x', dueAt, remindAt: '2026-12-02T10:00:00Z' })
        .success,
    ).toBe(false);
  });

  it('a transition needs a stage or a status', () => {
    expect(transitionMatterSchema.safeParse({}).success).toBe(false);
    expect(transitionMatterSchema.safeParse({ status: 'CLOSED' }).success).toBe(true);
  });
});
