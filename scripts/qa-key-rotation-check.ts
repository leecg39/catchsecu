// 키 회전 검증: 현재 프로세스 env의 키 조합으로 샘플 암호문을 복호해 성공/실패를 집계한다.
import { db } from "../src/server/db";
import { decrypt, tokenHash } from "../src/server/crypto";

const samples = await db.$queryRaw<{ id: string; valueCipher: string }[]>`
  SELECT id, "valueCipher" FROM "Answer" WHERE "valueCipher" IS NOT NULL LIMIT 50`;
const publications = await db.$queryRaw<{ id: string; tokenCipher: string }[]>`
  SELECT id, "tokenCipher" FROM "Publication" LIMIT 20`;
let ok = 0, failed = 0;
for (const row of [...samples.map(r => r.valueCipher), ...publications.map(r => r.tokenCipher)]) {
  try { decrypt(row); ok++; } catch { failed++; }
}
console.log(JSON.stringify({ answers: samples.length, publications: publications.length, decryptOk: ok, decryptFailed: failed,
  lookupDigestSample: tokenHash("rotation-probe") }));
await db.$disconnect();
