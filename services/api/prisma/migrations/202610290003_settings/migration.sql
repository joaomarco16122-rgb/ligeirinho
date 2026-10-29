CREATE TABLE "SettingHead" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "version" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettingHead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettingHead_scope" CHECK ("scope" IN ('GLOBAL','CITY','ESTABLISHMENT','USER') AND (("scope" = 'GLOBAL' AND "scopeId" = 'global') OR ("scope" != 'GLOBAL' AND length("scopeId") > 0))),
  CONSTRAINT "SettingHead_positive_version" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "SettingHead_scope_scopeId_key_key" ON "SettingHead"("scope","scopeId","key");
CREATE TABLE "SettingRevision" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "version" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "rollbackOfVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettingRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettingRevision_scope" CHECK ("scope" IN ('GLOBAL','CITY','ESTABLISHMENT','USER') AND (("scope" = 'GLOBAL' AND "scopeId" = 'global') OR ("scope" != 'GLOBAL' AND length("scopeId") > 0))),
  CONSTRAINT "SettingRevision_positive_version" CHECK ("version" > 0 AND ("rollbackOfVersion" IS NULL OR ("rollbackOfVersion" > 0 AND "rollbackOfVersion" < "version"))),
  CONSTRAINT "SettingRevision_actor_reason" CHECK (length(trim("actorId")) > 0 AND length(trim("reason")) BETWEEN 10 AND 500)
);
CREATE UNIQUE INDEX "SettingRevision_scope_scopeId_key_version_key" ON "SettingRevision"("scope","scopeId","key","version");
CREATE INDEX "SettingRevision_actorId_createdAt_idx" ON "SettingRevision"("actorId","createdAt");
CREATE FUNCTION reject_setting_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SettingRevision is append-only';
END;
$$;
CREATE TRIGGER "SettingRevision_append_only" BEFORE UPDATE OR DELETE ON "SettingRevision" FOR EACH ROW EXECUTE FUNCTION reject_setting_revision_mutation();
CREATE TRIGGER "SettingRevision_no_truncate" BEFORE TRUNCATE ON "SettingRevision" FOR EACH STATEMENT EXECUTE FUNCTION reject_setting_revision_mutation();
