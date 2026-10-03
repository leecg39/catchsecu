import { readFile, writeFile, access } from "node:fs/promises";
const [id, status] = process.argv.slice(2);
const allowed = ["planned", "in_progress", "completed", "blocked"];
if (!id || !allowed.includes(status)) throw new Error("Usage: node scripts/task-status.mjs P00-T01 completed");
const file = "docs/planning/tasks.json";
const tasks = JSON.parse(await readFile(file, "utf8"));
const task = tasks.find(t => t.id === id);
if (!task) throw new Error("Unknown task");
if (status === "completed" || status === "in_progress") {
  for (const dep of task.dependencies) if (tasks.find(t => t.id === dep)?.status !== "completed") throw new Error("Dependency incomplete: " + dep);
}
if (status === "completed") await access("docs/qa/" + id + "/README.md");
task.status = status;
task.updatedAt = new Date().toISOString();
if (status === "completed") task.evidence = "docs/qa/" + id + "/";
await writeFile(file, JSON.stringify(tasks, null, 2) + "\n");
let md = await readFile("TASKS.md", "utf8");
md = md.replace(/> 계획만 작성했다\..*/, "> 2026-10-02: 사용자의 계획 실행 요청에 따라 구현을 시작했다. 검증 증거가 있는 항목만 완료로 표시한다.")
  .replace("현재는 계획 작성만 완료. 실행 Task는 모두 미착수다.", "구현 진행 중. Task별 실제 상태는 아래 체크박스와 tasks.json을 기준으로 한다.")
  .replace(new RegExp("- \\[.\\] " + id + " 구현·검증 완료"), "- [" + (status === "completed" ? "x" : " ") + "] " + id + " 구현·검증 완료");
if (status === "completed") md = md.replace("`docs/qa/" + id + "/` (구현 시 생성; 현재 없음)", "`docs/qa/" + id + "/`");
await writeFile("TASKS.md", md);
const done = tasks.filter(t => t.status === "completed").length;
const active = tasks.filter(t => t.status === "in_progress");
let progress = "# 구현 진행 현황\n\n계획 실행 중. 마지막 갱신: " + new Date().toISOString() + "\n\n## 전체 구현 진행률: " + (done / tasks.length * 100).toFixed(1) + "% (" + done + "/" + tasks.length + ")\n\n기존 UI 클론 완료 항목은 서버 구현 완료로 집계하지 않는다. 외부 미검증과 진행 중 항목은 완료에 포함하지 않는다.\n\n| 마일스톤 | 완료/전체 | 상태 |\n|---|---:|---|\n";
for (const milestone of [...new Set(tasks.map(t => t.milestone))]) {
  const group = tasks.filter(t => t.milestone === milestone), completed = group.filter(t => t.status === "completed").length;
  progress += "| " + milestone + " | " + completed + "/" + group.length + " | " + (completed === group.length ? "완료" : group.some(t => t.status !== "planned") ? "진행 중" : "대기") + " |\n";
}
progress += "\n## 현재 작업\n\n" + active.map(t => "- " + t.id + ": " + t.title).join("\n") + "\n\n## 완료 근거\n\n" + tasks.filter(t => t.status === "completed").map(t => "- [" + t.id + "](../../" + t.evidence + "README.md)").join("\n") + "\n";
progress += "\n## 구현 중인 기능과 검증\n\n완료 게이트 전의 부분 구현은 [현재 구현 현황](../../docs/IMPLEMENTATION-STATUS.md), [폼·응답 검증](../../docs/qa/forms/README.md), [구성원·초대 검증](../../docs/qa/members/README.md), [템플릿 검증](../../docs/qa/templates/README.md), [정책·승인 검증](../../docs/qa/policy-approvals/README.md)에 별도로 기록한다.\n";
await writeFile(".Codex/goals/progress.md", progress);
let objectives = await readFile(".Codex/goals/objectives.md", "utf8");
objectives = objectives.replace(/현재 작업 범위는 계획 작성이다\..*/, "현재 작업 범위는 계획 실행이다. 2026-10-02 사용자의 실행 요청에 따라 서버와 화면을 구현하고 검증한다.")
  .replace(/구현 완료 Task: \d+\/72/, "구현 완료 Task: " + done + "/72");
await writeFile(".Codex/goals/objectives.md", objectives);
console.log(id + ": " + status + " (" + done + "/" + tasks.length + ")");
