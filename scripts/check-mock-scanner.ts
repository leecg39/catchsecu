import { requireFileScanner, scanFile } from "../src/server/file-scanner";

// A real daemon is a prerequisite for attachment tests, even when providers are mocked.
try {
  const scanner = await requireFileScanner();
  const clean = await scanFile(Buffer.from("Catchsecu Mock scanner preflight"));
  const infected = await scanFile(Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"));
  if (!clean.clean || infected.clean) throw new Error("SCANNER_HEALTH_CHECK_FAILED");
  console.log(JSON.stringify({ result: "passed", engine: scanner.engine,
    signatureUpdatedAt: scanner.signatureUpdatedAt, cleanAccepted: true, eicarRejected: true }));
} catch (error) {
  // Diagnostic codes only; never dump environment settings or connection strings.
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "SCANNER_HEALTH_CHECK_FAILED";
  console.error(JSON.stringify({ result: "failed", code }));
  process.exitCode = 1;
}
