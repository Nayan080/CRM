import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserAwareThrottlerGuard } from './common/auth/user-throttler.guard.js';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './common/auth/auth.guard.js';
import { PermissionGuard } from './common/auth/permission.guard.js';
import { configureAuthRateLimit } from './common/auth/rate-limits.js';
import { TenantGuard } from './common/auth/tenant.guard.js';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { buildPinoHttpOptions } from './common/logging/logger-options.js';
import type { AppConfig } from './config/app-config.js';
import { AppConfigModule } from './config/app-config.module.js';
import { MailModule } from './infra/mail/mail.module.js';
import { StorageModule } from './infra/storage/storage.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { CrmModule } from './modules/crm.module.js';
import { DocumentsModule } from './modules/documents.module.js';
import { MattersModule } from './modules/matters.module.js';
import { PlatformModule } from './modules/platform.module.js';
import { ReportsModule } from './modules/reports.module.js';
import { DirectoryModule } from './modules/directory.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityModule } from './modules/identity.module.js';
import { MetaController } from './modules/meta/meta.controller.js';

/**
 * Root module. Built from an already-validated config so tests can pass their own
 * config without touching process.env.
 *
 * Global guards run in this order for every request:
 *   1. ThrottlerGuard   – rate limit
 *   2. AuthGuard        – valid access token + live session (unless @Public)
 *   3. TenantGuard      – verified ACTIVE membership for X-Tenant-Id (only @TenantScoped routes)
 *   4. PermissionGuard  – required permission + scope (only @RequirePermission routes)
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    configureAuthRateLimit(config.rateLimit.authMax);
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggerModule.forRoot({ pinoHttp: buildPinoHttpOptions(config) }),
        ThrottlerModule.forRoot([{ ttl: config.rateLimit.ttlMs, limit: config.rateLimit.max }]),
        PrismaModule,
        MailModule,
        StorageModule,
        HealthModule,
        IdentityModule,
        DirectoryModule,
        CrmModule,
        MattersModule,
        DocumentsModule,
        ReportsModule,
        PlatformModule,
      ],
      controllers: [MetaController],
      providers: [
        { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
