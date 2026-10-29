import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLocalSql } from './run-sql.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildSupabaseSecuritySql } from '../../scripts/supabase-prepare.mjs';
const run = process.env.RUN_POSTGRES_SECURITY_TEST === '1';
test(
  'private Supabase schema denies current and future Data API privileges; rollback restores local state',
  { skip: !run },
  () => {
    const schema = `ligeirinho_supabase_test_${randomUUID().replaceAll('-', '')}`;
    const migration = readFileSync(
      new URL(
        '../../services/api/prisma/migrations/202610290001_initial/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const sql = `\\o /dev/null
BEGIN;
CREATE SCHEMA "${schema}";
SET LOCAL search_path TO "${schema}";
DO $setup$ DECLARE target name; BEGIN
 FOR target IN SELECT unnest(ARRAY['anon','authenticated','service_role']) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=target) THEN EXECUTE format('CREATE ROLE %I NOLOGIN',target); END IF;
 END LOOP;
END $setup$;
${migration}
CREATE SEQUENCE sensitive_sequence;
GRANT ALL ON SCHEMA "${schema}" TO PUBLIC, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO PUBLIC, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO PUBLIC, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA "${schema}" TO PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON TABLES TO PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON SEQUENCES TO PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON FUNCTIONS TO PUBLIC, anon, authenticated, service_role;
${buildSupabaseSecuritySql(schema, { transaction: false })}
CREATE TEMP TABLE security_assertions (name text PRIMARY KEY);
CREATE FUNCTION pg_temp.assert_secure(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'SQL security assertion failed: %', label; END IF;
INSERT INTO security_assertions VALUES(label); END $assert$;
SELECT pg_temp.assert_secure('full initial migration exercised',(SELECT count(*)>=18 FROM pg_class WHERE relnamespace='${schema}'::regnamespace AND relkind='r') AND to_regclass('"User"') IS NOT NULL AND to_regclass('"Session"') IS NOT NULL AND to_regclass('"Courier"') IS NOT NULL);
SELECT pg_temp.assert_secure('PUBLIC no schema grant',NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='${schema}' AND a.grantee=0));
SELECT pg_temp.assert_secure('PUBLIC no existing table grant',NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='${schema}'::regnamespace AND c.relkind='r' AND a.grantee=0));
SELECT pg_temp.assert_secure('PUBLIC no existing sequence grant',NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) a WHERE c.relnamespace='${schema}'::regnamespace AND c.relkind='S' AND a.grantee=0));
SELECT pg_temp.assert_secure('PUBLIC no existing function grant',NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='${schema}'::regnamespace AND a.grantee=0));
DO $current$ DECLARE target name; BEGIN
 FOR target IN SELECT unnest(ARRAY['anon','authenticated','service_role']) LOOP
  PERFORM pg_temp.assert_secure(target||' schema denied',NOT has_schema_privilege(target,'${schema}','USAGE') AND NOT has_schema_privilege(target,'${schema}','CREATE'));
  PERFORM pg_temp.assert_secure(target||' existing tables denied',NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='${schema}'::regnamespace AND CASE WHEN c.relkind='r' THEN has_table_privilege(target,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ELSE false END));
  PERFORM pg_temp.assert_secure(target||' existing sequences denied',NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='${schema}'::regnamespace AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(target,c.oid,'USAGE,SELECT,UPDATE') ELSE false END));
  PERFORM pg_temp.assert_secure(target||' existing functions denied',NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='${schema}'::regnamespace AND has_function_privilege(target,p.oid,'EXECUTE')));
 END LOOP;
END $current$;
CREATE TABLE future_sensitive_table(id serial PRIMARY KEY);
CREATE FUNCTION future_sensitive_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
SELECT pg_temp.assert_secure('PUBLIC future table default denied',NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='future_sensitive_table'::regclass AND a.grantee=0));
SELECT pg_temp.assert_secure('PUBLIC future sequence default denied',NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) a WHERE c.oid='future_sensitive_table_id_seq'::regclass AND a.grantee=0));
SELECT pg_temp.assert_secure('global function defaults preserved while private schema denies PUBLIC usage',EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='future_sensitive_function()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AND NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='${schema}' AND a.grantee=0 AND a.privilege_type='USAGE'));
CREATE FUNCTION pg_temp.future_function_denied(target name) RETURNS boolean LANGUAGE plpgsql AS $call$
BEGIN
 BEGIN
  EXECUTE format('SET LOCAL ROLE %I', target);
  EXECUTE 'SELECT "${schema}".future_sensitive_function()';
  EXECUTE 'RESET ROLE';
  RETURN false;
 EXCEPTION WHEN insufficient_privilege THEN RETURN true;
 END;
END $call$;
DO $future$ DECLARE target name; BEGIN
 FOR target IN SELECT unnest(ARRAY['anon','authenticated','service_role']) LOOP
  PERFORM pg_temp.assert_secure(target||' future table denied',NOT has_table_privilege(target,'future_sensitive_table','SELECT,INSERT,UPDATE,DELETE'));
  PERFORM pg_temp.assert_secure(target||' future sequence denied',NOT has_sequence_privilege(target,'future_sensitive_table_id_seq','USAGE,SELECT,UPDATE'));
  PERFORM pg_temp.assert_secure(target||' future function denied',pg_temp.future_function_denied(target));
 END LOOP;
END $future$;
SELECT pg_temp.assert_secure('owner retains migration and application access',has_schema_privilege(current_user,'${schema}','USAGE') AND has_table_privilege(current_user,'future_sensitive_table','SELECT') AND has_sequence_privilege(current_user,'future_sensitive_table_id_seq','USAGE') AND has_function_privilege(current_user,'future_sensitive_function()','EXECUTE'));
\\o
SELECT 'SUPABASE_SQL_ASSERTIONS='||count(*) FROM security_assertions;
ROLLBACK;
DO $rollback$ BEGIN IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='${schema}') THEN RAISE EXCEPTION 'Disposable schema remains'; END IF; END $rollback$;
`;
    const result = runLocalSql(sql);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SUPABASE_SQL_ASSERTIONS=30/);
  },
);
