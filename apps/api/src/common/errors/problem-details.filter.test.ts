import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { problemDetailsSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { AppException } from './app-exception.js';
import { toProblemDetails } from './problem-details.filter.js';

const ctx = { path: '/api/v1/things/1', requestId: 'req-1' };

describe('toProblemDetails', () => {
  it('maps Nest HTTP exceptions to RFC 9457 with a default code', () => {
    const problem = toProblemDetails(new NotFoundException(), ctx);
    expect(problemDetailsSchema.parse(problem)).toBeTruthy();
    expect(problem).toMatchObject({
      status: 404,
      title: 'Not Found',
      code: 'NOT_FOUND',
      requestId: 'req-1',
      instance: '/api/v1/things/1',
    });
  });

  it('keeps AppException code and field errors', () => {
    const problem = toProblemDetails(
      new AppException(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'email', message: 'Invalid email' },
      ]),
      ctx,
    );
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors).toEqual([{ path: 'email', message: 'Invalid email' }]);
  });

  it('hides internal details of unknown errors', () => {
    const problem = toProblemDetails(new Error('SELECT * FROM users failed: password=x'), ctx);
    expect(problem.status).toBe(500);
    expect(problem.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(problem)).not.toMatch(/SELECT|password/);
  });

  it('does not echo the URL / query string for unknown routes', () => {
    const problem = toProblemDetails(new NotFoundException('Cannot GET /x?token=SECRET'), ctx);
    expect(JSON.stringify(problem)).not.toMatch(/SECRET/);
    expect(problem.detail).toBe('The requested resource was not found.');
  });

  it('keeps 503 detail', () => {
    const problem = toProblemDetails(new ServiceUnavailableException('Database unavailable'), ctx);
    expect(problem.detail).toBe('Database unavailable');
  });
});
