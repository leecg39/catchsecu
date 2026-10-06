-- 기존 로그인 요청은 version 0으로 남겨 새 코드가 재시작을 요구한다. 업무 자료와 세션은 보존한다.
ALTER TABLE "SsoState" ADD COLUMN "providerVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SsoState" ADD COLUMN "sessionId" TEXT;
CREATE UNIQUE INDEX "Session_userId_id_key" ON "Session"("userId", "id");
CREATE UNIQUE INDEX "SsoProvider_tenantId_id_key" ON "SsoProvider"("tenantId", "id");
ALTER TABLE "SsoState" DROP CONSTRAINT "SsoState_providerId_fkey";
ALTER TABLE "SsoState" ADD CONSTRAINT "SsoState_tenantId_providerId_fkey"
  FOREIGN KEY ("tenantId", "providerId") REFERENCES "SsoProvider"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SsoState" ADD CONSTRAINT "SsoState_userId_sessionId_fkey"
  FOREIGN KEY ("userId", "sessionId") REFERENCES "Session"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SsoState" ADD CONSTRAINT "SsoState_binding_check" CHECK (
  "providerVersion" >= 0 AND ("providerVersion" = 0 OR (
    ("mode" = 'link' AND "userId" IS NOT NULL AND "sessionId" IS NOT NULL) OR
    ("mode" <> 'link' AND "userId" IS NULL AND "sessionId" IS NULL)
  ))
);
