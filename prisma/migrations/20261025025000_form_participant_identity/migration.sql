ALTER TABLE "ParticipationSession" DROP CONSTRAINT "ParticipationSession_participant_fkey";
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_participant_fkey";
ALTER TABLE "PublicationParticipant" DROP CONSTRAINT "PublicationParticipant_publication_fkey";

DROP INDEX "PublicationParticipant_tenantId_publicationId_id_key";
DROP INDEX "PublicationParticipant_tenantId_publicationId_identityHash_key";
DROP INDEX "PublicationParticipant_publicationId_lastSubmittedAt_idx";

ALTER TABLE "PublicationParticipant" ADD COLUMN "formId" TEXT;
UPDATE "PublicationParticipant" p SET "formId" = x."formId"
  FROM "Publication" x WHERE x.id = p."publicationId" AND x."tenantId" = p."tenantId";
ALTER TABLE "PublicationParticipant" ALTER COLUMN "formId" SET NOT NULL;
ALTER TABLE "PublicationParticipant" DROP COLUMN "publicationId";

CREATE UNIQUE INDEX "PublicationParticipant_tenantId_formId_id_key" ON "PublicationParticipant"("tenantId", "formId", "id");
CREATE UNIQUE INDEX "PublicationParticipant_tenantId_formId_identityHash_key" ON "PublicationParticipant"("tenantId", "formId", "identityHash");
CREATE INDEX "PublicationParticipant_formId_lastSubmittedAt_idx" ON "PublicationParticipant"("formId", "lastSubmittedAt");

ALTER TABLE "PublicationParticipant" ADD CONSTRAINT "PublicationParticipant_form_fkey"
  FOREIGN KEY ("tenantId", "formId") REFERENCES "Form"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ParticipationSession" ADD CONSTRAINT "ParticipationSession_participant_fkey"
  FOREIGN KEY ("participantId") REFERENCES "PublicationParticipant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_participant_fkey"
  FOREIGN KEY ("participantId") REFERENCES "PublicationParticipant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
