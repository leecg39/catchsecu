CREATE TABLE "NotificationIntegration" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "serviceId" TEXT NOT NULL, "creatorId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "provider" TEXT NOT NULL CHECK ("provider" IN ('slack','teams')),
 "transport" TEXT NOT NULL CHECK ("transport" IN ('local','webhook')), "endpointCipher" TEXT, "endpointHost" TEXT,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "generation" INTEGER NOT NULL DEFAULT 1 CHECK ("generation">0),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0), "deletedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE ("tenantId","serviceId","id"),
 FOREIGN KEY ("tenantId","serviceId") REFERENCES "Service"("tenantId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("tenantId","creatorId") REFERENCES "Membership"("tenantId","id") ON DELETE RESTRICT,
 CHECK (("deletedAt" IS NULL AND length("name") BETWEEN 1 AND 100 AND "endpointCipher" IS NOT NULL AND "endpointHost" IS NOT NULL)
 OR ("deletedAt" IS NOT NULL AND "name"='' AND "endpointCipher" IS NULL AND "endpointHost" IS NULL AND NOT "enabled"))
);
CREATE INDEX "NotificationIntegration_tenantId_serviceId_createdAt_id_idx" ON "NotificationIntegration"("tenantId","serviceId","createdAt","id");
CREATE TABLE "NotificationSubscription" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "serviceId" TEXT NOT NULL, "integrationId" TEXT NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('submission.created','import.completed')), "targetId" TEXT,
 UNIQUE ("integrationId","kind"),
 FOREIGN KEY ("tenantId","serviceId","integrationId") REFERENCES "NotificationIntegration"("tenantId","serviceId","id") ON DELETE RESTRICT
);
CREATE INDEX "NotificationSubscription_tenantId_serviceId_kind_idx" ON "NotificationSubscription"("tenantId","serviceId","kind");
CREATE TABLE "NotificationEvent" (
 "id" TEXT PRIMARY KEY, "eventKey" TEXT NOT NULL UNIQUE, "tenantId" TEXT NOT NULL, "serviceId" TEXT NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('submission.created','import.completed','test')), "sourceId" TEXT NOT NULL,
 "sourceVersion" INTEGER NOT NULL CHECK ("sourceVersion">0), "targetId" TEXT NOT NULL,
 "importedRows" INTEGER NOT NULL DEFAULT 0 CHECK ("importedRows">=0), "failedRows" INTEGER NOT NULL DEFAULT 0 CHECK ("failedRows">=0),
 "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("tenantId","serviceId","id"),
 FOREIGN KEY ("tenantId","serviceId") REFERENCES "Service"("tenantId","id") ON DELETE RESTRICT
);
CREATE INDEX "NotificationEvent_tenantId_serviceId_occurredAt_id_idx" ON "NotificationEvent"("tenantId","serviceId","occurredAt","id");
CREATE TABLE "NotificationDelivery" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "serviceId" TEXT NOT NULL, "integrationId" TEXT NOT NULL, "eventId" TEXT NOT NULL,
 "generation" INTEGER NOT NULL CHECK ("generation">0), "transport" TEXT NOT NULL CHECK ("transport" IN ('local','webhook')),
 "status" TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','leased','sending','retry','succeeded','failed','unknown','cancelled')),
 "outcome" TEXT CHECK ("outcome" IS NULL OR "outcome" IN ('local_delivered','accepted')),
 "lastError" TEXT CHECK ("lastError" IS NULL OR "lastError" ~ '^[A-Z_]{1,80}$'),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0), "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts">=0),
 "maxAttempts" INTEGER NOT NULL DEFAULT 3 CHECK ("maxAttempts" BETWEEN 1 AND 9 AND "attempts" <= "maxAttempts"),
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseOwner" TEXT, "leaseUntil" TIMESTAMP(3),
 "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE ("integrationId","eventId"), UNIQUE ("tenantId","serviceId","id"),
 FOREIGN KEY ("tenantId","serviceId","integrationId") REFERENCES "NotificationIntegration"("tenantId","serviceId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("tenantId","serviceId","eventId") REFERENCES "NotificationEvent"("tenantId","serviceId","id") ON DELETE RESTRICT,
 CHECK (("status" IN ('leased','sending')) = ("leaseOwner" IS NOT NULL AND "leaseUntil" IS NOT NULL)),
 CHECK (("status" IN ('succeeded','failed','unknown','cancelled')) = ("completedAt" IS NOT NULL)),
 CHECK (("status"='succeeded') = ("outcome" IS NOT NULL))
);
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_leaseUntil_idx" ON "NotificationDelivery"("status","nextAttemptAt","leaseUntil");
CREATE INDEX "NotificationDelivery_integrationId_createdAt_id_idx" ON "NotificationDelivery"("integrationId","createdAt","id");
CREATE TABLE "NotificationAttempt" (
 "id" TEXT PRIMARY KEY, "deliveryId" TEXT NOT NULL REFERENCES "NotificationDelivery"("id") ON DELETE RESTRICT,
 "number" INTEGER NOT NULL CHECK ("number">0), "outcome" TEXT NOT NULL CHECK ("outcome" IN ('local_delivered','accepted','retry','failed','unknown','cancelled')),
 "code" TEXT CHECK ("code" IS NULL OR "code" ~ '^[A-Z_]{1,80}$'), "httpStatus" INTEGER CHECK ("httpStatus" BETWEEN 100 AND 599),
 "startedAt" TIMESTAMP(3) NOT NULL, "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("deliveryId","number"), CHECK ("finishedAt">="startedAt")
);
CREATE FUNCTION notification_integration_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'NOTIFICATION_TOMBSTONE_REQUIRED'; END IF;
 IF TG_OP='UPDATE' AND (OLD."deletedAt" IS NOT NULL OR (NEW.id,NEW."tenantId",NEW."serviceId",NEW."creatorId",NEW.provider,NEW.transport,NEW."createdAt") IS DISTINCT FROM
 (OLD.id,OLD."tenantId",OLD."serviceId",OLD."creatorId",OLD.provider,OLD.transport,OLD."createdAt") OR NEW.version<>OLD.version+1 OR NEW.generation<>OLD.generation+1)
 THEN RAISE EXCEPTION 'NOTIFICATION_INTEGRATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_integration_guard BEFORE UPDATE OR DELETE ON "NotificationIntegration" FOR EACH ROW EXECUTE FUNCTION notification_integration_guard();
