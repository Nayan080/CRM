-- Runs once, when the Postgres volume is first created.
-- Separate database for integration tests so tests never touch dev data.
CREATE DATABASE crm_test OWNER crm;
