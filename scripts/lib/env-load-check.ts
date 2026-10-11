// env 모듈 로드 시도 — production 가드 거부를 서브프로세스로 증명하기 위한 최소 엔트리.
export {};
try {
  await import("../../src/server/env");
  console.log("STARTED");
} catch (e) {
  console.log("BLOCKED: " + String(e).slice(0, 140));
  process.exitCode = 3;
}
