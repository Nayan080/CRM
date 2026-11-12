import { Module } from '@nestjs/common';
import { PlatformGuard } from '../common/auth/platform.guard.js';
import { PlatformController } from './platform/platform.controller.js';
import { PlatformService } from './platform/platform.service.js';

/** Stage 7: platform administration (agency metadata, plans, suspension). */
@Module({ controllers: [PlatformController], providers: [PlatformService, PlatformGuard] })
export class PlatformModule {}
