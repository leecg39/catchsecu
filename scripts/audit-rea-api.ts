import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { parse } from "csv-parse/sync";

// Static reachability is supporting evidence, never per-operation runtime acceptance.
const root = process.cwd(), directory = "docs/qa/R00-T02/api-audit";
const configFile = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram(config.fileNames.filter(file => !file.includes("/.local/") && !file.includes("/.next")), config.options);
const checker = program.getTypeChecker();
const files = program.getSourceFiles().filter(file => file.fileName.startsWith(root + "/src/"));
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const short = (file: string) => relative(root, file);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function exportsOf(file: ts.SourceFile) {
  const symbol = checker.getSymbolAtLocation(file);
  return symbol ? checker.getExportsOfModule(symbol).filter(item => methods.has(item.name)) : [];
}
function declaration(symbol?: ts.Symbol): ts.Declaration | undefined {
  if (!symbol) return;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol.valueDeclaration ?? symbol.declarations?.[0];
}
const handlers = files.filter(file => /\/src\/app\/api\/v1\/.+\/route\.ts$/.test(file.fileName)).map(file => {
  const pattern = "/" + relative(resolve("src/app/api/v1"), dirname(file.fileName));
  let score = 0;
  const expression = pattern.split("/").filter(Boolean).map(segment => {
    if (segment.startsWith("[[...")) { score -= 10; return "(?:/.*)?"; }
    if (segment.startsWith("[...")) { score -= 5; return "/.+"; }
    if (segment.startsWith("[")) { score += 1; return "/[^/]+"; }
    score += 10; return "/" + segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return { file, pattern, score, regex: new RegExp("^" + expression + "/?$"), exports: exportsOf(file) };
}).sort((a, b) => b.score - a.score);
const contract = JSON.parse(await readFile("docs/planning/contracts/openapi.json", "utf8"));
const policies = parse(await readFile("docs/planning/contracts/operation-policy-matrix.csv", "utf8"), { columns: true }) as Record<string, string>[];
const ownership = JSON.parse(await readFile("docs/planning/09-rea-fullstack/api-ownership.json", "utf8")) as Array<{method: string; path: string; owner_tasks: string[]}>;
const testEvidenceFile = "docs/qa/R00-T02/full-tests-current.json";
const retryEvidenceFile = "docs/qa/R00-T02/sso-node24-retry.json";
const runtimeTraceFile = "docs/qa/R00-T02/runtime-route-trace.json";
type RuntimeTrace = {
  requests: number; matchedRequests: number; unmatchedRequests: number;
  operationsObserved: number; operationsSuccessful: number;
  records: Array<{method: string; path: string; requests: number; successes: number; statuses: Record<string, number>}>;
};
const runtimeTrace = JSON.parse(await readFile(runtimeTraceFile, "utf8")) as RuntimeTrace;
const runtimeByOperation = new Map(runtimeTrace.records.map(item => [`${item.method} ${item.path}`, item]));
type TestEvidence = {
  success: boolean; numFailedTestSuites: number; numFailedTests: number; numPendingTests: number;
  testResults: Array<{name: string; status: string; assertionResults: Array<{status: string}>}>;
};
const fullEvidence = JSON.parse(await readFile(testEvidenceFile, "utf8")) as TestEvidence;
const retryEvidence = JSON.parse(await readFile(retryEvidenceFile, "utf8")) as TestEvidence;
const failedFullFiles = fullEvidence.testResults.filter(test => test.status === "failed");
const retryTarget = retryEvidence.testResults[0]?.name;
const fullEvidenceGreen = fullEvidence.success && !fullEvidence.numFailedTestSuites
  && !fullEvidence.numFailedTests && !fullEvidence.numPendingTests;
const retryBundleValid = !fullEvidence.numPendingTests && retryEvidence.success
  && !retryEvidence.numFailedTestSuites && !retryEvidence.numFailedTests && !retryEvidence.numPendingTests
  && retryEvidence.testResults.length === 1 && failedFullFiles.length === 1
  && failedFullFiles[0].name === retryTarget && retryTarget.endsWith("/tests/server/sso.test.ts");
if (!fullEvidenceGreen && !retryBundleValid)
  throw new Error("Supported-Node full run and targeted retry evidence do not form the expected verified bundle");
const baseline = fullEvidenceGreen ? fullEvidence : { ...fullEvidence,
  testResults: fullEvidence.testResults.map(test => test.name === retryTarget ? retryEvidence.testResults[0] : test) };
const testEvidenceMode = fullEvidenceGreen ? "node24_single_full_run_passed"
  : "node24_full_run_with_sso_hook_timeout_plus_passing_targeted_retry";
const sourceHashes = new Map<string, string>();
const importsByTest = new Map(baseline.testResults.map(test => {
  const source = program.getSourceFile(test.name);
  const imported = source?.statements.flatMap(node => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return [];
    const file = ts.resolveModuleName(node.moduleSpecifier.text, test.name, config.options, ts.sys).resolvedModule?.resolvedFileName;
    return file ? [short(file)] : [];
  }) ?? [];
  return [test.name, new Set(imported)];
}));
function graph(entry?: ts.Declaration) {
  const visited = new Set<ts.Node>(), found = new Map<string, { file: string; symbol: string; line: number }>();
  const literals = new Set<string>(), imports = new Set<string>();
  function walk(node: ts.Node) {
    if (visited.has(node)) return;
    visited.add(node);
    const file = node.getSourceFile();
    if (!file.fileName.startsWith(root + "/src/")) return;
    const key = short(file.fileName);
    if (!sourceHashes.has(key)) sourceHashes.set(key, sha(file.text));
    if (ts.isStringLiteral(node) && /^(?:[a-z_]+\.)+[a-z_*]+$/.test(node.text)) literals.add(node.text);
    if (ts.isCallExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.expression), target = declaration(symbol);
      if (target && target.getSourceFile().fileName.startsWith(root + "/src/")) {
        const targetFile = target.getSourceFile();
        const line = targetFile.getLineAndCharacterOfPosition(target.getStart()).line + 1;
        const name = symbol?.name ?? node.expression.getText();
        found.set(targetFile.fileName + ":" + line, { file: short(targetFile.fileName), symbol: name, line });
        walk(target);
      }
    }
    ts.forEachChild(node, walk);
  }
  if (entry) {
    const file = entry.getSourceFile();
    for (const node of file.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
    walk(entry);
  }
  return { functions: [...found.values()], permissionOrEventLiterals: [...literals].sort(), handlerImports: [...imports] };
}
const records = [];
const graphs = new Map<ts.Declaration, ReturnType<typeof graph>>();
function schemaReferences(value: unknown): string[] {
  const found = new Set<string>();
  function visit(node: unknown) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "$ref" && typeof child === "string") found.add(child);
      visit(child);
    }
  }
  visit(value);
  return [...found].sort();
}
for (const [path, value] of Object.entries(contract.paths)) for (const [rawMethod, operation] of Object.entries(value as Record<string, unknown>)) {
  const method = rawMethod.toUpperCase(); if (!methods.has(method)) continue;
  const sample = path.replace(/\{[^}]+\}/g, "qa-fixture");
  // Next chooses the route first; an absent method must not fall back to a broader route.
  const handler = handlers.find(item => item.regex.test(sample));
  const exported = handler?.exports.find(symbol => symbol.name === method);
  const entry = declaration(exported);
  const reachable = entry ? graphs.get(entry) ?? graph(entry) : graph();
  if (entry) graphs.set(entry, reachable);
  const handlerPath = handler ? short(handler.file.fileName) : null;
  const testFiles = baseline.testResults.filter(test => handlerPath && importsByTest.get(test.name)?.has(handlerPath)).map(test => ({ file: short(test.name), status: test.status,
    passed: test.assertionResults.filter(item => item.status === "passed").length,
    failed: test.assertionResults.filter(item => item.status === "failed").length,
    pending: test.assertionResults.filter(item => item.status === "pending").length }));
  const policy = policies.find(item => item.method === method && item.path === path);
  const contractSchemaRefs = schemaReferences(operation);
  const handlerSchemaImports = reachable.handlerImports.filter(item => /(?:contracts|schemas)/.test(item));
  const runtime = runtimeByOperation.get(`${method} ${path}`) ?? null;
  const runtimeOperationVerified = (runtime?.successes ?? 0) > 0;
  records.push({ method, path, handler: handlerPath, handlerPattern: handler?.pattern ?? null, methodExported: !!exported,
    catchAll: !!handler?.pattern.includes("..."), branchVerified: !!handler?.pattern.includes("...") && runtimeOperationVerified,
    runtimeOperationVerified,
    ownerTasks: ownership.find(item => item.method === method && item.path === path)?.owner_tasks ?? [],
    policy: policy ?? null, contract: operation,
    dtoEvidence: { contractSchemaRefs, handlerSchemaImports, policyResponseDto: policy?.response_dto ?? null },
    reachable, executionEvidence: { mode: testEvidenceMode, fullTestReport: testEvidenceFile,
      targetedRetryReport: retryEvidenceFile, directHandlerImportTests: testFiles,
      runtimeTrace: runtime ? { report: runtimeTraceFile, ...runtime } : null,
      status: runtimeOperationVerified ? "runtime_success_observed"
        : testFiles.length ? "direct_handler_import_present_operation_branch_unverified" : "missing_direct_handler_import" },
    importingTestFiles: testFiles });
}
const missing = records.filter(item => !item.handler || !item.methodExported);
const missingPolicies = records.filter(item => !item.policy);
const missingOwners = records.filter(item => !item.ownerTasks.length);
const missingDirectTestImports = records.filter(item => !item.importingTestFiles.length);
const runtimeVerified = records.filter(item => item.runtimeOperationVerified);
const catchAllRuntimeVerified = records.filter(item => item.catchAll && item.runtimeOperationVerified);
const report = { checkedAt: new Date().toISOString(), scope: "정적 계약·진입점·호출 함수 대조. 개별 API 실행/분기 통과를 의미하지 않음",
  operations: records.length, handlerFiles: handlers.length, missingHandlers: missing.length, missingPolicies: missingPolicies.length,
  catchAllOperations: records.filter(item => item.catchAll).length, testEvidenceFile, retryEvidenceFile, testEvidenceMode,
  fullRunFailedSuites: fullEvidence.numFailedTestSuites, fullRunFailedTests: fullEvidence.numFailedTests,
  operationsWithDirectHandlerTestImport: records.length - missingDirectTestImports.length,
  operationsMissingDirectHandlerTestImport: missingDirectTestImports.length,
  runtimeTraceFile,
  runtimeTraceRequests: runtimeTrace.requests,
  runtimeTraceMatchedRequests: runtimeTrace.matchedRequests,
  runtimeTraceUnmatchedRequests: runtimeTrace.unmatchedRequests,
  operationsRuntimeVerified: runtimeVerified.length,
  catchAllOperationsRuntimeVerified: catchAllRuntimeVerified.length,
  operationsMissingOwnerTasks: missingOwners.length,
  sourceHashes: Object.fromEntries(sourceHashes), records };
