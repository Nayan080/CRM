-- Runs once, when the Postgres volume is first created (also used by CI).
--
-- Two database users (least privilege):
--   crm      owner: runs migrations (DDL). Local-only superuser created by the postgres image.
--   crm_app  used by the API at runtime: data access only, NOT superuser, NOT BYPASSRLS,
--            so PostgreSQL Row-Level Security is enforced for every API query.
-- Local-only password. In real environments this role is created by infrastructure code
-- with a secret from the secrets manager.

CREATE ROLE crm_app LOGIN PASSWORD 'crm_app_local_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE crm TO crm_app;
GRANT USAGE ON SCHEMA public TO crm_app;
-- Tables/sequences created later by migrations (run as crm) are automatically usable by crm_app.
ALTER DEFAULT PRIVILEGES FOR ROLE crm IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE crm IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app;

\connect crm_test
GRANT CONNECT ON DATABASE crm_test TO crm_app;
GRANT USAGE ON SCHEMA public TO crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE crm IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE crm IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app;
