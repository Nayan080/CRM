import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppException } from '../errors/app-exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const pipe = new ZodValidationPipe(z.object({ email: z.email(), name: z.string().min(1) }));

describe('ZodValidationPipe', () => {
  it('returns parsed data when valid', () => {
    expect(pipe.transform({ email: 'a@b.com', name: 'A' })).toEqual({
      email: 'a@b.com',
      name: 'A',
    });
  });

  it('throws VALIDATION_FAILED with field paths when invalid', () => {
    try {
      pipe.transform({ email: 'nope', name: '' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      const appError = error as AppException;
      expect(appError.getStatus()).toBe(400);
      expect(appError.code).toBe('VALIDATION_FAILED');
      expect(appError.errors?.map((e) => e.path).sort()).toEqual(['email', 'name']);
    }
  });
});
