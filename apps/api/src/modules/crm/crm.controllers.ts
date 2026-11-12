import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ActivityListQuery,
  type ActivityResponse,
  type AppointmentListQuery,
  type AppointmentResponse,
  type ClientDetail,
  type ClientSummary,
  type ConvertLeadInput,
  type ConvertLeadResponse,
  type CreateActivityInput,
  type CreateAppointmentInput,
  type CreateClientInput,
  type CreateLeadInput,
  type CreateRelationshipInput,
  type DuplicateQuery,
  type DuplicateResponse,
  type LeadDetail,
  type LeadListQuery,
  type LeadSummary,
  type ListQuery,
  type Paginated,
  type UpdateAppointmentInput,
  type UpdateClientInput,
  type UpdateLeadInput,
  activityListQuerySchema,
  appointmentListQuerySchema,
  convertLeadSchema,
  createActivitySchema,
  createAppointmentSchema,
  createClientSchema,
  createLeadSchema,
  createRelationshipSchema,
  duplicateQuerySchema,
  leadListQuerySchema,
  listQuerySchema,
  updateAppointmentSchema,
  updateClientSchema,
  updateLeadSchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { ClientsService } from './clients.service.js';
import { LeadsService } from './leads.service.js';
import { TimelineService } from './timeline.service.js';

const uuid = () => new ParseUUIDPipe();
const P = PERMISSIONS;

@ApiTags('leads')
@TenantScoped()
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermission(P.LEAD_READ)
  list(
    @Query(new ZodValidationPipe(leadListQuerySchema)) q: LeadListQuery,
  ): Promise<Paginated<LeadSummary>> {
    return this.leads.list(q);
  }

  @Post()
  @RequirePermission(P.LEAD_CREATE)
  create(
    @Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadInput,
  ): Promise<LeadDetail> {
    return this.leads.create(body);
  }

  @Get(':id')
  @RequirePermission(P.LEAD_READ)
  get(@Param('id', uuid()) id: string): Promise<LeadDetail> {
    return this.leads.get(id);
  }

  @Patch(':id')
  @RequirePermission(P.LEAD_UPDATE)
  update(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(updateLeadSchema)) body: UpdateLeadInput,
  ): Promise<LeadDetail> {
    return this.leads.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(P.LEAD_DELETE)
  remove(@Param('id', uuid()) id: string): Promise<void> {
    return this.leads.remove(id);
  }

  @Post(':id/convert')
  @HttpCode(200)
  @RequirePermission(P.LEAD_UPDATE)
  convert(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(convertLeadSchema)) body: ConvertLeadInput,
  ): Promise<ConvertLeadResponse> {
    return this.leads.convert(id, body);
  }
}

@ApiTags('clients')
@TenantScoped()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermission(P.CLIENT_READ)
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) q: ListQuery,
  ): Promise<Paginated<ClientSummary>> {
    return this.clients.list(q);
  }

  /** Possible duplicates before creating a client or converting a lead. */
  @Get('duplicates')
  @RequirePermission(P.CLIENT_READ)
  duplicates(
    @Query(new ZodValidationPipe(duplicateQuerySchema)) q: DuplicateQuery,
  ): Promise<DuplicateResponse> {
    return this.clients.duplicates(q);
  }

  @Post()
  @RequirePermission(P.CLIENT_CREATE)
  create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
  ): Promise<ClientDetail> {
    return this.clients.create(body);
  }

  @Get(':id')
  @RequirePermission(P.CLIENT_READ)
  get(@Param('id', uuid()) id: string): Promise<ClientDetail> {
    return this.clients.get(id);
  }

  @Patch(':id')
  @RequirePermission(P.CLIENT_UPDATE)
  update(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput,
  ): Promise<ClientDetail> {
    return this.clients.update(id, body);
  }

  @Post(':id/relationships')
  @RequirePermission(P.CLIENT_UPDATE)
  addRelationship(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(createRelationshipSchema)) body: CreateRelationshipInput,
  ): Promise<ClientDetail> {
    return this.clients.addRelationship(id, body);
  }

  @Delete(':id/relationships/:relationshipId')
  @HttpCode(204)
  @RequirePermission(P.CLIENT_UPDATE)
  removeRelationship(
    @Param('id', uuid()) id: string,
    @Param('relationshipId', uuid()) relationshipId: string,
  ): Promise<void> {
    return this.clients.removeRelationship(id, relationshipId);
  }
}

/** Timeline entries. Access follows the lead/client they belong to (checked in the service). */
@ApiTags('activities')
@TenantScoped()
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly timeline: TimelineService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(activityListQuerySchema)) q: ActivityListQuery,
  ): Promise<Paginated<ActivityResponse>> {
    return this.timeline.listActivities(q);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createActivitySchema)) body: CreateActivityInput,
  ): Promise<ActivityResponse> {
    return this.timeline.createActivity(body);
  }
}

@ApiTags('appointments')
@TenantScoped()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly timeline: TimelineService) {}

  @Get()
  @RequirePermission(P.APPOINTMENT_READ)
  list(
    @Query(new ZodValidationPipe(appointmentListQuerySchema)) q: AppointmentListQuery,
  ): Promise<AppointmentResponse[]> {
    return this.timeline.listAppointments(q);
  }

  @Post()
  @RequirePermission(P.APPOINTMENT_MANAGE)
  create(
    @Body(new ZodValidationPipe(createAppointmentSchema)) body: CreateAppointmentInput,
  ): Promise<AppointmentResponse> {
    return this.timeline.createAppointment(body);
  }

  @Patch(':id')
  @RequirePermission(P.APPOINTMENT_MANAGE)
  update(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(updateAppointmentSchema)) body: UpdateAppointmentInput,
  ): Promise<AppointmentResponse> {
    return this.timeline.updateAppointment(id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(P.APPOINTMENT_MANAGE)
  cancel(@Param('id', uuid()) id: string): Promise<AppointmentResponse> {
    return this.timeline.cancelAppointment(id);
  }
}
