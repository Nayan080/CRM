import { Module } from '@nestjs/common';
import { BranchesController } from './branches/branches.controller.js';
import { BranchesService } from './branches/branches.service.js';
import { PartnersController } from './partners/partners.controller.js';
import { PartnersService } from './partners/partners.service.js';
import { ProfessionalsController } from './professionals/professionals.controller.js';
import { ProfessionalsService } from './professionals/professionals.service.js';
import { ReferenceController } from './reference/reference.controller.js';

/** Stage 3: organization & directory (branches, configurable lists, professionals, partners). */
@Module({
  controllers: [
    BranchesController,
    ReferenceController,
    ProfessionalsController,
    PartnersController,
  ],
  providers: [BranchesService, ProfessionalsService, PartnersService],
})
export class DirectoryModule {}
