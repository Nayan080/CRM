import { Inject, Injectable } from '@nestjs/common';
import type {
  AcceptInvitationNewUserInput,
  CreateInvitationInput,
  InvitationPreviewResponse,
  InvitationSummary,
  WorkspaceSummary,
} from '@crm/contracts';
import { PERMISSIONS, canGrantRole, scopeFor } from '@crm/permissions';
import { requireTenantContext, requireUserId } from '../../common/context/request-context.js';
import { assertStaffSeatAvailable } from '../../common/data/plan-limits.js';
import { AppException } from '../../common/errors/app-exception.js';
import { hashPassword } from '../../common/security/password.js';
import { generateToken, hashToken } from '../../common/security/tokens.js';
import { invitationMessage } from '../../infra/mail/email-templates.js';
import { MAILER, type Mailer } from '../../infra/mail/mailer.js';
import { PrismaService, setRlsTenant, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { type AuthenticatedResult, AuthService } from '../auth/auth.service.js';
import { requireBranches } from '../members/members.service.js';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // DEC-05

const invitationSelect = {
  id: true,
  tenantId: true,
  email: true,
  kind: true,
  status: true,
  branchIds: true,
  expiresAt: true,
  createdAt: true,
  role: { select: { id: true, key: true, name: true, requiresMfa: true } },
} as const;

type InvitationRow = {
  id: string;
  email: string;
  kind: 'STAFF' | 'EXTERNAL';
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  branchIds: string[];
  expiresAt: Date;
  createdAt: Date;
  role: { key: string; name: string; requiresMfa: boolean } | null;
};

function effectiveStatus(i: { status: InvitationRow['status']; expiresAt: Date }) {
  return i.status === 'PENDING' && i.expiresAt <= new Date() ? 'EXPIRED' : i.status;
}

function toSummary(i: InvitationRow): InvitationSummary {
  return {
    id: i.id,
    email: i.email,
    kind: i.kind,
    role: i.role ? { key: i.role.key, name: i.role.name, requiresMfa: i.role.requiresMfa } : null,
    status: effectiveStatus(i),
    branchIds: i.branchIds,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

const notFound = () => new AppException(404, 'NOT_FOUND', 'Invitation not found.');
const invalidInvite = () =>
  new AppException(404, 'INVITATION_INVALID', 'This invitation is invalid, used or expired.');

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async create(input: CreateInvitationInput): Promise<InvitationSummary> {
    const ctx = requireTenantContext();
    const token = generateToken();
    const { summary, mail } = await this.prisma.tenantTx(async (tx) => {
      let roleId: string | null = null;
      if (input.kind === 'STAFF') {
        const role = await tx.role.findUnique({
          where: { tenantId_key: { tenantId: ctx.tenantId, key: input.roleKey } },
          select: { id: true, permissions: { select: { permission: true, scope: true } } },
        });
        if (!role) {
          throw new AppException(400, 'UNKNOWN_ROLE', 'Unknown role.', [
            { path: 'roleKey', message: 'Unknown role' },
          ]);
        }
        // No privilege escalation: you can only invite into roles you could hold yourself.
        if (!canGrantRole(ctx.grants, role.permissions)) {
          throw new AppException(
            403,
            'ROLE_ESCALATION',
            'You cannot invite someone into a role above your own.',
          );
        }
        roleId = role.id;
      }

      const branchIds =
        input.kind === 'STAFF' ? await requireBranches(tx, input.branchIds ?? [], true) : [];
      // Branch-scoped inviters (e.g. Branch Manager) may only invite staff into their own branches.
      if (
        scopeFor(ctx.grants, PERMISSIONS.MEMBER_INVITE) !== 'TENANT' &&
        !this.canManage(branchIds)
      ) {
        throw new AppException(
          403,
          'PERMISSION_DENIED',
          'You can only invite team members into your own branches.',
        );
      }

      const existingMember = await tx.membership.findFirst({
        where: { user: { email: input.email }, status: { in: ['ACTIVE', 'SUSPENDED'] } },
        select: { id: true },
      });
      if (existingMember) {
        throw new AppException(409, 'ALREADY_MEMBER', 'This person is already a member.');
      }

      const pending = await tx.invitation.findFirst({
        where: { email: input.email, status: 'PENDING' },
        select: { id: true, expiresAt: true },
      });
      if (pending && pending.expiresAt > new Date()) {
        throw new AppException(
          409,
          'INVITE_ALREADY_PENDING',
          'An invitation is already pending for this email. Resend it instead.',
        );
      }
      if (pending) {
        await tx.invitation.update({ where: { id: pending.id }, data: { status: 'EXPIRED' } });
      }
      if (input.kind === 'STAFF') {
        await assertStaffSeatAvailable(tx, ctx.tenantId, { includePending: true });
      }

      const invitation = await tx.invitation.create({
        data: {
          tenantId: ctx.tenantId,
          email: input.email,
          kind: input.kind,
          roleId,
          branchIds,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          invitedByMembershipId: ctx.membershipId,
        },
        select: invitationSelect,
      });
      await this.audit.record(tx, {
        action: 'member.invited',
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: { kind: input.kind, role: invitation.role?.key ?? null },
      });
      return { summary: toSummary(invitation), mail: await this.buildMail(tx, invitation, token) };
    });
    await this.mailer.send(mail);
    return summary;
  }

  /** TENANT scope sees every invitation; BRANCH scope only those for its own branches. */
  async list(): Promise<InvitationSummary[]> {
    const ctx = requireTenantContext();
    const scope = scopeFor(ctx.grants, PERMISSIONS.MEMBER_INVITE);
    const rows = await this.prisma.tenantTx((tx) =>
      tx.invitation.findMany({
        where: {
          status: { in: ['PENDING', 'EXPIRED'] },
          ...(scope === 'TENANT' ? {} : { branchIds: { hasSome: ctx.branchIds } }),
        },
        orderBy: { createdAt: 'desc' },
        select: invitationSelect,
      }),
    );
    return rows.map(toSummary);
  }

  /** New token + new 7-day expiry. The old link stops working. */
  async resend(id: string): Promise<InvitationSummary> {
    const token = generateToken();
    const { summary, mail } = await this.prisma.tenantTx(async (tx) => {
      const current = await tx.invitation.findUnique({
        where: { id },
        select: { status: true, branchIds: true, kind: true },
      });
      if (!current || !this.canManage(current.branchIds)) throw notFound();
      if (current.status !== 'PENDING' && current.status !== 'EXPIRED') {
        throw new AppException(
          409,
          'INVITATION_CLOSED',
          'This invitation was already used or cancelled.',
        );
      }
      if (current.kind === 'STAFF') {
        await assertStaffSeatAvailable(tx, requireTenantContext().tenantId, {
          includePending: true,
          excludeInvitationId: id,
        });
      }
      const invitation = await tx.invitation.update({
        where: { id },
        data: {
          tokenHash: hashToken(token),
          status: 'PENDING',
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
        select: invitationSelect,
      });
      await this.audit.record(tx, {
        action: 'invitation.resent',
        targetType: 'invitation',
        targetId: id,
      });
      return { summary: toSummary(invitation), mail: await this.buildMail(tx, invitation, token) };
    });
    await this.mailer.send(mail);
    return summary;
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.tenantTx(async (tx) => {
      const current = await tx.invitation.findUnique({
        where: { id },
        select: { status: true, branchIds: true },
      });
      if (!current || !this.canManage(current.branchIds)) throw notFound();
      if (current.status !== 'PENDING' && current.status !== 'EXPIRED') {
        throw new AppException(
          409,
          'INVITATION_CLOSED',
          'This invitation was already used or cancelled.',
        );
      }
      await tx.invitation.update({
        where: { id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'invitation.revoked',
        targetType: 'invitation',
        targetId: id,
      });
    });
  }

  /** TENANT scope manages every invitation; BRANCH scope only those entirely inside own branches. */
  private canManage(branchIds: string[]): boolean {
    const ctx = requireTenantContext();
    const scope = scopeFor(ctx.grants, PERMISSIONS.MEMBER_INVITE);
    if (scope === 'TENANT') return true;
    return (
      scope === 'BRANCH' &&
      branchIds.length > 0 &&
      branchIds.every((branchId) => ctx.branchIds.includes(branchId))
    );
  }

  /** Public: what the invite page shows. Only the holder of the token can see this invitation. */
  async preview(token: string): Promise<InvitationPreviewResponse> {
    const tokenHash = hashToken(token);
    return this.prisma.systemTx({ inviteTokenHash: tokenHash }, async (tx) => {
      const invitation = await this.findValidByToken(tx, tokenHash);
      const accountExists = (await tx.user.count({ where: { email: invitation.email } })) > 0;
      return {
        tenantName: invitation.tenant.name,
        email: invitation.email,
        kind: invitation.kind,
        role: invitation.role
          ? {
              key: invitation.role.key,
              name: invitation.role.name,
              requiresMfa: invitation.role.requiresMfa,
            }
          : null,
        expiresAt: invitation.expiresAt.toISOString(),
        accountExists,
      };
    });
  }

  /** Signed-in user accepts. Their verified email must match the invited email. */
  async accept(token: string): Promise<WorkspaceSummary> {
    const userId = requireUserId();
    const tokenHash = hashToken(token);
    return this.prisma.systemTx({ userId, inviteTokenHash: tokenHash }, async (tx) => {
      const invitation = await this.findValidByToken(tx, tokenHash);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, emailVerifiedAt: true, mfaEnabledAt: true },
      });
      if (!user.emailVerifiedAt || user.email !== invitation.email) {
        throw new AppException(
          403,
          'INVITATION_EMAIL_MISMATCH',
          'This invitation was sent to a different email address. Sign in with that account.',
        );
      }
      await this.joinTenant(tx, invitation, userId);
      return {
        tenantId: invitation.tenantId,
        slug: invitation.tenant.slug,
        name: invitation.tenant.name,
        kind: invitation.kind,
        role: invitation.role
          ? {
              key: invitation.role.key,
              name: invitation.role.name,
              requiresMfa: invitation.role.requiresMfa,
            }
          : null,
        mfaSetupRequired: !!invitation.role?.requiresMfa && !user.mfaEnabledAt,
        status: 'ACTIVE',
      };
    });
  }

  /**
   * New person accepts: account is created already verified (receiving the invitation email proves
   * control of the address) and signed in.
   */
  async acceptAsNewUser(input: AcceptInvitationNewUserInput): Promise<AuthenticatedResult> {
    const tokenHash = hashToken(input.token);
    const passwordHash = await hashPassword(input.password);
    const userId = await this.prisma.systemTx({ inviteTokenHash: tokenHash }, async (tx) => {
      const invitation = await this.findValidByToken(tx, tokenHash);
      const exists = await tx.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      if (exists) {
        throw new AppException(
          409,
          'ACCOUNT_EXISTS',
          'You already have an account. Sign in to accept.',
        );
      }
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          name: input.name,
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });
      await this.joinTenant(tx, invitation, user.id);
      return user.id;
    });
    return this.auth.startSession(userId, false, 'auth.login_after_invite');
  }

  /**
   * RLS lets the token holder see only this invitation row. Its tenant is then made the active RLS
   * tenant for the rest of the transaction, so the related role is readable (and nothing else).
   */
  private async findValidByToken(tx: Tx, tokenHash: string) {
    const located = await tx.invitation.findUnique({
      where: { tokenHash },
      select: { tenantId: true },
    });
    if (!located) throw invalidInvite();
    await setRlsTenant(tx, located.tenantId);
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash },
      select: {
        ...invitationSelect,
        tenant: { select: { name: true, slug: true, status: true } },
      },
    });
    if (
      !invitation ||
      invitation.status !== 'PENDING' ||
      invitation.expiresAt <= new Date() ||
      invitation.tenant.status !== 'ACTIVE'
    ) {
      throw invalidInvite();
    }
    return invitation;
  }

  /** Creates (or re-activates) the membership and closes the invitation — race-safe. */
  private async joinTenant(
    tx: Tx,
    invitation: {
      id: string;
      tenantId: string;
      kind: 'STAFF' | 'EXTERNAL';
      branchIds: string[];
      role: { id: string } | null;
    },
    userId: string,
  ): Promise<void> {
    await setRlsTenant(tx, invitation.tenantId);
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, tenantId: invitation.tenantId, status: 'PENDING' },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: userId },
    });
    if (claimed.count !== 1) throw invalidInvite();
    if (invitation.kind === 'STAFF') {
      // This invitation's own reserved seat is the one being used.
      await assertStaffSeatAvailable(tx, invitation.tenantId, {
        includePending: true,
        excludeInvitationId: invitation.id,
      });
    }

    const existing = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== 'REMOVED') {
      throw new AppException(409, 'ALREADY_MEMBER', 'You are already a member of this workspace.');
    }
    const data = {
      kind: invitation.kind,
      roleId: invitation.kind === 'EXTERNAL' ? null : (invitation.role?.id ?? null),
      status: 'ACTIVE' as const,
    };
    const membership = existing
      ? await tx.membership.update({
          where: { id: existing.id },
          data: { ...data, removedAt: null, joinedAt: new Date() },
        })
      : await tx.membership.create({ data: { ...data, tenantId: invitation.tenantId, userId } });

    // Branch assignment from the invitation (only branches that still exist and are active).
    await tx.membershipBranch.deleteMany({
      where: { tenantId: invitation.tenantId, membershipId: membership.id },
    });
    if (invitation.kind === 'STAFF' && invitation.branchIds.length > 0) {
      const branches = await tx.branch.findMany({
        where: { tenantId: invitation.tenantId, id: { in: invitation.branchIds }, isActive: true },
        select: { id: true },
      });
      if (branches.length > 0) {
        await tx.membershipBranch.createMany({
          data: branches.map((branch) => ({
            tenantId: invitation.tenantId,
            membershipId: membership.id,
            branchId: branch.id,
          })),
        });
      }
    }

    await this.audit.record(tx, {
      action: 'invitation.accepted',
      tenantId: invitation.tenantId,
      actorUserId: userId,
      targetType: 'membership',
      targetId: membership.id,
      metadata: { invitationId: invitation.id, kind: invitation.kind },
    });
  }

  private async buildMail(
    tx: Tx,
    invitation: { email: string; kind: 'STAFF' | 'EXTERNAL'; tenantId: string },
    token: string,
  ) {
    const ctx = requireTenantContext();
    const [tenant, inviter] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: invitation.tenantId }, select: { name: true } }),
      tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } }),
    ]);
    return invitationMessage(
      invitation.email,
      tenant.name,
      inviter.name,
      invitation.kind,
      this.auth.link('/invite', token),
    );
  }
}
