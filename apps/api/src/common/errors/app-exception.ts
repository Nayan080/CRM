import { STATUS_CODES } from 'node:http';
import { HttpException } from '@nestjs/common';
import type { FieldError } from '@crm/contracts';

/**
 * Application error with a stable machine-readable `code`.
 * Rendered as RFC 9457 problem+json by ProblemDetailsFilter.
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    detail?: string,
    public readonly errors?: FieldError[],
  ) {
    super(detail ?? STATUS_CODES[status] ?? 'Error', status);
  }
}
