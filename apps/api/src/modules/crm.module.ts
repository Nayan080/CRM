import { Module } from '@nestjs/common';
import {
  ActivitiesController,
  AppointmentsController,
  ClientsController,
  LeadsController,
} from './crm/crm.controllers.js';
import { ClientsService } from './crm/clients.service.js';
import { LeadsService } from './crm/leads.service.js';
import { TimelineService } from './crm/timeline.service.js';

/** Stage 4: CRM core (leads, clients, relationships, activities, consultations/appointments). */
@Module({
  controllers: [LeadsController, ClientsController, ActivitiesController, AppointmentsController],
  providers: [LeadsService, ClientsService, TimelineService],
  exports: [ClientsService],
})
export class CrmModule {}
