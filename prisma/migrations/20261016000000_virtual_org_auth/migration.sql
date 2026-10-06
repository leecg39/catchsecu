-- 가상 조직 인증(GPKI·새올·그룹웨어 mock 디렉터리) 어댑터
CREATE TABLE "VirtualOrgMember" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "orgCode" TEXT NOT NULL,
  "employeeNo" TEXT NOT NULL,
  "nameCipher" TEXT NOT NULL,
  "emailCipher" TEXT,
  "pinHash" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VirtualOrgMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VirtualOrgMember_tenantId_providerId_fkey" FOREIGN KEY ("tenantId", "providerId") REFERENCES "SsoProvider" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VirtualOrgMember_providerId_orgCode_employeeNo_key" ON "VirtualOrgMember" ("providerId", "orgCode", "employeeNo");
CREATE UNIQUE INDEX "VirtualOrgMember_orgCode_employeeNo_key" ON "VirtualOrgMember" ("orgCode", "employeeNo");
ALTER TABLE "SsoState" ADD COLUMN "orgMemberId" TEXT;
