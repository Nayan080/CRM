/**
 * Default values for tenant-configurable lists, taken from the product brief (§2.2).
 * They are only labels for a directory: a profession type never implies legal authority
 * and never grants access. Agencies can rename, add or deactivate them.
 * Keep in sync with the backfills in the Stage 3 and Stage 4 migrations.
 * LEAD_SOURCE: brief §3 (referral source). RELATIONSHIP_TYPE: brief §2.2 D and §5.3.
 * PARTICIPANT_ROLE (Stage 5): roles named in brief §2.2 / §3 (dependants, sponsors, employers,
 * external lawyers, accountants, referral partners).
 * DOCUMENT_CATEGORY (Stage 6): plain filing labels only; they carry no legal meaning.
 */
export const REFERENCE_CATEGORIES = [
  'PROFESSION_TYPE',
  'PARTNER_TYPE',
  'LEAD_SOURCE',
  'RELATIONSHIP_TYPE',
  'PARTICIPANT_ROLE',
  'DOCUMENT_CATEGORY',
] as const;
export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];

export interface ReferenceDefault {
  key: string;
  name: string;
  sortOrder: number;
}

export const DEFAULT_REFERENCE_OPTIONS: Record<ReferenceCategory, readonly ReferenceDefault[]> = {
  PROFESSION_TYPE: [
    { key: 'migration_agent', name: 'Migration Agent', sortOrder: 1 },
    { key: 'migration_lawyer', name: 'Migration Lawyer', sortOrder: 2 },
    { key: 'legal_consultant', name: 'Legal Consultant', sortOrder: 3 },
    { key: 'accountant', name: 'CA / Accountant', sortOrder: 4 },
    { key: 'broker', name: 'Broker', sortOrder: 5 },
    { key: 'education_consultant', name: 'Education Consultant', sortOrder: 6 },
    { key: 'other', name: 'Other', sortOrder: 99 },
  ],
  PARTNER_TYPE: [
    { key: 'referral_agency', name: 'Referral Agency', sortOrder: 1 },
    { key: 'accounting_firm', name: 'Accounting Firm', sortOrder: 2 },
    { key: 'education_agency', name: 'Education Agency', sortOrder: 3 },
    { key: 'law_firm', name: 'Law Firm', sortOrder: 4 },
    { key: 'recruitment_agency', name: 'Recruitment Agency', sortOrder: 5 },
    { key: 'employer_sponsor', name: 'Employer / Sponsor', sortOrder: 6 },
    { key: 'other', name: 'Other', sortOrder: 99 },
  ],
  LEAD_SOURCE: [
    { key: 'referral', name: 'Referral', sortOrder: 1 },
    { key: 'other', name: 'Other', sortOrder: 99 },
  ],
  RELATIONSHIP_TYPE: [
    { key: 'family_member', name: 'Family member', sortOrder: 1 },
    { key: 'dependant', name: 'Dependant', sortOrder: 2 },
    { key: 'business_contact', name: 'Business contact', sortOrder: 3 },
    { key: 'other', name: 'Other', sortOrder: 99 },
  ],
  PARTICIPANT_ROLE: [
    { key: 'dependant', name: 'Dependant', sortOrder: 1 },
    { key: 'sponsor', name: 'Sponsor', sortOrder: 2 },
    { key: 'employer', name: 'Employer', sortOrder: 3 },
    { key: 'external_lawyer', name: 'External legal consultant', sortOrder: 4 },
    { key: 'accountant', name: 'CA / Accountant', sortOrder: 5 },
    { key: 'referral_partner', name: 'Referral partner', sortOrder: 6 },
    { key: 'other', name: 'Other', sortOrder: 99 },
  ],
  DOCUMENT_CATEGORY: [
    { key: 'identity', name: 'Identity', sortOrder: 1 },
    { key: 'financial', name: 'Financial', sortOrder: 2 },
    { key: 'education', name: 'Education', sortOrder: 3 },
    { key: 'employment', name: 'Employment', sortOrder: 4 },
    { key: 'relationship', name: 'Relationship', sortOrder: 5 },
    { key: 'correspondence', name: 'Correspondence', sortOrder: 6 },
    { key: 'other', name: 'Other', sortOrder: 99 },
  ],
};
