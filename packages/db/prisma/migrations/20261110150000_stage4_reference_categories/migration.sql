-- Stage 4 (part 1 of 2). New configurable list categories.
-- Kept separate because PostgreSQL cannot use a new enum value in the same transaction that adds it.
ALTER TYPE "ReferenceCategory" ADD VALUE 'LEAD_SOURCE';
ALTER TYPE "ReferenceCategory" ADD VALUE 'RELATIONSHIP_TYPE';
