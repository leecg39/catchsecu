-- 기존 초대 SSO 요청은 바인딩이 없어 새 코드에서 거부한다. 초대·회원 자료는 보존한다.
ALTER TABLE "SsoState" ADD COLUMN "invitationVersion" INTEGER;
ALTER TABLE "SsoState" ADD COLUMN "invitationTokenHash" TEXT;
ALTER TABLE "SsoState" ADD CONSTRAINT "SsoState_invitation_binding_check" CHECK (
  ("invitationVersion" IS NULL AND "invitationTokenHash" IS NULL) OR
  ("mode" = 'invite' AND "invitationId" IS NOT NULL AND "invitationVersion" IS NOT NULL
    AND "invitationVersion" > 0 AND "invitationTokenHash" IS NOT NULL
    AND "invitationTokenHash" ~ '^[0-9a-f]{64}$')
);
