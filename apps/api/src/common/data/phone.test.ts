import { describe, expect, it } from 'vitest';
import { formatNumber } from './counters.js';
import { phoneDigits, phoneMatchKey } from './phone.js';

describe('phone matching', () => {
  it('normalises local and international formats to the same key', () => {
    expect(phoneMatchKey('0412 345 678')).toBe('412345678');
    expect(phoneMatchKey('+61 412-345-678')).toBe('412345678');
    expect(phoneDigits('(02) 9876 5432')).toBe('0298765432');
  });

  it('ignores values that are too short to be a phone number', () => {
    expect(phoneDigits('123')).toBeNull();
    expect(phoneMatchKey(null)).toBeNull();
  });
});

describe('formatNumber', () => {
  it('pads sequence numbers', () => {
    expect(formatNumber('C', 42)).toBe('C-000042');
  });
});
