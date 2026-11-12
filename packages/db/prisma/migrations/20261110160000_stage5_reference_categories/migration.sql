-- Stage 5 (part 1 of 2). New configurable list category: roles of people/organizations in a matter.
-- Kept separate because PostgreSQL cannot use a new enum value in the same transaction that adds it.
ALTER TYPE "ReferenceCategory" ADD VALUE 'PARTICIPANT_ROLE';
