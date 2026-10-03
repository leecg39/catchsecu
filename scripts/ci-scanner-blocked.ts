const report = { scanner: "blocked", reason: "GitHub runner has no ClamAV socket or current signature database.", files: ["tests/server/files.test.ts", "tests/server/notices.test.ts", "tests/server/guides.test.ts"], countsAsPass: false };
console.log(JSON.stringify(report));
if (report.countsAsPass) throw new Error("scanner skip must not count as a pass");
