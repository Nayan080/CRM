import { describe, expect, it } from 'vitest';
import { median, resolvePeriod } from './reports.service.js';

describe('report helpers', () => {
  it('defaults to the last 90 days including today (UTC), end-exclusive', () => {
    const { period, gte, lt } = resolvePeriod({}, new Date('2026-11-10T15:00:00Z'));
    expect(period).toEqual({ from: '2026-08-13', to: '2026-11-10' });
    expect(gte.toISOString()).toBe('2026-08-13T00:00:00.000Z');
    expect(lt.toISOString()).toBe('2026-11-11T00:00:00.000Z');
  });

  it('rejects periods longer than two years', () => {
    expect(() => resolvePeriod({ from: '2020-01-01', to: '2026-01-01' })).toThrow(/two years/);
  });

  it('median of odd/even lists, rounded to 0.1; empty is null', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([0.04, 0.06])).toBe(0.1);
    expect(median([])).toBeNull();
  });
});
