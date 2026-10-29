-- Bind Nest sessions to the verified Supabase Auth client/device session claim.
-- Nullable values preserve local sessions and migration compatibility.
ALTER TABLE "Session" ADD COLUMN "supabaseSessionId" UUID;
CREATE UNIQUE INDEX "Session_userId_supabaseSessionId_key" ON "Session"("userId", "supabaseSessionId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_supabase_family_provider"
  CHECK ("supabaseSessionId" IS NULL OR "authProvider" = 'supabase');

-- Pre-family Supabase sessions cannot be revoked per client. Require those
-- clients to authenticate again so old ungrouped Nest JWTs cannot survive logout.
-- Existing local sessions, credentials and identity mappings are unchanged.
UPDATE "Session" SET "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP)
  WHERE "authProvider" = 'supabase' AND "supabaseSessionId" IS NULL;
