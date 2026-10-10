ALTER TABLE "FormAccessTargetBatch"
  RENAME CONSTRAINT "FormAccessTargetBatch_form_fkey" TO "FormAccessTargetBatch_tenantId_formId_fkey";

ALTER TABLE "FormAccessTarget"
  RENAME CONSTRAINT "FormAccessTarget_form_fkey" TO "FormAccessTarget_tenantId_formId_fkey";
ALTER TABLE "FormAccessTarget"
  RENAME CONSTRAINT "FormAccessTarget_batch_fkey" TO "FormAccessTarget_tenantId_formId_batchId_fkey";

ALTER TABLE "ParticipationChallenge"
  RENAME CONSTRAINT "ParticipationChallenge_publication_fkey" TO "ParticipationChallenge_tenantId_publicationId_fkey";

ALTER TABLE "ParticipationSession"
  RENAME CONSTRAINT "ParticipationSession_publication_fkey" TO "ParticipationSession_tenantId_publicationId_fkey";
ALTER TABLE "ParticipationSession"
  RENAME CONSTRAINT "ParticipationSession_participant_fkey" TO "ParticipationSession_participantId_fkey";
ALTER TABLE "ParticipationSession"
  RENAME CONSTRAINT "ParticipationSession_challenge_fkey" TO "ParticipationSession_tenantId_publicationId_challengeId_fkey";

ALTER TABLE "PublicationParticipant"
  RENAME CONSTRAINT "PublicationParticipant_form_fkey" TO "PublicationParticipant_tenantId_formId_fkey";

ALTER TABLE "Submission"
  RENAME CONSTRAINT "Submission_participant_fkey" TO "Submission_participantId_fkey";
