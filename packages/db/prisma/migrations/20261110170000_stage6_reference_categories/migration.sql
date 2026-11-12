-- Stage 6 (part 1 of 2). New configurable list category: document categories.
-- Kept separate because PostgreSQL cannot use a new enum value in the same transaction that adds it.
ALTER TYPE "ReferenceCategory" ADD VALUE 'DOCUMENT_CATEGORY';
