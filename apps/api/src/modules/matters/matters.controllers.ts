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
import type { ZodType } from 'zod';
import {
  type AddAssignmentInput,
  type CreateChecklistItemInput,
  type CreateChecklistTemplateItemInput,
  type CreateDeadlineInput,
  type CreateMatterInput,
  type CreateMatterTypeInput,
  type CreateParticipantInput,
  type CreateStageInput,
  type CreateStageTaskTemplateInput,
  type CreateTaskInput,
  type MatterDetail,
  type MatterListQuery,
  type MatterSummary,
  type MatterTypeResponse,
  type Paginated,
  type TaskListQuery,
  type TaskResponse,
  type TransitionMatterInput,
  type UpdateChecklistItemInput,
  type UpdateChecklistTemplateItemInput,
  type UpdateDeadlineInput,
  type UpdateMatterInput,
  type UpdateMatterTypeInput,
  type UpdateStageInput,
  type UpdateStageTaskTemplateInput,
  type UpdateTaskInput,
  addAssignmentSchema,
  createChecklistItemSchema,
  createChecklistTemplateItemSchema,
  createDeadlineSchema,
  createMatterSchema,
  createMatterTypeSchema,
  createParticipantSchema,
  createStageSchema,
  createStageTaskTemplateSchema,
  createTaskSchema,
  matterListQuerySchema,
  taskListQuerySchema,
  transitionMatterSchema,
  updateChecklistItemSchema,
  updateChecklistTemplateItemSchema,
  updateDeadlineSchema,
  updateMatterSchema,
  updateMatterTypeSchema,
  updateStageSchema,
  updateStageTaskTemplateSchema,
  updateTaskSchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { MatterTypesService } from './matter-types.service.js';
import { MattersService } from './matters.service.js';
import { TasksService } from './tasks.service.js';

const uuid = () => new ParseUUIDPipe();
const P = PERMISSIONS;
const body = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);

/** Settings: matter types, stages, checklist templates. Reading needs matter:read (to open matters). */
@ApiTags('matter-types')
@TenantScoped()
@Controller('matter-types')
export class MatterTypesController {
  constructor(private readonly types: MatterTypesService) {}

  @Get()
  @RequirePermission(P.MATTER_READ)
  list(): Promise<MatterTypeResponse[]> {
    return this.types.list();
  }

  @Get(':id')
  @RequirePermission(P.MATTER_READ)
  get(@Param('id', uuid()) id: string): Promise<MatterTypeResponse> {
    return this.types.get(id);
  }

  @Post()
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  create(
    @Body(body(createMatterTypeSchema)) b: CreateMatterTypeInput,
  ): Promise<MatterTypeResponse> {
    return this.types.create(b);
  }

