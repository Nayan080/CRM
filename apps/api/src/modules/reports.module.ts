import { Module } from '@nestjs/common';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';

/** Stage 7: per-agency reports (leads & referrals, matters, workload, documents & sharing). */
@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
