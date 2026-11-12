import { Injectable } from '@nestjs/common';
import type {
  CreateCredentialInput,
  CreateProfessionalInput,
  CredentialResponse,
  ListQuery,
  Paginated,
  ProfessionalDetail,
  ProfessionalSummary,
  UpdateCredentialInput,
  UpdateProfessionalInput,
  VerifyCredentialInput,
} from '@crm/contracts';
import { requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { contains, pageArgs, toPage } from '../../common/pagination/pagination.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { requireReferenceOption } from '../reference/reference.service.js';

const credentialSelect = {
  id: true,
  credentialType: true,
  issuer: true,
  identifier: true,
  issuedOn: true,
  expiresOn: true,
  status: true,
  verifiedAt: true,
  verificationNote: true,
} as const;

interface CredentialRow {
  id: string;
  credentialType: string;
  issuer: string;
  identifier: string;
  issuedOn: Date | null;
  expiresOn: Date | null;
  status: CredentialResponse['status'];
  verifiedAt: Date | null;
  verificationNote: string | null;
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (d: string | null | undefined) =>
  d === undefined ? undefined : d === null ? null : new Date(`${d}T00:00:00.000Z`);

export function toCredential(c: CredentialRow, today = new Date()): CredentialResponse {
  const expiresOn = isoDate(c.expiresOn);
  return {
    id: c.id,
    credentialType: c.credentialType,
    issuer: c.issuer,
    identifier: c.identifier,
    issuedOn: isoDate(c.issuedOn),
    expiresOn,
    status: c.status,
    // Derived, never stored: a "verified" credential past its expiry date is still shown as expired.
    isExpired: expiresOn !== null && expiresOn < today.toISOString().slice(0, 10),
    verifiedAt: c.verifiedAt?.toISOString() ?? null,
    verificationNote: c.verificationNote,
  };
}

const summarySelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  organizationName: true,
  professionType: { select: { id: true, name: true } },
  partnerOrg: { select: { id: true, name: true } },
  _count: { select: { credentials: true } },
} as const;

type SummaryRow = Omit<ProfessionalSummary, 'credentialCount'> & {
  _count: { credentials: number };
};

function toSummary({ _count, ...profile }: SummaryRow): ProfessionalSummary {
  return { ...profile, credentialCount: _count.credentials };
}

const notFound = () => new AppException(404, 'NOT_FOUND', 'Professional not found.');
const credentialNotFound = () => new AppException(404, 'NOT_FOUND', 'Credential not found.');

/**
 * Professional directory. A profile describes a person; it is not a login, grants no access and
 * does not assert that the person is authorized to give migration or legal advice (brief §2.1).
 */
@Injectable()
export class ProfessionalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListQuery): Promise<Paginated<ProfessionalSummary>> {
    const q = query.q;
    const rows = await this.prisma.tenantTx((tx) =>
      tx.professionalProfile.findMany({
        where: {
          deletedAt: null,
          ...(q
            ? {
                OR: [
                  { fullName: contains(q) },
                  { organizationName: contains(q) },
                  { email: contains(q) },
                ],
              }
            : {}),
        },
        select: summarySelect,
        ...pageArgs(query),
      }),
    );
    return toPage(rows, query.limit, toSummary);
  }

  async get(id: string): Promise<ProfessionalDetail> {
    const profile = await this.prisma.tenantTx((tx) =>
      tx.professionalProfile.findFirst({
        where: { id, deletedAt: null },
        select: {
          ...summarySelect,
          notes: true,
          credentials: { orderBy: { createdAt: 'asc' }, select: credentialSelect },
        },
      }),
    );
    if (!profile) throw notFound();
    const { notes, credentials, ...summary } = profile;
    return { ...toSummary(summary), notes, credentials: credentials.map((c) => toCredential(c)) };
  }

  async create(input: CreateProfessionalInput): Promise<ProfessionalSummary> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.validateLinks(tx, input);
      const profile = await tx.professionalProfile.create({
        data: { ...input, tenantId: ctx.tenantId, createdByMembershipId: ctx.membershipId },
        select: summarySelect,
      });
      await this.audit.record(tx, {
        action: 'professional.created',
        targetType: 'professional_profile',
        targetId: profile.id,
      });
      return toSummary(profile);
    });
  }

  async update(id: string, input: UpdateProfessionalInput): Promise<ProfessionalSummary> {
    return this.prisma.tenantTx(async (tx) => {
      await this.requireProfile(tx, id);
      await this.validateLinks(tx, input);
      const profile = await tx.professionalProfile.update({
        where: { id },
        data: input,
        select: summarySelect,
      });
      await this.audit.record(tx, {
        action: 'professional.updated',
        targetType: 'professional_profile',
        targetId: id,
      });
      return toSummary(profile);
    });
  }

  async archive(id: string): Promise<void> {
    await this.prisma.tenantTx(async (tx) => {
      await this.requireProfile(tx, id);
      await tx.professionalProfile.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'professional.archived',
        targetType: 'professional_profile',
        targetId: id,
      });
    });
  }

  async addCredential(
    profileId: string,
    input: CreateCredentialInput,
  ): Promise<CredentialResponse> {
    const { tenantId } = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireProfile(tx, profileId);
      const credential = await tx.credential.create({
        data: {
          tenantId,
          profileId,
          credentialType: input.credentialType,
          issuer: input.issuer,
          identifier: input.identifier,
          issuedOn: toDate(input.issuedOn) ?? null,
          expiresOn: toDate(input.expiresOn) ?? null,
        },
        select: credentialSelect,
      });
      await this.audit.record(tx, {
        action: 'credential.created',
        targetType: 'credential',
        targetId: credential.id,
      });
      return toCredential(credential);
    });
  }

  /**
   * Editing the facts of a credential (type, issuer, number, dates) resets it to UNVERIFIED:
   * an earlier verification was about the old details.
   */
  async updateCredential(
    profileId: string,
    credentialId: string,
    input: UpdateCredentialInput,
  ): Promise<CredentialResponse> {
    return this.prisma.tenantTx(async (tx) => {
      const current = await this.requireCredential(tx, profileId, credentialId);
      const issuedOn = toDate(input.issuedOn);
      const expiresOn = toDate(input.expiresOn);
      const effectiveIssued = issuedOn === undefined ? current.issuedOn : issuedOn;
      const effectiveExpires = expiresOn === undefined ? current.expiresOn : expiresOn;
      if (effectiveIssued && effectiveExpires && effectiveExpires < effectiveIssued) {
        throw new AppException(400, 'VALIDATION_FAILED', 'Request validation failed', [
          { path: 'expiresOn', message: 'Expiry date must be after the issue date' },
        ]);
      }
      const wasChecked = current.status !== 'UNVERIFIED';
      const credential = await tx.credential.update({
        where: { id: credentialId },
        data: {
          credentialType: input.credentialType,
          issuer: input.issuer,
          identifier: input.identifier,
          issuedOn,
          expiresOn,
          status: 'UNVERIFIED',
          verifiedAt: null,
          verifiedByMembershipId: null,
          verificationNote: null,
        },
        select: credentialSelect,
      });
      await this.audit.record(tx, {
        action: 'credential.updated',
        targetType: 'credential',
        targetId: credentialId,
        metadata: { verificationReset: wasChecked },
      });
      return toCredential(credential);
    });
  }

  /** Records a person's verification decision. The system never verifies anything by itself. */
  async verifyCredential(
    profileId: string,
    credentialId: string,
    input: VerifyCredentialInput,
  ): Promise<CredentialResponse> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      const current = await this.requireCredential(tx, profileId, credentialId);
      const decided = input.status === 'VERIFIED' || input.status === 'REJECTED';
      const credential = await tx.credential.update({
        where: { id: credentialId },
        data: {
          status: input.status,
          verifiedAt: decided ? new Date() : null,
          verifiedByMembershipId: decided ? ctx.membershipId : null,
          verificationNote: input.note ?? null,
        },
        select: credentialSelect,
      });
      await this.audit.record(tx, {
        action: 'credential.verification_changed',
        targetType: 'credential',
        targetId: credentialId,
        metadata: { from: current.status, to: input.status },
      });
      return toCredential(credential);
    });
  }

  async removeCredential(profileId: string, credentialId: string): Promise<void> {
    await this.prisma.tenantTx(async (tx) => {
      await this.requireCredential(tx, profileId, credentialId);
      await tx.credential.delete({ where: { id: credentialId } });
      await this.audit.record(tx, {
        action: 'credential.deleted',
        targetType: 'credential',
        targetId: credentialId,
      });
    });
  }

  private async validateLinks(
    tx: Tx,
    input: { professionTypeId?: string; partnerOrgId?: string | null },
  ): Promise<void> {
    if (input.professionTypeId) {
      await requireReferenceOption(
        tx,
        input.professionTypeId,
        'PROFESSION_TYPE',
        'professionTypeId',
      );
    }
    if (input.partnerOrgId) {
      const partner = await tx.partnerOrganization.findFirst({
        where: { id: input.partnerOrgId, deletedAt: null },
        select: { id: true },
      });
      if (!partner) {
        throw new AppException(
          400,
          'INVALID_REFERENCE',
          'Choose an existing partner organization.',
          [{ path: 'partnerOrgId', message: 'Partner organization not found' }],
        );
      }
    }
  }

  private async requireProfile(tx: Tx, id: string): Promise<void> {
    const profile = await tx.professionalProfile.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!profile) throw notFound();
  }

  private async requireCredential(tx: Tx, profileId: string, credentialId: string) {
    const credential = await tx.credential.findFirst({
      where: { id: credentialId, profileId, profile: { deletedAt: null } },
      select: { status: true, issuedOn: true, expiresOn: true },
    });
    if (!credential) throw credentialNotFound();
    return credential;
  }
}
