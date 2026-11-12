import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators.js';

/** GET /api/v1 — API identity. Rate-limited like every normal route. */
@ApiTags('meta')
@Public()
@Controller()
export class MetaController {
  @Get()
  @ApiOkResponse({ description: 'API name and version' })
  info(): { name: string; version: string } {
    return { name: 'migration-crm-api', version: '0.1.0' };
  }
}
