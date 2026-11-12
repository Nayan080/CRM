import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stdTimeFunctions, type LoggerOptions } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import type { AppConfig } from '../../config/app-config.js';

/**
 * Fields that must never appear in logs. pino replaces them with "[REDACTED]".
 * `*.x` matches one nesting level; list deeper paths explicitly when needed.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secret',
  '*.secret',
  'mfaSecret',
  '*.mfaSecret',
  'databaseUrl',
  '*.databaseUrl',
];

export const REDACT_CENSOR = '[REDACTED]';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Reuse a caller-supplied X-Request-Id only if it is short and safe; otherwise generate one. */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Base pino options shared by HTTP logging and tests. Always JSON (no pretty transport). */
export function buildLoggerOptions(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>): LoggerOptions {
  return {
    level: config.logLevel,
    base: { service: 'crm-api', env: config.nodeEnv },
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
  };
}

export function buildPinoHttpOptions(
  config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>,
): PinoHttpOptions {
  return {
    ...buildLoggerOptions(config),
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const id = resolveRequestId(req.headers['x-request-id']);
      res.setHeader('X-Request-Id', id);
      return id;
    },
    // Health probes run every few seconds; logging them only adds noise and cost.
    autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
    serializers: {
      // Drop query strings: they can carry tokens (e.g. invitation links).
      req: (req: { id: string; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url.split('?')[0],
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  };
}
