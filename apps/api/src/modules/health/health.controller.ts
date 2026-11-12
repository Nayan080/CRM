import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/decorators.js';
import type { Response } from 'express';
import type { LiveResponse, ReadyResponse } from '@crm/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * Probes for load balancers / container orchestrators.
 * - live:  the process is running (restart it if this fails).
 * - ready: the process can serve traffic (stop sending traffic if this fails).
 * Mounted outside /api/v1 and not rate-limited.
 */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Process is alive' })
  live(): LiveResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Ready to serve traffic' })
  @ApiServiceUnavailableResponse({ description: 'A dependency (database) is unavailable' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadyResponse> {
    const databaseUp = await this.prisma.isHealthy();
    if (!databaseUp) res.status(503);
    return {
      status: databaseUp ? 'ok' : 'error',
      checks: { database: databaseUp ? 'up' : 'down' },
    };
  }
}
