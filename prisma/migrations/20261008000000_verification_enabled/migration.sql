-- 본인인증 연동에 사용(enabled) 상태를 추가한다. enabled는 local sandbox 공급자만 허용하는
-- 애플리케이션 규칙이며, 저장층 제약은 상태 열거 확장만 담당한다.
ALTER TABLE "VerificationIntegration" DROP CONSTRAINT "VerificationIntegration_configuration_check";
ALTER TABLE "VerificationIntegration" ADD CONSTRAINT "VerificationIntegration_configuration_check" CHECK (
  version > 0 AND environment IN ('sandbox','production') AND status IN ('pending','enabled','disabled','deleted')
  AND ("identityProvider" IS NULL OR "identityProvider" ~ '^[a-z][a-z0-9_-]{1,63}$')
  AND ("signatureProvider" IS NULL OR "signatureProvider" ~ '^[a-z][a-z0-9_-]{1,63}$')
  AND CASE WHEN status='deleted' THEN "identityProvider" IS NULL AND "signatureProvider" IS NULL
    ELSE "identityProvider" IS NOT NULL OR "signatureProvider" IS NOT NULL END
);
ALTER TABLE "VerificationIntegrationRevision" DROP CONSTRAINT "VerificationIntegrationRevision_configuration_check";
ALTER TABLE "VerificationIntegrationRevision" ADD CONSTRAINT "VerificationIntegrationRevision_configuration_check" CHECK (
  version > 0 AND environment IN ('sandbox','production') AND status IN ('pending','enabled','disabled','deleted')
);

-- attempt 가드가 요구하는 "사용 가능한 설정" 상태를 pending → enabled로 정정한다.
-- pending은 설정만 된 상태, enabled가 실제 challenge/verified/consumed를 허용하는 상태다.
CREATE OR REPLACE FUNCTION verification_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configuration "VerificationIntegration"; revision "VerificationIntegrationRevision";
BEGIN
  SELECT * INTO configuration FROM "VerificationIntegration" WHERE id=NEW."integrationId" FOR SHARE;
  SELECT * INTO revision FROM "VerificationIntegrationRevision" WHERE "integrationId"=NEW."integrationId" AND version=NEW."integrationVersion";
  IF NOT FOUND OR NEW.environment <> revision.environment THEN RAISE EXCEPTION 'attempt environment mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (NEW.status <> 'pending' OR NEW.version <> 1 OR NEW."verifiedAt" IS NOT NULL) THEN RAISE EXCEPTION 'attempt must start pending' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW."tenantId",NEW."serviceId",NEW."integrationId",NEW."integrationVersion",NEW."formId",NEW."formVersionId",NEW."publicationId",NEW.kind,NEW.environment,NEW."browserNonceHash",NEW."requestHash",NEW."documentHash",NEW."createdAt",NEW."expiresAt")
      IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."serviceId",OLD."integrationId",OLD."integrationVersion",OLD."formId",OLD."formVersionId",OLD."publicationId",OLD.kind,OLD.environment,OLD."browserNonceHash",OLD."requestHash",OLD."documentHash",OLD."createdAt",OLD."expiresAt")
      OR NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'immutable verification scope or stale version' USING ERRCODE='23514'; END IF;
    IF NOT ((OLD.status='pending' AND NEW.status IN ('pending','verified','failed','cancelled','expired')) OR (OLD.status='verified' AND NEW.status IN ('consumed','cancelled','expired')))
      THEN RAISE EXCEPTION 'invalid verification transition' USING ERRCODE='23514'; END IF;
  END IF;
  IF (TG_OP='INSERT' OR NEW.status IN ('verified','consumed')) AND (configuration.status <> 'enabled' OR configuration.version <> NEW."integrationVersion" OR NEW."expiresAt" <= clock_timestamp())
    THEN RAISE EXCEPTION 'verification configuration unavailable or expired' USING ERRCODE='23514'; END IF;
  IF NEW.kind='identity' AND revision."identityProvider" IS NULL OR NEW.kind='signature' AND revision."signatureProvider" IS NULL
    THEN RAISE EXCEPTION 'verification provider missing' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

-- 영수증 environment 제약이 production만 허용해 로컬 sandbox 공급자의 영수증을 막는다.
-- attempt↔revision↔receipt 정합성은 verification_receipt_guard 트리거가 별도로 강제하므로
-- CHECK는 두 environment 모두 허용으로 완화한다.
ALTER TABLE "VerificationReceipt" DROP CONSTRAINT "VerificationReceipt_evidence_check";
ALTER TABLE "VerificationReceipt" ADD CONSTRAINT "VerificationReceipt_evidence_check" CHECK (
  kind IN ('identity','signature') AND environment IN ('sandbox','production')
  AND "documentHash" ~ '^[0-9a-f]{64}$' AND "proofHash" ~ '^[0-9a-f]{64}$'
  AND "retentionUntil" > "verifiedAt"
);
