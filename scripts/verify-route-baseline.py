"""Verify the R00-T01 route/menu baseline without claiming CRUD acceptance."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/qa/R00-T01/action-trace.json"


def read_json(path: str) -> Any:
    return json.loads((ROOT / path).read_text())


def read_csv_paths(path: str) -> list[str]:
    with (ROOT / path).open(newline="") as handle:
        return [row["path"] for row in csv.DictReader(handle)]


def classify_action(action: dict[str, Any]) -> str:
    href = action.get("href")
    tag = action["tag"]
    if href:
        if href.startswith("/api/v1/"):
            return "api_link_unexecuted"
        if href.startswith("http://") or href.startswith("https://"):
            return "external_navigation_unexecuted"
        return "route_navigation_unexecuted"
    if tag in {"INPUT", "SELECT", "TEXTAREA"}:
        return "form_control_unverified"
    if tag == "BUTTON":
        return "local_or_modal_action_unverified"
    return "unclassified_control"


def build_report() -> dict[str, Any]:
    source = read_json("docs/planning/09-rea-fullstack/source-routes.json")
    matrix = read_json("docs/planning/09-rea-fullstack/route-matrix.json")
    manifest = read_json("src/data/route-manifest.json")
    menu = read_json("src/data/menu.json")
    additional = read_json("docs/planning/09-rea-fullstack/additional-routes.json")
    inventory = read_json("docs/qa/R00-T01/menu-runtime/inventory.json")
    legacy_paths = read_csv_paths("docs/planning/03-route-matrix.csv")
    current_csv_paths = read_csv_paths("docs/planning/09-rea-fullstack/route-matrix.csv")

    source_paths = [row["path"] for row in source]
    matrix_paths = [row["path"] for row in matrix]
    manifest_paths = [row["path"] for row in manifest]
    assert len(source_paths) == len(set(source_paths)) == 186, "source route count/uniqueness"
    assert len(matrix_paths) == len(set(matrix_paths)) == 186, "matrix route count/uniqueness"
    assert len(manifest_paths) == len(set(manifest_paths)) == 186, "manifest route count/uniqueness"
    assert set(source_paths) == set(matrix_paths) == set(manifest_paths) == set(current_csv_paths)
    assert len(legacy_paths) == len(set(legacy_paths)) == 181, "legacy route count/uniqueness"
    assert set(legacy_paths) <= set(source_paths), "legacy route omitted from active plan"
    assert sum("*" in path for path in source_paths) == 2, "fallback route count"
    assert sum("*" not in path for path in source_paths) == 184, "concrete route count"
    assert len(additional) == 21, "additional route count"
    assert {row["path"] for row in additional}.isdisjoint(source_paths)

    menu_items = [
        {"section": group["label"], **item}
        for group in menu
        for item in group["items"]
    ]
    assert len(menu_items) == 35, "menu entry count"
    assert len({item["path"] for item in menu_items}) == 35, "duplicate menu path"
    assert {item["path"] for item in menu_items} <= set(source_paths)

    runtime_rows = inventory["report"]
    runtime_by_path = {row["path"]: row for row in runtime_rows}
    assert inventory["routes"] == len(runtime_rows) == len(runtime_by_path) == 34
    missing_runtime = sorted({item["path"] for item in menu_items} - set(runtime_by_path))
    assert missing_runtime == ["/logout"], f"unexpected runtime gap: {missing_runtime}"

    matrix_by_path = {row["path"]: row for row in matrix}
    traces: list[dict[str, Any]] = []
    action_counts: Counter[str] = Counter()
    outcome_counts: Counter[str] = Counter()
    total_actions = 0

    for item in menu_items:
        path = item["path"]
        contract = matrix_by_path[path]
        if path == "/logout":
            logout_refs = [
                "src/components/AppShell.tsx",
                "src/components/auth/AuthPages.tsx",
                "src/components/auth/LiveAuth.tsx",
            ]
            for ref in logout_refs:
                assert (ROOT / ref).exists(), f"missing logout source: {ref}"
            traces.append(
                {
                    **item,
                    "observedOutcome": "not_executed",
                    "runtimeReason": "세션을 파괴하는 로그아웃 동작이므로 활성 QA 세션 보존을 위해 실행하지 않음",
                    "classification": "route_destructive_session_action_not_executed",
                    "countedAsCrudSuccess": False,
                    "apiOperations": contract["api_operations"],
                    "uiCodeRefs": sorted(set(contract["ui_code_refs"] + logout_refs)),
                    "actions": [],
                }
            )
            outcome_counts["not_executed"] += 1
            continue

        runtime = runtime_by_path[path]
        state = runtime["state"]
        if state["alerts"]:
            outcome = "alert"
        elif state["url"] != path:
            outcome = "redirect"
        else:
            outcome = "rendered"
        outcome_counts[outcome] += 1

        actions = []
        for index, action in enumerate(state["actions"], start=1):
            classification = classify_action(action)
            action_counts[classification] += 1
            total_actions += 1
            actions.append(
                {
                    "ordinal": index,
                    "tag": action["tag"],
                    "label": action.get("label", ""),
                    "href": action.get("href"),
                    "type": action.get("type"),
                    "disabled": bool(action.get("disabled")),
                    "classification": classification,
                    "executed": False,
                    "countedAsCrudSuccess": False,
                }
            )

        traces.append(
            {
                **item,
                "observedOutcome": outcome,
                "observedUrl": state["url"],
                "alerts": state["alerts"],
                "countedAsCrudSuccess": False,
                "apiOperations": contract["api_operations"],
                "apiMappingStatus": contract["api_mapping_status"],
                "uiCodeRefs": contract["ui_code_refs"],
                "actions": actions,
            }
        )

    assert total_actions == 463, f"runtime action drift: {total_actions}"
    assert outcome_counts == Counter({"rendered": 34, "not_executed": 1})
    assert "unclassified_control" not in action_counts, action_counts

    unverified = [
        {
            "path": trace["path"],
            "ordinal": action["ordinal"],
            "label": action["label"],
            "classification": action["classification"],
        }
        for trace in traces
        for action in trace["actions"]
        if action["classification"] in {
            "local_or_modal_action_unverified",
            "form_control_unverified",
        }
    ]
    assert len(unverified) == 369, f"unverified local controls drift: {len(unverified)}"

    return {
        "checkedAt": inventory["checkedAt"],
        "result": "passed",
        "scope": "R00-T01 route/menu/action trace baseline; not runtime CRUD acceptance",
        "rules": {
            "wildcardsAreBusinessScreens": False,
            "redirectCountsAsCrudSuccess": False,
            "http403CountsAsCrudSuccess": False,
            "renderedCountsAsCrudSuccess": False,
            "unexecutedControlCountsAsCrudSuccess": False,
        },
        "coverage": {
            "sourceRoutes": 186,
            "legacyRoutesPreserved": 181,
            "concreteRoutes": 184,
            "fallbackRoutes": 2,
            "additionalRoutesOutsideSourceInventory": 21,
            "menuEntries": 35,
            "runtimeMenuScreens": 34,
            "runtimeMenuScreensMissing": ["/logout"],
            "runtimeActionsObserved": total_actions,
            "runtimeActionsExecuted": 0,
            "unverifiedLocalOrFormControls": len(unverified),
        },
        "outcomeCounts": dict(sorted(outcome_counts.items())),
        "actionClassificationCounts": dict(sorted(action_counts.items())),
        "unverifiedActions": unverified,
        "menuTrace": traces,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="replace the committed evidence")
    args = parser.parse_args()
    report = build_report()
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.write:
        OUTPUT.write_text(rendered)
    else:
        assert OUTPUT.exists(), f"missing evidence: {OUTPUT.relative_to(ROOT)}"
        assert OUTPUT.read_text() == rendered, "action trace is stale; run with --write"
    print(json.dumps({"result": "passed", **report["coverage"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
