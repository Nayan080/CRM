import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from '../errors/app-exception.js';

/**
 * Validates input against a Zod schema from @crm/contracts (same rules as the web forms).
 * Usage: `@Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadInput`
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        400,
        'VALIDATION_FAILED',
        'Request validation failed',
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
