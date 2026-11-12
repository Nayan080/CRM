import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type DocumentsReport,
  type LeadsReport,
  type MattersReport,
  type ReportQuery,
  type WorkloadReport,
  reportQuerySchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { ReportsService } from './reports.service.js';

/** Each report also needs read access to its data and only counts what the caller may see. */
@ApiTags('reports')
@TenantScoped()
@Controller('reports')
@RequirePermission(PERMISSIONS.REPORT_READ)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('leads')
  leads(@Query(new ZodValidationPipe(reportQuerySchema)) q: ReportQuery): Promise<LeadsReport> {
    return this.reports.leads(q);
  }

  @Get('matters')
  matters(@Query(new ZodValidationPipe(reportQuerySchema)) q: ReportQuery): Promise<MattersReport> {
    return this.reports.matters(q);
  }

  @Get('workload')
  workload(): Promise<WorkloadReport> {
    return this.reports.workload();
  }

  @Get('documents')
  documents(
    @Query(new ZodValidationPipe(reportQuerySchema)) q: ReportQuery,
  ): Promise<DocumentsReport> {
    return this.reports.documents(q);
  }
}