await mkdir(directory, { recursive: true });
await writeFile(directory + "/operations.json", JSON.stringify(report, null, 2) + "\n");
const missingLines = missing.map(item => `- ${item.method} ${item.path}: ${item.handler ?? "handler 없음"}`).join("\n");
const evidenceDescription = fullEvidenceGreen
  ? `Node 24 전체 회귀 ${testEvidenceFile}이 단일 실행으로 통과했다.`
  : `Node 24 전체 회귀 ${testEvidenceFile}은 SSO DB 초기화 hook timeout 2건으로 단일 실행 실패다. 같은 현재 소스의 SSO 파일 재실행 ${retryEvidenceFile}은 131/131 통과했다. 이 둘을 결합한 실행 증거를 사용하며 단일 전체 회귀 성공으로 집계하지 않는다.`;
await writeFile(directory + "/README.md", `# R00-T02 API 진입점 대조\n\n${report.checkedAt}\n\n현재 계약 ${records.length}개 작업, handler 파일 ${handlers.length}개. 진입점/메서드 누락 ${missing.length}개, 정책 누락 ${missingPolicies.length}개.\n\n${evidenceDescription} handler를 직접 import한 통과 시험이 연결된 operation은 ${report.operationsWithDirectHandlerTestImport}개이고, 직접 연결이 없는 operation은 ${report.operationsMissingDirectHandlerTestImport}개다. 작업 소유자 연결이 없는 operation은 ${report.operationsMissingOwnerTasks}개다.\n\n실제 route wrapper 추적 ${runtimeTrace.requests}건 중 ${runtimeTrace.matchedRequests}건을 계약에 연결했고, 성공 응답이 관측된 operation은 ${report.operationsRuntimeVerified}개다. catch-all ${report.catchAllOperations}개 중 분기 성공이 관측된 것은 ${report.catchAllOperationsRuntimeVerified}개다. 나머지는 실제 분기와 실행 증거를 추가 확인해야 한다. handler import나 테스트 파일 전체 통과만으로 API별 성공 판정을 만들지 않는다. [정규화된 런타임 추적](../runtime-route-trace.json)\n\n[기계 판독 결과](operations.json)에 handler→서버 함수·DTO 계약/handler import·권한/이벤트 문자열·정책·원래 계약·현재 테스트 파일과 소스 해시를 기록했다.${missingLines ? `\n\n${missingLines}` : ""}\n`);
console.log(JSON.stringify({ operations: records.length, handlers: handlers.length, missing: missing.map(item => ({method:item.method,path:item.path,handler:item.handler})), missingPolicies: missingPolicies.length,
  operationsWithDirectHandlerTestImport: report.operationsWithDirectHandlerTestImport,
  operationsMissingDirectHandlerTestImport: report.operationsMissingDirectHandlerTestImport,
  operationsRuntimeVerified: report.operationsRuntimeVerified,
  catchAllOperationsRuntimeVerified: report.catchAllOperationsRuntimeVerified,
  operationsMissingOwnerTasks: report.operationsMissingOwnerTasks }));
if (missing.length || missingPolicies.length) process.exitCode = 1;
