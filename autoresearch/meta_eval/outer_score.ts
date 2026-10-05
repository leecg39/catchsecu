// Level 0 — 어떤 루프도 이 파일을 수정하지 않는다.
// outer_score = final_score*0.5 + convergence_speed*0.3 + improvement_per_exp*0.2
// 실행: npx tsx autoresearch/meta_eval/outer_score.ts
import { readFile } from "node:fs/promises";

const lines = (await readFile("autoresearch/inner_results.tsv", "utf8")).trim().split("\n").slice(1).map(line => line.split("\t"));
const columns = { total: 3, decision: 8 };
const baselineRow = lines.find(row => row[columns.decision] === "baseline");
if (!baselineRow) throw new Error("baseline row missing");
const baseline = Number(baselineRow[columns.total]);
const experiments = lines.filter(row => row[columns.decision] !== "baseline");
const kept = experiments.filter(row => row[columns.decision] === "keep");
const final = kept.length ? Number(kept[kept.length - 1][columns.total]) : baseline;
const gain = final - baseline;
const reach = experiments.findIndex(row => row[columns.decision] === "keep" && Number(row[columns.total]) >= baseline + 0.95 * gain);
const convergence = experiments.length && gain > 0 ? 100 * (1 - Math.max(0, reach) / experiments.length) : 0;
const perExperiment = experiments.length ? Math.min(100, (100 * gain) / experiments.length / 5) : 0;
const outer = final * 0.5 + convergence * 0.3 + perExperiment * 0.2;
const round = (n: number) => Math.round(n * 100) / 100;
console.log(JSON.stringify({ baseline, final, gain: round(gain), experiments: experiments.length, kept: kept.length,
  convergence: round(convergence), improvementPerExperiment: round(perExperiment), outer: round(outer) }));
