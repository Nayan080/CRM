import { Injectable } from '@nestjs/common';
import type {
  CreatePartnerContactInput,
  CreatePartnerInput,
  ListQuery,
  Paginated,
  PartnerContactResponse,
  PartnerDetail,
  PartnerSummary,
  UpdatePartnerContactInput,
  UpdatePartnerInput,
} from '@crm/contracts';
import { requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { contains, pageArgs, toPage } from '../../common/pagination/pagination.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { requireReferenceOption } from '../reference/reference.service.js';

const contactSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  position: true,
} as const;

const summarySelect = {
  id: true,
  name: true,
  website: true,
  email: true,
  phone: true,
  type: { select: { id: true, name: true } },
  _count: { select: { contacts: { where: { deletedAt: null } } } },
} as const;

type SummaryRow = Omit<PartnerSummary, 'contactCount'> & { _count: { contacts: number } };

function toSummary({ _count, ...partner }: SummaryRow): PartnerSummary {
  return { ...partner, contactCount: _count.contacts };
}

const notFound = () => new AppException(404, 'NOT_FOUND', 'Partner organization not found.');
const contactNotFound = () => new AppException(404, 'NOT_FOUND', 'Contact not found.');

/**
 * Partner organizations and their contacts. A directory only: listing a partner here never gives
 * that partner any access to the agency's data (product brief §2.2 C).
 */
@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListQuery): Promise<Paginated<PartnerSummary>> {
    const rows = await this.prisma.tenantTx((tx) =>
      tx.partnerOrganization.findMany({
        where: { deletedAt: null, ...(query.q ? { name: contains(query.q) } : {}) },
        select: summarySelect,
        ...pageArgs(query),
      }),
    );
    return toPage(rows, query.limit, toSummary);
  }

  async get(id: string): Promise<PartnerDetail> {
    const partner = await this.prisma.tenantTx((tx) =>
      tx.partnerOrganization.findFirst({
        where: { id, deletedAt: null },
        select: {
          ...summarySelect,
          notes: true,
          contacts: {
            where: { deletedAt: null },
            orderBy: { fullName: 'asc' },
            select: contactSelect,
          },
        },
      }),
    );
    if (!partner) throw notFound();
    const { notes, contacts, ...summary } = partner;
    return { ...toSummary(summary), notes, contacts };
  }

  async create(input: CreatePartnerInput): Promise<PartnerSummary> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await requireReferenceOption(tx, input.typeId, 'PARTNER_TYPE', 'typeId');
      const partner = await tx.partnerOrganization.create({
        data: { ...input, tenantId: ctx.tenantId, createdByMembershipId: ctx.membershipId },
        select: summarySelect,
      });
      await this.audit.record(tx, {
        action: 'partner.created',
        targetType: 'partner_organization',
        targetId: partner.id,
      });
      return toSummary(partner);
    });
  }

  async update(id: string, input: UpdatePartnerInput): Promise<PartnerSummary> {
    return this.prisma.tenantTx(async (tx) => {
      await this.requirePartner(tx, id);
      if (input.typeId) await requireReferenceOption(tx, input.typeId, 'PARTNER_TYPE', 'typeId');
      const partner = await tx.partnerOrganization.update({
        where: { id },
        data: input,
        select: summarySelect,
      });
      await this.audit.record(tx, {
        action: 'partner.updated',
        targetType: 'partner_organization',
        targetId: id,
      });
      return toSummary(partner);
    });
  }

  /** Archive (soft delete). Records stay for history and attribution. */
  async archive(id: string): Promise<void> {
    await this.prisma.tenantTx(async (tx) => {
      await this.requirePartner(tx, id);
      const now = new Date();
      await tx.partnerOrganization.update({ where: { id }, data: { deletedAt: now } });
      await tx.partnerContact.updateMany({
        where: { partnerOrgId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      await this.audit.record(tx, {
        action: 'partner.archived',
        targetType: 'partner_organization',
        targetId: id,
      });
    });
  }

  async addContact(
    partnerId: string,
    input: CreatePartnerContactInput,
  ): Promise<PartnerContactResponse> {
    const { tenantId } = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requirePartner(tx, partnerId);
      const contact = await tx.partnerContact.create({
        data: { ...input, tenantId, partnerOrgId: partnerId },
        select: contactSelect,
      });
      await this.audit.record(tx, {
        action: 'partner_contact.created',
        targetType: 'partner_contact',
        targetId: contact.id,
      });
      return contact;
    });
  }

  async updateContact(
    partnerId: string,
    contactId: string,
    input: UpdatePartnerContactInput,
  ): Promise<PartnerContactResponse> {
    return this.prisma.tenantTx(async (tx) => {
      await this.requireContact(tx, partnerId, contactId);
      const contact = await tx.partnerContact.update({
        where: { id: contactId },
        data: input,
        select: contactSelect,
      });
      await this.audit.record(tx, {
        action: 'partner_contact.updated',
        targetType: 'partner_contact',
        targetId: contactId,
      });
      return contact;
    });
  }

  async archiveContact(partnerId: string, contactId: string): Promise<void> {
    await this.prisma.tenantTx(async (tx) => {
      await this.requireContact(tx, partnerId, contactId);
      await tx.partnerContact.update({ where: { id: contactId }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'partner_contact.archived',
        targetType: 'partner_contact',
        targetId: contactId,
      });
    });
  }

  private async requirePartner(tx: Tx, id: string) {
    const partner = await tx.partnerOrganization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!partner) throw notFound();
  }

  private async requireContact(tx: Tx, partnerId: string, contactId: string) {
    const contact = await tx.partnerContact.findFirst({
      where: {
        id: contactId,
        partnerOrgId: partnerId,
        deletedAt: null,
        partnerOrg: { deletedAt: null },
      },
      select: { id: true },
    });
    if (!contact) throw contactNotFound();
  }
}
