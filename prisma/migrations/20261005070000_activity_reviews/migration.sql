-- 독립 개인정보 활동 검토. 원본 감사와 기존 개인 감사 행을 보존한다.
CREATE UNIQUE INDEX "AuditEvent_tenantId_serviceId_id_actorId_key" ON "AuditEvent"("tenantId","serviceId","id","actorId");
CREATE TABLE "ActivityReview" (
 "id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"serviceId" TEXT NOT NULL,"auditEventId" TEXT NOT NULL,
 "recipientUserId" TEXT NOT NULL,"requesterId" TEXT NOT NULL,"recipientId" TEXT NOT NULL,"title" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'requested',"version" INTEGER NOT NULL DEFAULT 1,
 "respondedAt" TIMESTAMP(3),"closedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ActivityReview_service_fkey" FOREIGN KEY ("tenantId","serviceId") REFERENCES "Service"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ActivityReview_auditEvent_fkey" FOREIGN KEY ("tenantId","serviceId","auditEventId","recipientUserId") REFERENCES "AuditEvent"("tenantId","serviceId","id","actorId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ActivityReview_requester_fkey" FOREIGN KEY ("tenantId","requesterId") REFERENCES "Membership"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ActivityReview_recipient_fkey" FOREIGN KEY ("tenantId","recipientId","recipientUserId") REFERENCES "Membership"("tenantId","id","userId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ActivityReview_state" CHECK ("status" IN ('requested','responded','resolved','cancelled') AND "version">0 AND char_length("title") BETWEEN 1 AND 200),
 CONSTRAINT "ActivityReview_dates" CHECK (("status"='requested' AND "respondedAt" IS NULL AND "closedAt" IS NULL) OR ("status"='responded' AND "respondedAt" IS NOT NULL AND "closedAt" IS NULL) OR ("status"='resolved' AND "respondedAt" IS NOT NULL AND "closedAt" IS NOT NULL) OR ("status"='cancelled' AND "closedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ActivityReview_tenantId_id_key" ON "ActivityReview"("tenantId","id");
CREATE UNIQUE INDEX "ActivityReview_open_event_key" ON "ActivityReview"("tenantId","auditEventId") WHERE "status" IN ('requested','responded');
CREATE INDEX "ActivityReview_tenantId_recipientId_status_createdAt_id_idx" ON "ActivityReview"("tenantId","recipientId","status","createdAt","id");
CREATE INDEX "ActivityReview_tenantId_requesterId_status_createdAt_id_idx" ON "ActivityReview"("tenantId","requesterId","status","createdAt","id");
CREATE INDEX "ActivityReview_tenantId_serviceId_status_createdAt_id_idx" ON "ActivityReview"("tenantId","serviceId","status","createdAt","id");
CREATE TABLE "ActivityReviewMessage" (
 "id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"reviewId" TEXT NOT NULL,"authorId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,"bodyCipher" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ActivityReviewMessage_review_fkey" FOREIGN KEY ("tenantId","reviewId") REFERENCES "ActivityReview"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ActivityReviewMessage_author_fkey" FOREIGN KEY ("tenantId","authorId") REFERENCES "Membership"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ActivityReviewMessage_kind" CHECK ("kind" IN ('request','response','resolve','cancel'))
);
CREATE INDEX "ActivityReviewMessage_tenantId_reviewId_createdAt_id_idx" ON "ActivityReviewMessage"("tenantId","reviewId","createdAt","id");
CREATE FUNCTION protect_activity_review_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'activity review messages are immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER activity_review_message_immutable BEFORE UPDATE OR DELETE ON "ActivityReviewMessage" FOR EACH ROW EXECUTE FUNCTION protect_activity_review_message();
CREATE FUNCTION protect_activity_review_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."tenantId",NEW."serviceId",NEW."auditEventId",NEW."recipientUserId",NEW."requesterId",NEW."recipientId",NEW."title",NEW."createdAt") IS DISTINCT FROM ROW(OLD."tenantId",OLD."serviceId",OLD."auditEventId",OLD."recipientUserId",OLD."requesterId",OLD."recipientId",OLD."title",OLD."createdAt") OR NEW."version"<>OLD."version"+1 THEN RAISE EXCEPTION 'immutable review scope or invalid version' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD."status"='requested' AND NEW."status" IN ('responded','cancelled')) OR (OLD."status"='responded' AND NEW."status" IN ('resolved','cancelled'))) THEN RAISE EXCEPTION 'invalid review transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER activity_review_transition BEFORE UPDATE ON "ActivityReview" FOR EACH ROW EXECUTE FUNCTION protect_activity_review_transition();
