import { describe, expect, it } from 'vitest';
import { ConfigValidationError, parseConfig } from './app-config.js';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:secret-pass@localhost:5432/crm',
  CORS_ORIGINS: 'http://localhost:3000, https://app.example.com',
  WEB_APP_URL: 'http://localhost:3000/',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('parseConfig', () => {
  it('parses a valid environment with defaults', () => {
    const config = parseConfig(valid);
    expect(config.port).toBe(4000);
    expect(config.corsOrigins).toEqual(['http://localhost:3000', 'https://app.example.com']);
    expect(config.rateLimit).toEqual({ ttlMs: 60_000, max: 100, authMax: 10 });
    expect(config.swaggerEnabled).toBe(false);
    expect(config.webAppUrl).toBe('http://localhost:3000');
    expect(config.auth.mfaEncryptionKey).toHaveLength(32);
    expect(config.auth.cookieSecure).toBe(false);
    expect(config.mail.transport).toBe('log');
  });

  it('fails fast and names the missing variable', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() => parseConfig(rest)).toThrow(ConfigValidationError);
    expect(() => parseConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it('never leaks secret values in the error message', () => {
    try {
      parseConfig({ ...valid, DATABASE_URL: 'mysql://user:secret-pass@db/crm' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/DATABASE_URL/);
      expect((error as Error).message).not.toMatch(/secret-pass/);
    }
  });

  it('rejects wildcard / invalid CORS origins', () => {
    expect(() => parseConfig({ ...valid, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  it('rejects an invalid port', () => {
    expect(() => parseConfig({ ...valid, API_PORT: '99999' })).toThrow(/API_PORT/);
  });

  it('rejects a short JWT secret and a wrong-size MFA key', () => {
    expect(() => parseConfig({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() =>
      parseConfig({ ...valid, MFA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/MFA_ENCRYPTION_KEY/);
  });

  it('production: Swagger forced off, secure cookies, and real email required', () => {
    expect(() => parseConfig({ ...valid, NODE_ENV: 'production' })).toThrow(/MAIL_TRANSPORT/);
    const config = parseConfig({
      ...valid,
      NODE_ENV: 'production',
      SWAGGER_ENABLED: 'true',
      MAIL_TRANSPORT: 'smtp',
      S3_BUCKET: 'crm-documents',
      S3_REGION: 'ap-southeast-2',
    });
    expect(config.swaggerEnabled).toBe(false);
    expect(config.isProduction).toBe(true);
    expect(config.auth.cookieSecure).toBe(true);
    // No local fallbacks in production: AWS endpoint and the SDK credential chain.
    expect(config.storage).toMatchObject({
      endpoint: undefined,
      accessKeyId: undefined,
      createBucket: false,
    });
  });

  it('production: storage must be configured S3 with bucket and region', () => {
    const prod = { ...valid, NODE_ENV: 'production', MAIL_TRANSPORT: 'smtp' };
    expect(() => parseConfig(prod)).toThrow(/S3_BUCKET/);
    expect(() =>
      parseConfig({ ...prod, S3_BUCKET: 'bkt', S3_REGION: 'r', STORAGE_DRIVER: 'memory' }),
    ).toThrow(/STORAGE_DRIVER/);
    expect(() =>
      parseConfig({ ...prod, S3_BUCKET: 'bkt', S3_REGION: 'r', S3_CREATE_BUCKET: 'true' }),
    ).toThrow(/S3_CREATE_BUCKET/);
  });

  it('development: storage falls back to the local S3Proxy', () => {
    expect(parseConfig(valid).storage).toMatchObject({
      driver: 's3',
      endpoint: 'http://localhost:9000',
      bucket: 'crm-documents-local',
      forcePathStyle: true,
      createBucket: true,
    });
  });
});