  @Patch(':id')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  update(
    @Param('id', uuid()) id: string,
    @Body(body(updateMatterTypeSchema)) b: UpdateMatterTypeInput,
  ): Promise<MatterTypeResponse> {
    return this.types.update(id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  remove(@Param('id', uuid()) id: string): Promise<void> {
    return this.types.remove(id);
  }

  @Post(':id/stages')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  addStage(
    @Param('id', uuid()) id: string,
    @Body(body(createStageSchema)) b: CreateStageInput,
  ): Promise<MatterTypeResponse> {
    return this.types.addStage(id, b);
  }

  @Patch(':id/stages/:stageId')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  updateStage(
    @Param('id', uuid()) id: string,
    @Param('stageId', uuid()) stageId: string,
    @Body(body(updateStageSchema)) b: UpdateStageInput,
  ): Promise<MatterTypeResponse> {
    return this.types.updateStage(id, stageId, b);
  }

  @Delete(':id/stages/:stageId')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  removeStage(
    @Param('id', uuid()) id: string,
    @Param('stageId', uuid()) stageId: string,
  ): Promise<MatterTypeResponse> {
    return this.types.removeStage(id, stageId);
  }

  @Post(':id/checklist')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  addTemplateItem(
    @Param('id', uuid()) id: string,
    @Body(body(createChecklistTemplateItemSchema)) b: CreateChecklistTemplateItemInput,
  ): Promise<MatterTypeResponse> {
    return this.types.addTemplateItem(id, b);
  }

  @Patch(':id/checklist/:itemId')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  updateTemplateItem(
    @Param('id', uuid()) id: string,
    @Param('itemId', uuid()) itemId: string,
    @Body(body(updateChecklistTemplateItemSchema)) b: UpdateChecklistTemplateItemInput,
  ): Promise<MatterTypeResponse> {
    return this.types.updateTemplateItem(id, itemId, b);
  }

  @Delete(':id/checklist/:itemId')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  removeTemplateItem(
    @Param('id', uuid()) id: string,
    @Param('itemId', uuid()) itemId: string,
  ): Promise<MatterTypeResponse> {
    return this.types.removeTemplateItem(id, itemId);
  }

  @Post(':id/stages/:stageId/tasks')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  addStageTask(
    @Param('id', uuid()) id: string,
    @Param('stageId', uuid()) stageId: string,
    @Body(body(createStageTaskTemplateSchema)) b: CreateStageTaskTemplateInput,
  ): Promise<MatterTypeResponse> {
    return this.types.addStageTask(id, stageId, b);
  }

  @Patch(':id/stages/:stageId/tasks/:templateId')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  updateStageTask(
    @Param('id', uuid()) id: string,
    @Param('stageId', uuid()) stageId: string,
    @Param('templateId', uuid()) templateId: string,
    @Body(body(updateStageTaskTemplateSchema)) b: UpdateStageTaskTemplateInput,
  ): Promise<MatterTypeResponse> {
    return this.types.updateStageTask(id, stageId, templateId, b);
  }

  @Delete(':id/stages/:stageId/tasks/:templateId')
  @RequirePermission(P.TENANT_UPDATE, 'TENANT')
  removeStageTask(
    @Param('id', uuid()) id: string,
    @Param('stageId', uuid()) stageId: string,
    @Param('templateId', uuid()) templateId: string,
  ): Promise<MatterTypeResponse> {
    return this.types.removeStageTask(id, stageId, templateId);
  }
}

@ApiTags('matters')
@TenantScoped()
@Controller('matters')
export class MattersController {
  constructor(private readonly matters: MattersService) {}

  @Get()
  @RequirePermission(P.MATTER_READ)
  list(@Query(body(matterListQuerySchema)) q: MatterListQuery): Promise<Paginated<MatterSummary>> {
    return this.matters.list(q);
  }

  @Post()
  @RequirePermission(P.MATTER_CREATE)
  create(@Body(body(createMatterSchema)) b: CreateMatterInput): Promise<MatterDetail> {
    return this.matters.create(b);
  }

  @Get(':id')
  @RequirePermission(P.MATTER_READ)
  get(@Param('id', uuid()) id: string): Promise<MatterDetail> {
    return this.matters.get(id);
  }

  @Patch(':id')
  @RequirePermission(P.MATTER_UPDATE)
  update(
    @Param('id', uuid()) id: string,
    @Body(body(updateMatterSchema)) b: UpdateMatterInput,
  ): Promise<MatterDetail> {
    return this.matters.update(id, b);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequirePermission(P.MATTER_UPDATE)
  transition(
    @Param('id', uuid()) id: string,
    @Body(body(transitionMatterSchema)) b: TransitionMatterInput,
  ): Promise<MatterDetail> {
    return this.matters.transition(id, b);
  }

  @Post(':id/assignments')
  @RequirePermission(P.MATTER_UPDATE)
  addAssignment(
    @Param('id', uuid()) id: string,
    @Body(body(addAssignmentSchema)) b: AddAssignmentInput,
  ): Promise<MatterDetail> {
    return this.matters.addAssignment(id, b);
  }

  @Delete(':id/assignments/:assignmentId')
  @RequirePermission(P.MATTER_UPDATE)
  removeAssignment(
    @Param('id', uuid()) id: string,
    @Param('assignmentId', uuid()) assignmentId: string,
  ): Promise<MatterDetail> {
    return this.matters.removeAssignment(id, assignmentId);
  }

  @Post(':id/participants')
  @RequirePermission(P.MATTER_UPDATE)
  addParticipant(
    @Param('id', uuid()) id: string,
    @Body(body(createParticipantSchema)) b: CreateParticipantInput,
  ): Promise<MatterDetail> {
    return this.matters.addParticipant(id, b);
  }

  @Delete(':id/participants/:participantId')
  @RequirePermission(P.MATTER_UPDATE)
  removeParticipant(
    @Param('id', uuid()) id: string,
    @Param('participantId', uuid()) participantId: string,
  ): Promise<MatterDetail> {
    return this.matters.removeParticipant(id, participantId);
  }

  @Post(':id/deadlines')
  @RequirePermission(P.MATTER_UPDATE)
  addDeadline(
    @Param('id', uuid()) id: string,
    @Body(body(createDeadlineSchema)) b: CreateDeadlineInput,
  ): Promise<MatterDetail> {
    return this.matters.addDeadline(id, b);
  }

  @Patch(':id/deadlines/:deadlineId')
  @RequirePermission(P.MATTER_UPDATE)
  updateDeadline(
    @Param('id', uuid()) id: string,
    @Param('deadlineId', uuid()) deadlineId: string,
    @Body(body(updateDeadlineSchema)) b: UpdateDeadlineInput,
  ): Promise<MatterDetail> {
    return this.matters.updateDeadline(id, deadlineId, b);
  }

  @Delete(':id/deadlines/:deadlineId')
  @RequirePermission(P.MATTER_UPDATE)
  removeDeadline(
    @Param('id', uuid()) id: string,
    @Param('deadlineId', uuid()) deadlineId: string,
  ): Promise<MatterDetail> {
    return this.matters.removeDeadline(id, deadlineId);
  }

  @Post(':id/checklist')
  @RequirePermission(P.MATTER_UPDATE)
  addChecklistItem(
    @Param('id', uuid()) id: string,
    @Body(body(createChecklistItemSchema)) b: CreateChecklistItemInput,
  ): Promise<MatterDetail> {
    return this.matters.addChecklistItem(id, b);
  }

  @Patch(':id/checklist/:itemId')
  @RequirePermission(P.MATTER_UPDATE)
  updateChecklistItem(
    @Param('id', uuid()) id: string,
    @Param('itemId', uuid()) itemId: string,
    @Body(body(updateChecklistItemSchema)) b: UpdateChecklistItemInput,
  ): Promise<MatterDetail> {
    return this.matters.updateChecklistItem(id, itemId, b);
  }

  @Delete(':id/checklist/:itemId')
  @RequirePermission(P.MATTER_UPDATE)
  removeChecklistItem(
    @Param('id', uuid()) id: string,
    @Param('itemId', uuid()) itemId: string,
  ): Promise<MatterDetail> {
    return this.matters.removeChecklistItem(id, itemId);
  }
}

@ApiTags('tasks')
@TenantScoped()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermission(P.TASK_READ)
  list(@Query(body(taskListQuerySchema)) q: TaskListQuery): Promise<Paginated<TaskResponse>> {
    return this.tasks.list(q);
  }

  @Post()
  @RequirePermission(P.TASK_MANAGE)
  create(@Body(body(createTaskSchema)) b: CreateTaskInput): Promise<TaskResponse> {
    return this.tasks.create(b);
  }

  @Patch(':id')
  @RequirePermission(P.TASK_MANAGE)
  update(
    @Param('id', uuid()) id: string,
    @Body(body(updateTaskSchema)) b: UpdateTaskInput,
  ): Promise<TaskResponse> {
    return this.tasks.update(id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(P.TASK_MANAGE)
  remove(@Param('id', uuid()) id: string): Promise<void> {
    return this.tasks.remove(id);
  }
}
