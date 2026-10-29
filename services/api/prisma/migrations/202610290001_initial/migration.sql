-- Initial PostgreSQL schema; Prisma client supplies UUIDs and updatedAt values.

CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'ESTABLISHMENT', 'COURIER');

CREATE TYPE "CourierStatus" AS ENUM ('OFFLINE', 'AVAILABLE', 'OFFER_PENDING', 'BUSY', 'DISCONNECTED');

CREATE TYPE "DeliveryStatus" AS ENUM ('SOLICITADO', 'BUSCANDO', 'AGUARDANDO', 'OFERTADO', 'ACEITO', 'A_CAMINHO_COLETA', 'NO_ESTABELECIMENTO', 'EM_ENTREGA', 'ENTREGADOR_CONCLUIU', 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO', 'FINALIZADO', 'CANCELAMENTO_SOLICITADO', 'CANCELADO', 'INTERVENCAO_ADMIN');

CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "cityId" TEXT,
  "establishmentId" TEXT,
  "courierId" TEXT,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT TRUE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "City" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Establishment" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "cityId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Establishment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Courier" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "cityId" TEXT NOT NULL,
  "status" "CourierStatus" NOT NULL DEFAULT 'OFFLINE',
  "online" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "locationAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Courier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourierPreference" (
  "id" TEXT NOT NULL,
  "establishmentId" TEXT NOT NULL,
  "courierId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CourierPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourierBlock" (
  "id" TEXT NOT NULL,
  "establishmentId" TEXT NOT NULL,
  "courierId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourierBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tariff" (
  "id" TEXT NOT NULL,
  "cityId" TEXT NOT NULL,
  "baseCents" INTEGER NOT NULL,
  "perKmCents" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceQuote" (
  "id" TEXT NOT NULL,
  "establishmentId" TEXT NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "distanceMeters" INTEGER NOT NULL,
  "stops" JSONB NOT NULL,
  "pricingSnapshot" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceQuote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryRequest" (
  "id" TEXT NOT NULL,
  "establishmentId" TEXT NOT NULL,
  "cityId" TEXT NOT NULL,
  "courierId" TEXT,
  "quoteId" TEXT NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'SOLICITADO',
  "totalCents" INTEGER NOT NULL,
  "pricingSnapshot" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "DeliveryRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryStop" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "address" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "DeliveryStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DispatchOffer" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "courierId" TEXT NOT NULL,
  "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DispatchAttempt" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "courierId" TEXT,
  "outcome" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryEvent" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "actorId" TEXT,
  "type" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CancellationRequest" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requestedByRole" "Role" NOT NULL,
  "reason" TEXT NOT NULL,
  "previousStatus" "DeliveryStatus" NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CancellationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Confirmation" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "stopCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Confirmation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE UNIQUE INDEX "User_courierId_key" ON "User"("courierId");

CREATE INDEX "User_cityId_role_idx" ON "User"("cityId", "role");

CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

CREATE UNIQUE INDEX "City_name_state_key" ON "City"("name", "state");

CREATE INDEX "Establishment_cityId_active_idx" ON "Establishment"("cityId", "active");

CREATE INDEX "Courier_cityId_status_locationAt_idx" ON "Courier"("cityId", "status", "locationAt");

CREATE UNIQUE INDEX "CourierPreference_establishmentId_courierId_key" ON "CourierPreference"("establishmentId", "courierId");

CREATE UNIQUE INDEX "CourierBlock_establishmentId_courierId_key" ON "CourierBlock"("establishmentId", "courierId");

CREATE INDEX "Tariff_cityId_active_idx" ON "Tariff"("cityId", "active");

CREATE INDEX "PriceQuote_establishmentId_expiresAt_idx" ON "PriceQuote"("establishmentId", "expiresAt");

CREATE UNIQUE INDEX "DeliveryRequest_quoteId_key" ON "DeliveryRequest"("quoteId");

CREATE UNIQUE INDEX "DeliveryRequest_establishmentId_idempotencyKey_key" ON "DeliveryRequest"("establishmentId", "idempotencyKey");

CREATE INDEX "DeliveryRequest_cityId_status_createdAt_idx" ON "DeliveryRequest"("cityId", "status", "createdAt");

CREATE INDEX "DeliveryRequest_courierId_status_idx" ON "DeliveryRequest"("courierId", "status");

CREATE UNIQUE INDEX "DeliveryStop_deliveryId_sequence_key" ON "DeliveryStop"("deliveryId", "sequence");

CREATE INDEX "DispatchOffer_status_expiresAt_idx" ON "DispatchOffer"("status", "expiresAt");

CREATE INDEX "DispatchOffer_courierId_status_idx" ON "DispatchOffer"("courierId", "status");

CREATE UNIQUE INDEX "DispatchOffer_deliveryId_courierId_key" ON "DispatchOffer"("deliveryId", "courierId");

CREATE INDEX "DispatchAttempt_deliveryId_createdAt_idx" ON "DispatchAttempt"("deliveryId", "createdAt");

CREATE INDEX "DeliveryEvent_deliveryId_createdAt_idx" ON "DeliveryEvent"("deliveryId", "createdAt");

CREATE INDEX "CancellationRequest_deliveryId_approvedAt_idx" ON "CancellationRequest"("deliveryId", "approvedAt");

CREATE UNIQUE INDEX "Confirmation_deliveryId_role_key" ON "Confirmation"("deliveryId", "role");

CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

CREATE INDEX "ChatMessage_deliveryId_createdAt_idx" ON "ChatMessage"("deliveryId", "createdAt");

ALTER TABLE "User" ADD CONSTRAINT "User_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD CONSTRAINT "User_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD CONSTRAINT "User_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Establishment" ADD CONSTRAINT "Establishment_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Courier" ADD CONSTRAINT "Courier_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourierPreference" ADD CONSTRAINT "CourierPreference_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourierPreference" ADD CONSTRAINT "CourierPreference_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourierBlock" ADD CONSTRAINT "CourierBlock_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourierBlock" ADD CONSTRAINT "CourierBlock_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliveryRequest" ADD CONSTRAINT "DeliveryRequest_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliveryRequest" ADD CONSTRAINT "DeliveryRequest_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliveryRequest" ADD CONSTRAINT "DeliveryRequest_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeliveryRequest" ADD CONSTRAINT "DeliveryRequest_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PriceQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DispatchAttempt" ADD CONSTRAINT "DispatchAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Confirmation" ADD CONSTRAINT "Confirmation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants independent of application process concurrency.
CREATE UNIQUE INDEX "DispatchOffer_one_pending_delivery" ON "DispatchOffer"("deliveryId") WHERE status = 'PENDING';
CREATE UNIQUE INDEX "DispatchOffer_one_pending_courier" ON "DispatchOffer"("courierId") WHERE status = 'PENDING';
CREATE UNIQUE INDEX "DeliveryRequest_one_active_courier" ON "DeliveryRequest"("courierId") WHERE "courierId" IS NOT NULL AND status NOT IN ('FINALIZADO','CANCELADO');
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_nonnegative" CHECK ("baseCents" >= 0 AND "perKmCents" >= 0);
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_nonnegative" CHECK ("totalCents" >= 0 AND "distanceMeters" >= 0);
ALTER TABLE "DeliveryRequest" ADD CONSTRAINT "DeliveryRequest_nonnegative" CHECK ("totalCents" >= 0);
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_nonnegative" CHECK ("priceCents" >= 0 AND sequence >= 0);
ALTER TABLE "Confirmation" ADD CONSTRAINT "Confirmation_positive_stops" CHECK ("stopCount" > 0);
ALTER TABLE "Establishment" ADD CONSTRAINT "Establishment_coordinates" CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE "Courier" ADD CONSTRAINT "Courier_coordinates" CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_coordinates" CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$;
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

ALTER TABLE "User" ADD CONSTRAINT "User_required_role_scope" CHECK ((role != 'ESTABLISHMENT' OR "establishmentId" IS NOT NULL) AND (role != 'COURIER' OR "courierId" IS NOT NULL) AND (role = 'SUPER_ADMIN' OR "cityId" IS NOT NULL));
