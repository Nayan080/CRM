import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_CENSOR, buildLoggerOptions, resolveRequestId } from './logger-options.js';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = pino(buildLoggerOptions({ logLevel: 'info', nodeEnv: 'test' }), stream);
  return { logger, lines };
}

describe('logger options', () => {
  it('writes every line as JSON with ISO time and level label', () => {
    const { logger, lines } = captureLogger();
    logger.info({ requestId: 'r-1' }, 'hello');
    const entry = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('hello');
    expect(entry.requestId).toBe('r-1');
    expect(typeof entry.time).toBe('string');
  });

  it('redacts passwords, tokens and auth headers', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        password: 'p@ss',
        user: { token: 'tok-123', refreshToken: 'ref-456', email: 'a@b.com' },
        req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1' } },
      },
      'login attempt',
    );
    const raw = lines[0] ?? '';
    expect(raw).not.toMatch(/p@ss|tok-123|ref-456|Bearer abc|sid=1/);
    const entry = JSON.parse(raw) as {
      password: string;
      user: { token: string; email: string };
      req: { headers: { authorization: string } };
    };
    expect(entry.password).toBe(REDACT_CENSOR);
    expect(entry.user.token).toBe(REDACT_CENSOR);
    expect(entry.req.headers.authorization).toBe(REDACT_CENSOR);
    expect(entry.user.email).toBe('a@b.com');
  });
});

describe('resolveRequestId', () => {
  it('reuses a safe incoming id', () => {
    expect(resolveRequestId('abc-123')).toBe('abc-123');
  });

  it('replaces unsafe or oversized ids with a UUID', () => {
    expect(resolveRequestId('bad id\n<script>')).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('x'.repeat(65))).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
