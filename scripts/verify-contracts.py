from __future__ import annotations

import csv
import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "docs/planning/contracts"
SPEC = json.loads((CONTRACTS / "openapi.json").read_text())
RULES = json.loads((CONTRACTS / "domain-policies.json").read_text())["rules"]
METHODS = {"get", "post", "put", "patch", "delete"}
DELEGATED_AUTH = {"/auth/sign-up/email", "/auth/sign-in/email", "/auth/request-password-reset",
                  "/auth/sign-out", "/auth/two-factor/enable", "/auth/two-factor/verify-totp",
                  "/auth/two-factor/send-otp", "/auth/two-factor/verify-otp",
                  "/auth/two-factor/verify-backup-code", "/auth/two-factor/disable"}
NO_BODY = {("post", "/uploads/{id}/complete"), ("put", "/forms/{id}/favorite"),
           ("post", "/viewer/logout"), ("post", "/subjects/logout"),
           ("post", "/subjects/me/withdrawals/{id}/confirm"),
           ("post", "/subjects/me/withdrawals/{id}/cancel")}
HEADERS = ["method", "path", "implementation", "policy", "permission", "data_scope",
           "input_validation", "response_dto", "deletion_policy", "forbidden_action"]


def policy_for(path: str) -> dict:
    matched = [(len(prefix), rule) for rule in RULES for prefix in rule["prefixes"]
               if path == prefix or path.startswith(prefix + "/")]
    if not matched:
        raise AssertionError(f"no domain policy for {path}")
    longest = max(size for size, _ in matched)
    best = [rule for size, rule in matched if size == longest]
    assert len(best) == 1, f"ambiguous domain policy for {path}"
    return best[0]


def render() -> tuple[str, dict]:
    ids = [rule["id"] for rule in RULES]
    assert len(ids) == len(set(ids)), "duplicate policy ID"
    for rule in RULES:
        assert rule["prefixes"] and all(rule[key].strip() for key in
            ["scope", "validation", "response", "deletion", "forbidden"]), rule["id"]
    rows = []
    for path, item in SPEC["paths"].items():
        rule = policy_for(path)
        for method, op in item.items():
            if method not in METHODS:
                continue
            assert op.get("x-permission"), f"{method} {path}: permission missing"
            assert op.get("x-contract-policy") == rule["id"], f"{method} {path}: policy reference mismatch"
            assert op.get("x-implementation") in {"implemented", "partial", "planned"}, f"{method} {path}: status missing"
            assert any(code.startswith("2") for code in op["responses"]), f"{method} {path}: success response missing"
            body = op.get("requestBody")
            if method in {"post", "put", "patch"} and body is None:
                assert (method, path) in NO_BODY or path in DELEGATED_AUTH, f"{method} {path}: input schema missing"
            if body:
                assert body.get("content") and all(media.get("schema") for media in body["content"].values()), f"{method} {path}: schema missing"
            parameters = list(item.get("parameters", [])) + list(op.get("parameters", []))
            for parameter in parameters:
                assert parameter.get("name") and parameter.get("schema"), f"{method} {path}: invalid parameter"
            success = next((f"{code} {response['description']}" for code, response in op["responses"].items()
                            if code.startswith("2")), None)
            assert success, f"{method} {path}: response description missing"
            if body:
                input_shape = "OpenAPI requestBody schema; " + rule["validation"]
            elif path in DELEGATED_AUTH:
                input_shape = "Better Auth 1.7.7 delegated request contract; " + rule["validation"]
            elif (method, path) in NO_BODY:
                input_shape = "No request body; " + rule["validation"]
            else:
                input_shape = "OpenAPI path/query/header parameters; " + rule["validation"]
            rows.append({
                "method": method.upper(), "path": path, "implementation": op["x-implementation"],
                "policy": rule["id"], "permission": op["x-permission"], "data_scope": rule["scope"],
                "input_validation": input_shape, "response_dto": success + "; " + rule["response"],
                "deletion_policy": rule["deletion"], "forbidden_action": rule["forbidden"],
            })
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=HEADERS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    tasks = json.loads((ROOT / "docs/planning/tasks.json").read_text())
    completed = {task["id"] for task in tasks if task["status"] == "completed"}
    checked = set(re.findall(r"^- \[x\] (P\d{2}-T\d{2}) 구현·검증 완료", (ROOT / "TASKS.md").read_text(), re.M))
    assert completed == checked, f"task status mismatch: JSON={sorted(completed)}, Markdown={sorted(checked)}"
    report = {
        "result": "passed", "openapiPaths": len(SPEC["paths"]), "operations": len(rows),
        "policies": len(RULES), "completedTasks": len(completed),
        "implementation": dict(Counter(row["implementation"] for row in rows)),
        "unmappedOperations": 0, "missingPermissions": 0, "missingInputSchemas": 0,
    }
    return output.getvalue(), report


matrix, report = render()
matrix_path = CONTRACTS / "operation-policy-matrix.csv"
report_path = ROOT / "docs/qa/P00-T03/contract-check.json"
if "--write" in sys.argv:
    matrix_path.write_text(matrix)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
else:
    assert matrix_path.read_text() == matrix, "contract matrix is stale; run python3 scripts/verify-contracts.py --write"
    assert json.loads(report_path.read_text()) == report, "contract report is stale"
print(json.dumps(report, ensure_ascii=False))