CREATE FUNCTION notification_subscription_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM "NotificationIntegration" i WHERE i.id=NEW."integrationId" AND i."deletedAt" IS NULL) THEN RAISE EXCEPTION 'NOTIFICATION_INTEGRATION_DELETED'; END IF;
 IF NEW."targetId" IS NOT NULL AND NOT (
 (NEW.kind='submission.created' AND EXISTS (SELECT 1 FROM "Form" f WHERE f.id=NEW."targetId" AND f."tenantId"=NEW."tenantId" AND f."serviceId"=NEW."serviceId" AND f."sourceType"='form' AND f.status<>'deleted')) OR
 (NEW.kind='import.completed' AND EXISTS (SELECT 1 FROM "ImportJob" j WHERE j.id=NEW."targetId" AND j."tenantId"=NEW."tenantId" AND j."serviceId"=NEW."serviceId" AND j.status NOT IN ('archived','cancelled','expired')))
 ) THEN RAISE EXCEPTION 'NOTIFICATION_TARGET_SCOPE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_subscription_guard BEFORE INSERT OR UPDATE ON "NotificationSubscription" FOR EACH ROW EXECUTE FUNCTION notification_subscription_guard();
CREATE FUNCTION notification_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'NOTIFICATION_EVENT_IMMUTABLE'; END IF;
 IF NEW."occurredAt">CURRENT_TIMESTAMP+interval '5 seconds' OR NEW."occurredAt"<CURRENT_TIMESTAMP-interval '5 minutes' THEN RAISE EXCEPTION 'NOTIFICATION_EVENT_TIME'; END IF;
 IF NEW.kind='submission.created' THEN
  IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "FormVersion" v ON v.id=s."formVersionId" JOIN "Form" f ON f.id=v."formId"
   WHERE s.id=NEW."sourceId" AND s."tenantId"=NEW."tenantId" AND f."serviceId"=NEW."serviceId" AND f.id=NEW."targetId" AND f."sourceType"='form'
   AND s.version=NEW."sourceVersion" AND s.version=1 AND s.status='submitted' AND NEW."eventKey"='submission:'||s.id)
   OR NEW."importedRows"<>0 OR NEW."failedRows"<>0 THEN RAISE EXCEPTION 'NOTIFICATION_EVENT_SOURCE'; END IF;
 ELSIF NEW.kind='import.completed' THEN
  IF NOT EXISTS (SELECT 1 FROM "ImportJob" j WHERE j.id=NEW."sourceId" AND j.id=NEW."targetId" AND j."tenantId"=NEW."tenantId" AND j."serviceId"=NEW."serviceId"
   AND j.version=NEW."sourceVersion" AND j.status IN ('completed','partialFailed') AND j."importedRows"=NEW."importedRows"
   AND j."invalidRows"+j."skippedRows"=NEW."failedRows" AND NEW."eventKey"='import:'||j.id||':'||j.version::text)
   THEN RAISE EXCEPTION 'NOTIFICATION_EVENT_SOURCE'; END IF;
 ELSE
  IF NOT EXISTS (SELECT 1 FROM "NotificationIntegration" i WHERE i.id=NEW."sourceId" AND i.id=NEW."targetId" AND i."tenantId"=NEW."tenantId" AND i."serviceId"=NEW."serviceId"
   AND i.generation=NEW."sourceVersion" AND i.enabled AND i."deletedAt" IS NULL) OR NEW."importedRows"<>0 OR NEW."failedRows"<>0 THEN RAISE EXCEPTION 'NOTIFICATION_TEST_SCOPE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_event_guard BEFORE INSERT OR UPDATE OR DELETE ON "NotificationEvent" FOR EACH ROW EXECUTE FUNCTION notification_event_guard();
