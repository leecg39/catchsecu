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
const baseline = JSON.parse(await readFile("docs/qa/R00-T02/baseline-tests.json", "utf8")) as {testResults: Array<{name: string; status: string; assertionResults: Array<{status: string}>}>};
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
  records.push({ method, path, handler: handlerPath, handlerPattern: handler?.pattern ?? null, methodExported: !!exported,
    catchAll: !!handler?.pattern.includes("..."), branchVerified: false, runtimeOperationVerified: false,
    ownerTasks: ownership.find(item => item.method === method && item.path === path)?.owner_tasks ?? [],
    policy: policy ?? null, contract: operation, reachable, importingTestFiles: testFiles });
}
const missing = records.filter(item => !item.handler || !item.methodExported);
const missingPolicies = records.filter(item => !item.policy);
const report = { checkedAt: new Date().toISOString(), scope: "정적 계약·진입점·호출 함수 대조. 개별 API 실행/분기 통과를 의미하지 않음",
  operations: records.length, handlerFiles: handlers.length, missingHandlers: missing.length, missingPolicies: missingPolicies.length,
  catchAllOperations: records.filter(item => item.catchAll).length, sourceHashes: Object.fromEntries(sourceHashes), records };
await mkdir(directory, { recursive: true });
await writeFile(directory + "/operations.json", JSON.stringify(report, null, 2) + "\n");
await writeFile(directory + "/README.md", `# R00-T02 API 진입점 대조\n\n${report.checkedAt}\n\n현재 계약 ${records.length}개 작업, handler 파일 ${handlers.length}개. 진입점/메서드 누락 ${missing.length}개, 정책 누락 ${missingPolicies.length}개.\n\ncatch-all ${report.catchAllOperations}개 작업은 실제 분기와 실행 증거를 추가 확인해야 한다. 테스트 파일의 통과는 해당 파일 전체 결과이며 API별 성공 판정으로 전환하지 않는다.\n\n[기계 판독 결과](operations.json)에 handler→서버 함수·DTO import·권한/이벤트 문자열·정책·원래 계약·현재 테스트 파일과 소스 해시를 기록했다.\n\n${missing.map(item => `- ${item.method} ${item.path}: ${item.handler ?? "handler 없음"}`).join("\n")}\n`);
console.log(JSON.stringify({ operations: records.length, handlers: handlers.length, missing: missing.map(item => ({method:item.method,path:item.path,handler:item.handler})), missingPolicies: missingPolicies.length }));
if (missing.length || missingPolicies.length) process.exitCode = 1;
