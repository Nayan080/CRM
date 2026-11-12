import { z } from 'zod';

/** DI token for the validated, typed configuration object. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const booleanString = z
  .enum(['true', 'false'], { message: 'must be "true" or "false"' })
  .transform((value) => value === 'true');

const postgresUrl = z
  .string({ message: 'is required' })
  .min(1, 'is required')
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: 'must start with postgresql:// or postgres://',
  });

/**
 * Every environment variable the API reads is declared and validated here.
 * The app refuses to start if anything is missing or invalid (fail fast).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Runtime DB user: must NOT be a superuser, so Row-Level Security applies (ADR-0002). */
    DATABASE_URL: postgresUrl,
    CORS_ORIGINS: z
      .string({ message: 'is required (comma-separated origins)' })
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(
        z
          .array(z.url({ message: 'each origin must be a full URL, e.g. https://app.example.com' }))
          .min(1),
      ),
    /** Base URL of the web app, used to build links in emails. */
    WEB_APP_URL: z.url({ message: 'must be a full URL, e.g. https://app.example.com' }),
    SWAGGER_ENABLED: booleanString.default(false),
    RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    /** Stricter per-IP limit for login, registration, reset and invitation endpoints. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    /** HMAC secret for access tokens. Generate with: openssl rand -base64 48 */
    JWT_ACCESS_SECRET: z
      .string({ message: 'is required' })
      .min(32, 'must be at least 32 characters (use a random value)'),
    /** 32-byte key (base64) that encrypts MFA secrets at rest. Generate with: openssl rand -base64 32 */
    MFA_ENCRYPTION_KEY: z
      .string({ message: 'is required' })
      .refine((v) => Buffer.from(v, 'base64').length === 32, {
        message: 'must be 32 bytes encoded as base64',
      }),
    /** Set the refresh cookie "Secure" flag. Defaults to true in production. */
    COOKIE_SECURE: booleanString.optional(),
    /** smtp = real SMTP (Mailpit locally); memory = tests; log = print to logs (development only). */
    MAIL_TRANSPORT: z.enum(['smtp', 'memory', 'log']).default('log'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    MAIL_FROM: z.string().default('Migration CRM <no-reply@localhost>'),
    /** s3 = any S3-compatible store (S3Proxy locally, DEC-15); memory = tests only. */
    STORAGE_DRIVER: z.enum(['s3', 'memory']).default('s3'),
    /** Leave empty for AWS S3. Locally: http://localhost:9000 (S3Proxy in docker-compose). */
    S3_ENDPOINT: z.union([z.literal(''), z.url()]).optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(3).optional(),
    /** Optional: without keys the AWS SDK uses its normal credential chain (e.g. an IAM role). */
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: booleanString.optional(),
    /** Server-side encryption header for uploads (e.g. AES256 or aws:kms). */
    S3_SSE: z.enum(['AES256', 'aws:kms']).optional(),
    /** Create the bucket at start-up if missing. Development only. */
    S3_CREATE_BUCKET: booleanString.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT !== 'smtp') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'must be "smtp" in production (memory/log would lose or expose email links)',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (env.STORAGE_DRIVER !== 's3') {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message: 'must be "s3" in production',
        });
      }
      for (const key of ['S3_BUCKET', 'S3_REGION'] as const) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
      }
      if (env.S3_CREATE_BUCKET) {
        ctx.addIssue({
          code: 'custom',
          path: ['S3_CREATE_BUCKET'],
          message: 'must not be true in production',
        });
      }
    }
  });

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  logLevel: string;
  databaseUrl: string;
  corsOrigins: string[];
  webAppUrl: string;
  /** Always false in production, whatever the env says. */
  swaggerEnabled: boolean;
  rateLimit: { ttlMs: number; max: number; authMax: number };
  auth: {
    jwtAccessSecret: string;
    mfaEncryptionKey: Buffer;
    cookieSecure: boolean;
  };
  mail: {
    transport: 'smtp' | 'memory' | 'log';
    smtpHost: string;
    smtpPort: number;
    from: string;
  };
  storage: {
    driver: 's3' | 'memory';
    endpoint: string | undefined;
    region: string;
    bucket: string;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
    forcePathStyle: boolean;
    sse: 'AES256' | 'aws:kms' | undefined;
    createBucket: boolean;
  };
}

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'ConfigValidationError';
  }
}

/** Parse and validate environment variables. Never includes values in errors (they may be secrets). */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.map(String).join('.') || '(root)';
      return `${key}: ${issue.message}`;
    });
    throw new ConfigValidationError(issues);
  }

  const e = result.data;
  const isProduction = e.NODE_ENV === 'production';
  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.API_PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    corsOrigins: e.CORS_ORIGINS,
    webAppUrl: e.WEB_APP_URL.replace(/\/$/, ''),
    swaggerEnabled: e.SWAGGER_ENABLED && !isProduction,
    rateLimit: {
      ttlMs: e.RATE_LIMIT_TTL_MS,
      max: e.RATE_LIMIT_MAX,
      authMax: e.AUTH_RATE_LIMIT_MAX,
    },
    auth: {
      jwtAccessSecret: e.JWT_ACCESS_SECRET,
      mfaEncryptionKey: Buffer.from(e.MFA_ENCRYPTION_KEY, 'base64'),
      cookieSecure: e.COOKIE_SECURE ?? isProduction,
    },
    mail: {
      transport: e.MAIL_TRANSPORT,
      smtpHost: e.SMTP_HOST,
      smtpPort: e.SMTP_PORT,
      from: e.MAIL_FROM,
    },
    // Outside production, missing values fall back to the local S3Proxy in docker-compose.yml.
    storage: {
      driver: e.STORAGE_DRIVER,
      endpoint: e.S3_ENDPOINT || (isProduction ? undefined : 'http://localhost:9000'),
      region: e.S3_REGION ?? 'ap-southeast-2',
      bucket: e.S3_BUCKET ?? 'crm-documents-local',
      accessKeyId: e.S3_ACCESS_KEY_ID ?? (isProduction ? undefined : 'local-identity'),
      secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? (isProduction ? undefined : 'local-credential'),
      forcePathStyle: e.S3_FORCE_PATH_STYLE ?? !!(e.S3_ENDPOINT || !isProduction),
      sse: e.S3_SSE,
      createBucket: e.S3_CREATE_BUCKET ?? !isProduction,
    },
  };
}
