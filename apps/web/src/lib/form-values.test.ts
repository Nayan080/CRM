import { describe, expect, it } from 'vitest';
import { cleanBody } from './form-values';

describe('cleanBody', () => {
  it('drops empty fields on create and clears them on update', () => {
    expect(cleanBody({ name: 'A', email: '', phone: undefined }, 'create')).toEqual({ name: 'A' });
    expect(cleanBody({ name: 'A', email: '' }, 'update')).toEqual({ name: 'A', email: null });
  });
});
