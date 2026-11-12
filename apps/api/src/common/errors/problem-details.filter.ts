import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@crm/contracts';
import { AppException } from './app-exception.js';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

export function defaultCodeForStatus(status: number): string {
  return DEFAULT_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
}

/** Converts any thrown error into an RFC 9457 problem+json response. */
export function toProblemDetails(
  exception: unknown,
  context: { path: string; requestId?: string },
): ProblemDetails {
  let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
  let code = 'INTERNAL_ERROR';
  let detail: string | undefined;
  let errors: ProblemDetails['errors'];

  if (exception instanceof AppException) {
    status = exception.getStatus();
    code = exception.code;
    detail = exception.message;
    errors = exception.errors;
  } else if (exception instanceof HttpException) {
    status = exception.getStatus();
    code = defaultCodeForStatus(status);
    detail = exception.message;
    // The router's default 404 message echoes the full URL incl. query string (may hold tokens).
    if (status === 404 && /^Cannot [A-Z]+ /.test(detail)) {
      detail = 'The requested resource was not found.';
    }
  }

  // Never expose internal error details (stack, SQL, messages) to clients.
  if (status >= 500) {
    detail = status === 503 ? detail : 'An unexpected error occurred.';
  }

  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    ...(detail ? { detail } : {}),
    instance: context.path,
    code,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(errors?.length ? { errors } : {}),
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();

    const problem = toProblemDetails(exception, {
      path: (req.originalUrl ?? req.url).split('?')[0] ?? '/',
      requestId: req.id,
    });

    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: req.id }, 'Unhandled error');
    }

    if (res.headersSent) return;
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }
}
