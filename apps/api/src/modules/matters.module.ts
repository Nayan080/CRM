import { Module } from '@nestjs/common';
import { AutomationController } from './matters/automation.controller.js';
import { MatterTypesService } from './matters/matter-types.service.js';
import {
  MatterTypesController,
  MattersController,
  TasksController,
} from './matters/matters.controllers.js';
import { MattersService } from './matters/matters.service.js';
import { RemindersService } from './matters/reminders.service.js';
import { TasksService } from './matters/tasks.service.js';

/** Stage 5: matters (types, stages, checklists, assignments, participants, deadlines), tasks. */
@Module({
  controllers: [MatterTypesController, MattersController, TasksController, AutomationController],
  providers: [MatterTypesService, MattersService, TasksService, RemindersService],
  exports: [MattersService, RemindersService],
})
export class MattersModule {}
