-- Explicit provider identity binding only; no email-based account migration.
ALTER TABLE "User" ADD COLUMN "supabaseUserId" TEXT;
CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");
ALTER TABLE "Session" ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "Session" ADD CONSTRAINT "Session_authProvider_known" CHECK ("authProvider" IN ('local', 'supabase'));