CREATE FUNCTION notification_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE eventrow "NotificationEvent"; integ "NotificationIntegration"; BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'NOTIFICATION_DELIVERY_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO integ FROM "NotificationIntegration" WHERE id=NEW."integrationId";
  SELECT * INTO eventrow FROM "NotificationEvent" WHERE id=NEW."eventId";
  IF NOT integ.enabled OR integ."deletedAt" IS NOT NULL OR NEW.generation<>integ.generation OR NEW.transport<>integ.transport OR NEW.status<>'queued' OR NEW.attempts<>0 OR NEW.version<>1
   OR NOT ((eventrow.kind='test' AND eventrow."sourceId"=integ.id) OR EXISTS (SELECT 1 FROM "NotificationSubscription" s WHERE s."integrationId"=integ.id AND s.kind=eventrow.kind AND (s."targetId" IS NULL OR s."targetId"=eventrow."targetId")))
   THEN RAISE EXCEPTION 'NOTIFICATION_DELIVERY_SCOPE'; END IF;
 ELSE
  IF (NEW.id,NEW."tenantId",NEW."serviceId",NEW."integrationId",NEW."eventId",NEW.generation,NEW.transport,NEW."createdAt") IS DISTINCT FROM
    (OLD.id,OLD."tenantId",OLD."serviceId",OLD."integrationId",OLD."eventId",OLD.generation,OLD.transport,OLD."createdAt") OR NEW.version<>OLD.version+1
    OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR NEW."maxAttempts"<OLD."maxAttempts"
    THEN RAISE EXCEPTION 'NOTIFICATION_DELIVERY_IMMUTABLE'; END IF;
  IF NOT ((OLD.status IN ('queued','retry') AND NEW.status IN ('leased','cancelled')) OR
    (OLD.status='leased' AND NEW.status IN ('sending','retry','failed','cancelled')) OR
    (OLD.status='sending' AND NEW.status IN ('succeeded','retry','failed','unknown','cancelled')) OR
    (OLD.status='failed' AND OLD."lastError" IN ('RATE_LIMITED','LOCAL_WRITE_FAILED','LEASE_EXHAUSTED') AND NEW.status='queued' AND NEW."maxAttempts">OLD."maxAttempts"))
    THEN RAISE EXCEPTION 'NOTIFICATION_DELIVERY_TRANSITION'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON "NotificationDelivery" FOR EACH ROW EXECUTE FUNCTION notification_delivery_guard();
CREATE FUNCTION notification_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'NOTIFICATION_ATTEMPT_IMMUTABLE'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "NotificationDelivery" d WHERE d.id=NEW."deliveryId" AND d.attempts=NEW.number AND d.status IN ('succeeded','retry','failed','unknown','cancelled')) THEN RAISE EXCEPTION 'NOTIFICATION_ATTEMPT_SCOPE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON "NotificationAttempt" FOR EACH ROW EXECUTE FUNCTION notification_attempt_guard();
