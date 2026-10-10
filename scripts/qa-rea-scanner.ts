import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { env } from "../src/server/env";
import { requireFileScanner, scanFile } from "../src/server/file-scanner";

const socket = env.CLAMAV_SOCKET;
assert.ok(socket);
assert.ok(socket?.includes("/catchsecu-clamav/"));
assert.equal((await stat(socket)).mode & 0o777, 0o600);
const config = await readFile(".local/clamav/clamd.conf", "utf8");
assert.match(config, /^OfficialDatabaseOnly yes$/m);
assert.match(config, /^AlertEncrypted yes$/m);
assert.match(config, /^StreamMaxLength 15M$/m);
assert.match(config, /^MaxFileSize 15M$/m);
assert.match(config, /^MaxScanSize 32M$/m);
const root = resolve(".local/tools/clamav-source");
const execute = promisify(execFile);
const linkage = (await execute("/usr/bin/otool", ["-L", root + "/lib/libfreshclam.4.0.0.dylib"])).stdout;
assert.match(linkage, /libcurl\.4\.dylib/);
assert.doesNotMatch(linkage, /\/usr\/lib\/libcurl/);
const version = await requireFileScanner();
assert.ok(version.engine.startsWith("ClamAV 1.5.4/"));
const clean = await scanFile(Buffer.from("REA synthetic clean upload probe 2026-10-10"));
const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
const infected = await scanFile(eicar);
assert.equal(clean.clean, true); assert.equal(infected.clean, false);
const update = await readFile(".local/clamav-source/definitions-final.log", "utf8");
const downloaded = await readFile(".local/clamav-source/https-signed-download.log", "utf8");
assert.doesNotMatch(update + downloaded, /ERROR|WARNING/);
assert.match(downloaded, /Database test passed/);
const report = { checkedAt: new Date().toISOString(), result: "passed", ...version,
  socketMode: "0600", officialDatabaseOnly: true, encryptedFileAlert: true,
  cleanAccepted: true, eicarBlocked: true, signedHttpsDownloadVerified: true, updaterWarnings: 0,
  binaries: await Promise.all(["sbin/clamd", "bin/freshclam", "lib/libfreshclam.4.0.0.dylib"].map(async file => ({
    file, sha256: createHash("sha256").update(await readFile(root + "/" + file)).digest("hex"),
  }))), linkage };
await writeFile("docs/qa/R01-T03/scanner-runtime/source-build/runtime-final.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "passed", engine: version.engine, cleanAccepted: true, eicarBlocked: true, updaterWarnings: 0 }));
