-- Executed only inside the disposable schema/transaction created by check-migration.sh.
\o /dev/null
CREATE TEMP TABLE sql_assertions (name text PRIMARY KEY);
CREATE FUNCTION pg_temp.assert_true(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  INSERT INTO sql_assertions VALUES (label);
END;
$$;
CREATE FUNCTION pg_temp.assert_raises(label text, statement text, expected_state text, expected_constraint text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE raised boolean := false; actual_constraint text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_constraint = CONSTRAINT_NAME;
    IF SQLSTATE != expected_state OR (expected_constraint IS NOT NULL AND actual_constraint != expected_constraint) THEN
      RAISE EXCEPTION 'Assertion %: expected state % constraint %, got state % constraint %: %', label, expected_state, expected_constraint, SQLSTATE, actual_constraint, SQLERRM;
    END IF;
    raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'Assertion %: statement unexpectedly succeeded', label; END IF;
  INSERT INTO sql_assertions VALUES (label);
END;
$$;

SELECT pg_temp.assert_true('isolated schema selected', current_schema() LIKE 'ligeirinho_sqltest_%');
INSERT INTO "City" (id,name,state) VALUES ('city-1','Cidade dos testes','SP');
INSERT INTO "Establishment" (id,name,"cityId",address,latitude,longitude) VALUES ('store-1','Cozinha de teste','city-1','Rua de teste, 1',-23.55,-46.63);
INSERT INTO "Courier" (id,name,"cityId",status,online,latitude,longitude,"locationAt") VALUES
  ('courier-1','Entregador 1','city-1','AVAILABLE',true,-23.55,-46.63,CURRENT_TIMESTAMP),
  ('courier-2','Entregador 2','city-1','AVAILABLE',true,-23.56,-46.64,CURRENT_TIMESTAMP),
  ('courier-3','Entregador 3','city-1','OFFLINE',false,NULL,NULL,NULL);
INSERT INTO "Tariff" (id,"cityId","baseCents","perKmCents") VALUES ('tariff-1','city-1',500,200);
INSERT INTO "PriceQuote" (id,"establishmentId","totalCents","distanceMeters",stops,"pricingSnapshot","expiresAt")
SELECT 'quote-'||n,'store-1',1000,2500,'[]'::jsonb,'{"source":"SQL_TEST"}'::jsonb,CURRENT_TIMESTAMP+interval '5 minutes' FROM generate_series(1,4) n;
INSERT INTO "DeliveryRequest" (id,"establishmentId","cityId","quoteId",status,"totalCents","pricingSnapshot","idempotencyKey","updatedAt") VALUES
 ('delivery-1','store-1','city-1','quote-1','OFERTADO',1000,'{}','idempotency-1',CURRENT_TIMESTAMP),
 ('delivery-2','store-1','city-1','quote-2','BUSCANDO',1000,'{}','idempotency-2',CURRENT_TIMESTAMP),
 ('delivery-3','store-1','city-1','quote-3','BUSCANDO',1000,'{}','idempotency-3',CURRENT_TIMESTAMP);
INSERT INTO "DispatchOffer" (id,"deliveryId","courierId",status,"expiresAt") VALUES ('offer-1','delivery-1','courier-1','PENDING',CURRENT_TIMESTAMP+interval '10 seconds');

SELECT pg_temp.assert_raises('one pending offer per delivery',
 $$INSERT INTO "DispatchOffer" (id,"deliveryId","courierId",status,"expiresAt") VALUES ('offer-2','delivery-1','courier-2','PENDING',CURRENT_TIMESTAMP+interval '10 seconds')$$,
 '23505','DispatchOffer_one_pending_delivery');
SELECT pg_temp.assert_raises('one pending offer per courier',
 $$INSERT INTO "DispatchOffer" (id,"deliveryId","courierId",status,"expiresAt") VALUES ('offer-3','delivery-2','courier-1','PENDING',CURRENT_TIMESTAMP+interval '10 seconds')$$,
 '23505','DispatchOffer_one_pending_courier');
UPDATE "DispatchOffer" SET status='EXPIRED',"respondedAt"=CURRENT_TIMESTAMP WHERE id='offer-1';
INSERT INTO "DispatchOffer" (id,"deliveryId","courierId",status,"expiresAt") VALUES ('offer-2','delivery-1','courier-2','PENDING',CURRENT_TIMESTAMP+interval '10 seconds');
SELECT pg_temp.assert_true('expired offer permits next candidate and preserves attempt',
 (SELECT count(*)=2 AND count(*) FILTER (WHERE status='PENDING')=1 FROM "DispatchOffer" WHERE "deliveryId"='delivery-1'));
UPDATE "DispatchOffer" SET status='REJECTED',"respondedAt"=CURRENT_TIMESTAMP WHERE id='offer-2';
UPDATE "DeliveryRequest" SET status='ACEITO',"courierId"='courier-1' WHERE id='delivery-1';
SELECT pg_temp.assert_raises('courier cannot hold two active deliveries',
 $$UPDATE "DeliveryRequest" SET status='ACEITO',"courierId"='courier-1' WHERE id='delivery-2'$$,
 '23505','DeliveryRequest_one_active_courier');
UPDATE "DeliveryRequest" SET status='FINALIZADO' WHERE id='delivery-1';
UPDATE "DeliveryRequest" SET status='ACEITO',"courierId"='courier-1' WHERE id='delivery-2';
SELECT pg_temp.assert_true('terminal delivery permits new assignment without deleting history',
 (SELECT count(*)=2 AND count(*) FILTER (WHERE status NOT IN ('FINALIZADO','CANCELADO'))=1 FROM "DeliveryRequest" WHERE "courierId"='courier-1'));

SELECT pg_temp.assert_raises('nonnegative tariff base', $$UPDATE "Tariff" SET "baseCents"=-1 WHERE id='tariff-1'$$,'23514','Tariff_nonnegative');
SELECT pg_temp.assert_raises('nonnegative tariff distance price', $$UPDATE "Tariff" SET "perKmCents"=-1 WHERE id='tariff-1'$$,'23514','Tariff_nonnegative');
SELECT pg_temp.assert_raises('nonnegative quote total', $$UPDATE "PriceQuote" SET "totalCents"=-1 WHERE id='quote-1'$$,'23514','PriceQuote_nonnegative');
SELECT pg_temp.assert_raises('nonnegative quote distance', $$UPDATE "PriceQuote" SET "distanceMeters"=-1 WHERE id='quote-1'$$,'23514','PriceQuote_nonnegative');
SELECT pg_temp.assert_raises('nonnegative delivery snapshot', $$UPDATE "DeliveryRequest" SET "totalCents"=-1 WHERE id='delivery-2'$$,'23514','DeliveryRequest_nonnegative');
INSERT INTO "DeliveryStop" (id,"deliveryId",sequence,address,latitude,longitude,"priceCents") VALUES ('stop-1','delivery-1',1,'Destino de teste',-23.57,-46.65,1000);
SELECT pg_temp.assert_raises('nonnegative stop price', $$UPDATE "DeliveryStop" SET "priceCents"=-1 WHERE id='stop-1'$$,'23514','DeliveryStop_nonnegative');
SELECT pg_temp.assert_raises('individual stop sequence unique',
 $$INSERT INTO "DeliveryStop" (id,"deliveryId",sequence,address,latitude,longitude,"priceCents") VALUES ('stop-2','delivery-1',1,'Outro destino',-23.57,-46.65,1000)$$,
 '23505','DeliveryStop_deliveryId_sequence_key');
SELECT pg_temp.assert_raises('idempotency unique per establishment',
 $$INSERT INTO "DeliveryRequest" (id,"establishmentId","cityId","quoteId","totalCents","pricingSnapshot","idempotencyKey","updatedAt") VALUES ('delivery-4','store-1','city-1','quote-4',1000,'{}','idempotency-1',CURRENT_TIMESTAMP)$$,
 '23505','DeliveryRequest_establishmentId_idempotencyKey_key');
SELECT pg_temp.assert_raises('quote cannot create two delivery requests',
 $$INSERT INTO "DeliveryRequest" (id,"establishmentId","cityId","quoteId","totalCents","pricingSnapshot","idempotencyKey","updatedAt") VALUES ('delivery-5','store-1','city-1','quote-1',1000,'{}','different-idempotency-key',CURRENT_TIMESTAMP)$$,
 '23505','DeliveryRequest_quoteId_key');
SELECT pg_temp.assert_raises('establishment must reference existing city',
 $$INSERT INTO "Establishment" (id,name,"cityId",address,latitude,longitude) VALUES ('orphan-store','Inexistente','missing-city','Rua de teste',-23.55,-46.63)$$,
 '23503','Establishment_cityId_fkey');

SELECT pg_temp.assert_raises('establishment account requires establishment scope',
 $$INSERT INTO "User" (id,email,name,"passwordHash",role,"cityId","updatedAt") VALUES ('user-missing-store','store@example.test','Teste','not-a-runtime-credential','ESTABLISHMENT','city-1',CURRENT_TIMESTAMP)$$,
 '23514','User_required_role_scope');
SELECT pg_temp.assert_raises('courier account requires courier scope',
 $$INSERT INTO "User" (id,email,name,"passwordHash",role,"cityId","updatedAt") VALUES ('user-missing-courier','courier@example.test','Teste','not-a-runtime-credential','COURIER','city-1',CURRENT_TIMESTAMP)$$,
 '23514','User_required_role_scope');
SELECT pg_temp.assert_raises('city administrator requires city scope',
 $$INSERT INTO "User" (id,email,name,"passwordHash",role,"updatedAt") VALUES ('user-missing-city','admin@example.test','Teste','not-a-runtime-credential','ADMIN',CURRENT_TIMESTAMP)$$,
 '23514','User_required_role_scope');
INSERT INTO "User" (id,email,name,"passwordHash",role,"updatedAt") VALUES ('super-admin','super@example.test','Teste','not-a-runtime-credential','SUPER_ADMIN',CURRENT_TIMESTAMP);
SELECT pg_temp.assert_true('super admin can have global scope', (SELECT "cityId" IS NULL FROM "User" WHERE id='super-admin'));
SELECT pg_temp.assert_raises('courier coordinates require latitude longitude pair', $$UPDATE "Courier" SET latitude=-23.5 WHERE id='courier-3'$$,'23514','Courier_coordinates');
SELECT pg_temp.assert_raises('courier latitude range', $$UPDATE "Courier" SET latitude=100 WHERE id='courier-1'$$,'23514','Courier_coordinates');
SELECT pg_temp.assert_raises('establishment coordinate range', $$UPDATE "Establishment" SET longitude=200 WHERE id='store-1'$$,'23514','Establishment_coordinates');
SELECT pg_temp.assert_raises('stop coordinate range', $$UPDATE "DeliveryStop" SET latitude=100 WHERE id='stop-1'$$,'23514','DeliveryStop_coordinates');

SELECT pg_temp.assert_raises('confirmation requires positive stop count',
 $$INSERT INTO "Confirmation" (id,"deliveryId","userId",role,"stopCount") VALUES ('confirmation-0','delivery-1','super-admin','COURIER',0)$$,
 '23514','Confirmation_positive_stops');
INSERT INTO "Confirmation" (id,"deliveryId","userId",role,"stopCount") VALUES ('confirmation-1','delivery-1','super-admin','COURIER',1);
SELECT pg_temp.assert_raises('confirmation cannot repeat same party',
 $$INSERT INTO "Confirmation" (id,"deliveryId","userId",role,"stopCount") VALUES ('confirmation-2','delivery-1','super-admin','COURIER',1)$$,
 '23505','Confirmation_deliveryId_role_key');
INSERT INTO "AuditLog" (id,"actorId",action,"entityType","entityId") VALUES ('audit-1','super-admin','ORIGINAL','DeliveryRequest','delivery-1');
SELECT pg_temp.assert_raises('audit update blocked', $$UPDATE "AuditLog" SET action='REWRITTEN' WHERE id='audit-1'$$,'P0001');
SELECT pg_temp.assert_raises('audit delete blocked', $$DELETE FROM "AuditLog" WHERE id='audit-1'$$,'P0001');
SELECT pg_temp.assert_raises('audit truncate blocked', $$TRUNCATE "AuditLog"$$,'P0001');
SELECT pg_temp.assert_true('audit unchanged after mutation attempts', (SELECT count(*)=1 AND min(action)='ORIGINAL' FROM "AuditLog"));


-- The caller rolls back the whole schema and every fixture after this file.

-- Versioned runtime settings have immutable revision history.
INSERT INTO "SettingHead" (id,scope,"scopeId",key,value,version,"updatedAt") VALUES ('setting-1','GLOBAL','global','dispatch.offerTimeoutSeconds','10',1,CURRENT_TIMESTAMP);
INSERT INTO "SettingRevision" (id,scope,"scopeId",key,value,version,"actorId",reason) VALUES ('revision-1','GLOBAL','global','dispatch.offerTimeoutSeconds','10',1,'super-admin','Definicao inicial validada');
SELECT pg_temp.assert_raises('global setting requires canonical scope id', $$UPDATE "SettingHead" SET "scopeId"='another' WHERE id='setting-1'$$,'23514','SettingHead_scope');
SELECT pg_temp.assert_raises('setting head requires positive version', $$UPDATE "SettingHead" SET version=0 WHERE id='setting-1'$$,'23514','SettingHead_positive_version');
SELECT pg_temp.assert_raises('only one current setting per scope and key', $$INSERT INTO "SettingHead" (id,scope,"scopeId",key,value,version,"updatedAt") VALUES ('setting-duplicate','GLOBAL','global','dispatch.offerTimeoutSeconds','20',2,CURRENT_TIMESTAMP)$$,'23505','SettingHead_scope_scopeId_key_key');
SELECT pg_temp.assert_raises('setting revision version cannot be duplicated', $$INSERT INTO "SettingRevision" (id,scope,"scopeId",key,value,version,"actorId",reason) VALUES ('revision-duplicate','GLOBAL','global','dispatch.offerTimeoutSeconds','20',1,'super-admin','Tentativa de reescrever historico')$$,'23505','SettingRevision_scope_scopeId_key_version_key');
SELECT pg_temp.assert_raises('setting revision requires meaningful reason', $$INSERT INTO "SettingRevision" (id,scope,"scopeId",key,value,version,"actorId",reason) VALUES ('revision-no-reason','GLOBAL','global','dispatch.offerTimeoutSeconds','20',2,'super-admin','curto')$$,'23514','SettingRevision_actor_reason');
SELECT pg_temp.assert_raises('rollback must reference earlier positive version', $$INSERT INTO "SettingRevision" (id,scope,"scopeId",key,value,version,"actorId",reason,"rollbackOfVersion") VALUES ('revision-future','GLOBAL','global','dispatch.offerTimeoutSeconds','20',2,'super-admin','Rollback de teste invalido',3)$$,'23514','SettingRevision_positive_version');
SELECT pg_temp.assert_raises('setting revision update blocked', $$UPDATE "SettingRevision" SET value='30' WHERE id='revision-1'$$,'P0001');
SELECT pg_temp.assert_raises('setting revision delete blocked', $$DELETE FROM "SettingRevision" WHERE id='revision-1'$$,'P0001');
SELECT pg_temp.assert_raises('setting revision truncate blocked', $$TRUNCATE "SettingRevision"$$,'P0001');
INSERT INTO "SettingRevision" (id,scope,"scopeId",key,value,version,"actorId",reason) VALUES ('revision-2','GLOBAL','global','dispatch.offerTimeoutSeconds','20',2,'super-admin','Ajuste de timeout para teste');
INSERT INTO "SettingRevision" (id,scope,"scopeId",key,value,version,"actorId",reason,"rollbackOfVersion") VALUES ('revision-3','GLOBAL','global','dispatch.offerTimeoutSeconds','10',3,'super-admin','Rollback preservando historico',1);
UPDATE "SettingHead" SET value='10',version=3 WHERE id='setting-1';
SELECT pg_temp.assert_true('rollback appends revision without rewriting history', (SELECT count(*)=3 AND count(*) FILTER (WHERE version=2 AND value='20')=1 FROM "SettingRevision"));
SELECT pg_temp.assert_true('current setting points to newest rollback revision', (SELECT version=3 AND value='10' FROM "SettingHead" WHERE id='setting-1'));
\o
SELECT count(*) AS passed_sql_assertions FROM sql_assertions;
