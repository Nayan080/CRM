import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import {
  deadlineReminderMessage,
  deadlineRuleReminderMessage,
  leadFollowUpMessage,
} from '../../infra/mail/email-templates.js';
import { MAILER, type Mailer } from '../../infra/mail/mailer.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const INTERVAL_MS = 60_000;
const DAY = 86_400_000;
type Tenant = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  deadlineReminderDays: number[];
  leadFollowUpDays: number | null;
};

function formatInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
const BATCH = 50;

/**
 * Deadline reminder emails to the staff assigned to the matter.
 * Each run claims due reminders with one UPDATE … RETURNING per workspace, so several API instances
 * never send the same reminder twice. Claim + send share one transaction: if sending fails, the
 * claim rolls back and the next run retries. Runs per workspace with that workspace's RLS context.
 * (A job queue such as pg-boss can replace this timer when there are more background jobs.)
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return; // tests call runOnce() directly
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.log.warn(`Reminder run failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Processes everything due at `now`. `onlyTenantId` limits the run to one agency (tests, support). */
  async runOnce(now = new Date(), onlyTenantId?: string): Promise<number> {
    const tenants = await this.prisma.systemTx({}, (tx) =>
      tx.tenant.findMany({
        where: { status: 'ACTIVE', ...(onlyTenantId ? { id: onlyTenantId } : {}) },
        select: {
          id: true,
          slug: true,
          name: true,
          timezone: true,
          deadlineReminderDays: true,
          leadFollowUpDays: true,
        },
      }),
    );
    let total = 0;
    for (const tenant of tenants) {
      try {
        total += await this.runForTenant(tenant, now);
      } catch (error) {
        this.log.warn(`Reminders for one workspace failed: ${(error as Error).message}`);
      }
      try {
        // Only agencies that switched the rule on are visited.
        if (tenant.deadlineReminderDays.length) total += await this.runDeadlineRules(tenant, now);
        if (tenant.leadFollowUpDays) total += await this.runLeadNudges(tenant, now);
      } catch (error) {
        this.log.warn(`Automation for one workspace failed: ${(error as Error).message}`);
      }
    }
    return total;
  }

  /**
   * Agency rule "N days before each deadline" (Stage 8). For each open deadline, the reminder
   * offsets now reached but not yet sent are claimed in DeadlineReminderLog (unique per deadline
   * and offset, so several API instances never send twice) and ONE email goes out per person.
   */
  private runDeadlineRules(tenant: Tenant, now: Date): Promise<number> {
    return this.prisma.systemTx({ tenantId: tenant.id }, async (tx) => {
      const offsets = tenant.deadlineReminderDays;
      if (!offsets.length) return 0;
      const horizon = new Date(now.getTime() + Math.max(...offsets) * DAY);
      const deadlines = await tx.matterDeadline.findMany({
        where: {
          tenantId: tenant.id,
          completedAt: null,
          dueAt: { gt: now, lte: horizon },
          matter: { status: { in: ['OPEN', 'ON_HOLD'] } },
        },
        orderBy: { dueAt: 'asc' },
        take: BATCH,
        select: {
          id: true,
          title: true,
          dueAt: true,
          reminderLogs: { select: { offsetDays: true } },
          matter: {
            select: {
              id: true,
              reference: true,
              title: true,
              assignments: {
                where: { unassignedAt: null, membership: { status: 'ACTIVE', kind: 'STAFF' } },
                select: {
                  membership: { select: { user: { select: { email: true, name: true } } } },
                },
              },
            },
          },
        },
      });
      let sent = 0;
      for (const d of deadlines) {
        const left = (d.dueAt.getTime() - now.getTime()) / DAY;
        const sentBefore = new Set(d.reminderLogs.map((l) => l.offsetDays));
        const due = offsets.filter((o) => left <= o && !sentBefore.has(o));
        if (!due.length) continue;
        const claimed = await tx.deadlineReminderLog.createMany({
          data: due.map((offsetDays) => ({ tenantId: tenant.id, deadlineId: d.id, offsetDays })),
          skipDuplicates: true,
        });
        if (!claimed.count) continue;
        for (const a of d.matter.assignments) {
          const user = a.membership.user;
          await this.mailer.send(
            deadlineRuleReminderMessage(user.email, user.name, {
              tenantName: tenant.name,
              matterRef: d.matter.reference,
              matterTitle: d.matter.title,
              deadline: d.title,
              dueAt: formatInZone(d.dueAt, tenant.timezone),
              daysLeft: Math.max(1, Math.ceil(left)),
              link: `${this.config.webAppUrl}/w/${tenant.slug}/matters/${d.matter.id}`,
            }),
          );
        }
        sent += 1;
      }
      return sent;
    });
  }

  /**
   * Agency rule "remind the lead owner after N days without activity" (Stage 8). Last activity =
   * the newest timeline entry, or when the lead was created. One reminder per quiet period: a new
   * activity starts a new period.
   */
  private runLeadNudges(tenant: Tenant, now: Date): Promise<number> {
    return this.prisma.systemTx({ tenantId: tenant.id }, async (tx) => {
      const days = tenant.leadFollowUpDays;
      if (!days) return 0;
      const cutoff = new Date(now.getTime() - days * DAY);
      const leads = await tx.lead.findMany({
        where: {
          tenantId: tenant.id,
          status: 'OPEN',
          deletedAt: null,
          createdAt: { lte: cutoff },
          activities: { none: { occurredAt: { gt: cutoff } } },
          owner: { status: 'ACTIVE', kind: 'STAFF' },
        },
        take: BATCH,
        select: {
          id: true,
          fullName: true,
          createdAt: true,
          followUpNudgedAt: true,
          activities: { orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true } },
          owner: { select: { user: { select: { email: true, name: true } } } },
        },
      });
      let sent = 0;
      for (const lead of leads) {
        const last = lead.activities[0]?.occurredAt ?? lead.createdAt;
        if (lead.followUpNudgedAt && lead.followUpNudgedAt >= last) continue; // already reminded
        // Claim: only succeeds if nobody else reminded in the meantime.
        const claimed = await tx.lead.updateMany({
          where: { id: lead.id, followUpNudgedAt: lead.followUpNudgedAt },
          data: { followUpNudgedAt: now },
        });
        if (!claimed.count || !lead.owner) continue;
        await this.mailer.send(
          leadFollowUpMessage(lead.owner.user.email, lead.owner.user.name, {
            tenantName: tenant.name,
            leadName: lead.fullName,
            days,
            link: `${this.config.webAppUrl}/w/${tenant.slug}/leads/${lead.id}`,
          }),
        );
        sent += 1;
      }
      return sent;
    });
  }

  private runForTenant(tenant: Tenant, now: Date): Promise<number> {
    return this.prisma.systemTx({ tenantId: tenant.id }, async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE matter_deadlines SET reminder_sent_at = ${now}
        WHERE id IN (
          SELECT id FROM matter_deadlines
          WHERE tenant_id = ${tenant.id}::uuid AND remind_at <= ${now}
            AND reminder_sent_at IS NULL AND completed_at IS NULL
          ORDER BY remind_at LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
        RETURNING id`;
      if (!claimed.length) return 0;
      const deadlines = await tx.matterDeadline.findMany({
        where: { tenantId: tenant.id, id: { in: claimed.map((c) => c.id) } },
        select: {
          title: true,
          dueAt: true,
          matter: {
            select: {
              id: true,
              reference: true,
              title: true,
              status: true,
              assignments: {
                where: { unassignedAt: null, membership: { status: 'ACTIVE', kind: 'STAFF' } },
                select: {
                  membership: { select: { user: { select: { email: true, name: true } } } },
                },
              },
            },
          },
        },
      });
      for (const d of deadlines) {
        if (d.matter.status === 'CLOSED' || d.matter.status === 'ARCHIVED') continue;
        for (const a of d.matter.assignments) {
          const user = a.membership.user;
          await this.mailer.send(
            deadlineReminderMessage(user.email, user.name, {
              tenantName: tenant.name,
              matterRef: d.matter.reference,
              matterTitle: d.matter.title,
              deadline: d.title,
              dueAt: formatInZone(d.dueAt, tenant.timezone),
              link: `${this.config.webAppUrl}/w/${tenant.slug}/matters/${d.matter.id}`,
            }),
          );
        }
      }
      return claimed.length;
    });
  }
}
