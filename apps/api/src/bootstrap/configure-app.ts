import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { RequestContext } from '../common/context/request-context.js';
import type { AppConfig } from '../config/app-config.js';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = 'api/docs';

/**
 * HTTP-level setup shared by main.ts and the integration tests,
 * so tests exercise exactly what runs in production.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  // Behind one load balancer (e.g. AWS ALB) in production: trust exactly one proxy hop
  // so client IPs (used by rate limiting and audit logs) are correct.
  app.set('trust proxy', config.isProduction ? 1 : false);
  app.disable('x-powered-by');

  // Security headers. The JSON API gets a strict CSP; Swagger UI (non-prod only) needs inline assets.
  const strictHelmet = helmet();
  const docsHelmet = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(`/${DOCS_PATH}`)
      ? docsHelmet(req, res, next)
      : strictHelmet(req, res, next),
  );

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-Id',
      'Idempotency-Key',
      'X-Request-Id',
      // Required by the refresh/logout endpoints (CSRF defence); must be allowed for preflight.
      'X-CRM-CSRF',
    ],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    maxAge: 600,
  });

  // Per-request security context (AsyncLocalStorage); filled by the guards.
  app.use((req: Request, _res: Response, next: NextFunction) =>
    RequestContext.run(
      { ipAddress: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) },
      next,
    ),
  );
  // Only the refresh-token cookie is read (auth endpoints).
  app.use(cookieParser());

  // Small JSON body limit; file uploads go directly to object storage (Stage 6).
  app.useBodyParser('json', { limit: '100kb' });

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Migration CRM API')
        .setDescription('Multi-tenant Migration Business Management CRM')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(DOCS_PATH, app, document, { jsonDocumentUrl: `${DOCS_PATH}-json` });
  }
}
