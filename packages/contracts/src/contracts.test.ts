import { describe, expect, it } from 'vitest';
import { problemDetailsSchema, readyResponseSchema } from './index.js';

describe('contracts', () => {
  it('accepts a valid problem details object', () => {
    const parsed = problemDetailsSchema.safeParse({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      requestId: 'abc',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a problem without a code', () => {
    const parsed = problemDetailsSchema.safeParse({ type: 'about:blank', title: 'x', status: 500 });
    expect(parsed.success).toBe(false);
  });

  it('validates readiness response', () => {
    expect(
      readyResponseSchema.safeParse({ status: 'ok', checks: { database: 'up' } }).success,
    ).toBe(true);
  });
});
