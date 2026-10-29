import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLocalSql } from './run-sql.mjs';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const enabled = process.env.RUN_POSTGRES_SECURITY_TEST === '1';
test(
  'Supabase migrations preserve local sessions and enforce identity/provider/client-family constraints',
  { skip: !enabled },
  () => {
    const schema = 'supabase_auth_test_' + randomUUID().replaceAll('-', '');
    const initial = readFileSync(
      new URL(
        '../../services/api/prisma/migrations/202610290001_initial/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const migration = readFileSync(
      new URL(
        '../../services/api/prisma/migrations/202610290004_supabase_auth/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const sessionMigration = readFileSync(
      new URL(
        '../../services/api/prisma/migrations/202610290005_supabase_sessions/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const sql = `\\o /dev/null
BEGIN;
CREATE SCHEMA "${schema}";
SET LOCAL search_path TO "${schema}";
${initial}
INSERT INTO "User"(id,email,name,"passwordHash",role,"updatedAt") VALUES('local-1','one@example.test','One','synthetic-unchanged-hash','SUPER_ADMIN',CURRENT_TIMESTAMP),('local-2','two@example.test','Two','synthetic-unchanged-hash','SUPER_ADMIN',CURRENT_TIMESTAMP);
INSERT INTO "Session"(id,"userId","refreshHash","expiresAt") VALUES('legacy-session','local-1','synthetic-hash',CURRENT_TIMESTAMP+interval '1 day');
${migration}
CREATE TEMP TABLE auth_assertions(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.check_auth(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $assert$ BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Supabase SQL assertion failed: %',label; END IF;
 INSERT INTO auth_assertions VALUES(label);
END $assert$;
SELECT pg_temp.check_auth('existing users start unbound',(SELECT count(*)=2 FROM "User" WHERE "supabaseUserId" IS NULL));
SELECT pg_temp.check_auth('existing local credential and forced-change state retained',(SELECT bool_and("passwordHash"='synthetic-unchanged-hash' AND "mustChangePassword") FROM "User"));
SELECT pg_temp.check_auth('existing sessions default local',(SELECT "authProvider"='local' FROM "Session" WHERE id='legacy-session'));
UPDATE "User" SET "supabaseUserId"='11111111-1111-4111-8111-111111111111' WHERE id='local-1';
SELECT pg_temp.check_auth('explicit UID is persisted',(SELECT id='local-1' FROM "User" WHERE "supabaseUserId"='11111111-1111-4111-8111-111111111111'));
DO $unique$ DECLARE correct boolean:=false; violation text; BEGIN
 BEGIN UPDATE "User" SET "supabaseUserId"='11111111-1111-4111-8111-111111111111' WHERE id='local-2';
 EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS violation=CONSTRAINT_NAME; correct:=(violation='User_supabaseUserId_key'); END;
 PERFORM pg_temp.check_auth('same Supabase UID cannot bind two users',correct);
END $unique$;
UPDATE "User" SET "supabaseUserId"='22222222-2222-4222-8222-222222222222' WHERE id='local-2';
SELECT pg_temp.check_auth('distinct identities remain separate',(SELECT count(DISTINCT "supabaseUserId")=2 FROM "User"));
INSERT INTO "Session"(id,"userId","refreshHash","expiresAt","authProvider") VALUES('supabase-session','local-1','synthetic-hash',CURRENT_TIMESTAMP+interval '10 minutes','supabase');
SELECT pg_temp.check_auth('Supabase session provider recorded',(SELECT "authProvider"='supabase' FROM "Session" WHERE id='supabase-session'));
DO $provider$ DECLARE correct boolean:=false; violation text; BEGIN
 BEGIN UPDATE "Session" SET "authProvider"='untrusted-provider' WHERE id='supabase-session';
 EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS violation=CONSTRAINT_NAME; correct:=(violation='Session_authProvider_known'); END;
 PERFORM pg_temp.check_auth('unknown provider rejected',correct);
END $provider$;
${sessionMigration}
SELECT pg_temp.check_auth('pre-family Supabase sessions require reauthentication',(SELECT "revokedAt" IS NOT NULL AND "supabaseSessionId" IS NULL FROM "Session" WHERE id='supabase-session'));
SELECT pg_temp.check_auth('local legacy session remains active and ungrouped',(SELECT "authProvider"='local' AND "revokedAt" IS NULL AND "supabaseSessionId" IS NULL FROM "Session" WHERE id='legacy-session'));
SELECT pg_temp.check_auth('identity mappings and local credentials survive family migration',(SELECT count(*)=2 AND bool_and("supabaseUserId" IS NOT NULL AND "passwordHash"='synthetic-unchanged-hash') FROM "User"));
INSERT INTO "Session"(id,"userId","refreshHash","expiresAt","authProvider","supabaseSessionId") VALUES('family-one','local-1','synthetic-hash',CURRENT_TIMESTAMP+interval '10 minutes','supabase','33333333-3333-4333-8333-333333333333');
SELECT pg_temp.check_auth('verified provider family stored as UUID',(SELECT "supabaseSessionId"='33333333-3333-4333-8333-333333333333'::uuid FROM "Session" WHERE id='family-one'));
DO $family$ DECLARE correct boolean:=false; violation text; BEGIN
 BEGIN INSERT INTO "Session"(id,"userId","refreshHash","expiresAt","authProvider","supabaseSessionId") VALUES('duplicate-family','local-1','synthetic-hash',CURRENT_TIMESTAMP+interval '10 minutes','supabase','33333333-3333-4333-8333-333333333333');
 EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS violation=CONSTRAINT_NAME; correct:=(violation='Session_userId_supabaseSessionId_key'); END;
 PERFORM pg_temp.check_auth('one stable Nest row per user and provider family',correct);
END $family$;
INSERT INTO "Session"(id,"userId","refreshHash","expiresAt","authProvider","supabaseSessionId") VALUES('family-two','local-1','synthetic-hash',CURRENT_TIMESTAMP+interval '10 minutes','supabase','44444444-4444-4444-8444-444444444444');
SELECT pg_temp.check_auth('different provider device families remain independent',(SELECT count(*)=2 FROM "Session" WHERE "userId"='local-1' AND "supabaseSessionId" IS NOT NULL));
INSERT INTO "Session"(id,"userId","refreshHash","expiresAt") VALUES('second-local','local-1','synthetic-hash',CURRENT_TIMESTAMP+interval '1 day');
SELECT pg_temp.check_auth('nullable family permits independent local sessions',(SELECT count(*)=2 FROM "Session" WHERE "userId"='local-1' AND "authProvider"='local' AND "supabaseSessionId" IS NULL AND "revokedAt" IS NULL));
DO $local_family$ DECLARE correct boolean:=false; violation text; BEGIN
 BEGIN UPDATE "Session" SET "supabaseSessionId"='55555555-5555-4555-8555-555555555555' WHERE id='second-local';
 EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS violation=CONSTRAINT_NAME; correct:=(violation='Session_supabase_family_provider'); END;
 PERFORM pg_temp.check_auth('local provider cannot claim Supabase family',correct);
END $local_family$;
DO $invalid_family$ DECLARE correct boolean:=false; BEGIN
 BEGIN UPDATE "Session" SET "supabaseSessionId"='malformed-family' WHERE id='family-two';
 EXCEPTION WHEN invalid_text_representation THEN correct:=true; END;
 PERFORM pg_temp.check_auth('malformed family UUID rejected by PostgreSQL',correct);
END $invalid_family$;
UPDATE "Session" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id='family-one';
DO $tombstone$ DECLARE correct boolean:=false; violation text; BEGIN
 BEGIN INSERT INTO "Session"(id,"userId","refreshHash","expiresAt","authProvider","supabaseSessionId") VALUES('recreated-family','local-1','synthetic-hash',CURRENT_TIMESTAMP+interval '10 minutes','supabase','33333333-3333-4333-8333-333333333333');
 EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS violation=CONSTRAINT_NAME; correct:=(violation='Session_userId_supabaseSessionId_key'); END;
 PERFORM pg_temp.check_auth('revoked family retains unique tombstone instead of reopening',correct);
END $tombstone$;
\\o
SELECT 'SUPABASE_AUTH_SQL_ASSERTIONS='||count(*) FROM auth_assertions;
ROLLBACK;
DO $rollback$ BEGIN IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='${schema}') THEN RAISE EXCEPTION 'Temporary schema remains'; END IF; END $rollback$;
`;
    const result = runLocalSql(sql);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SUPABASE_AUTH_SQL_ASSERTIONS=18/);
  },
);
