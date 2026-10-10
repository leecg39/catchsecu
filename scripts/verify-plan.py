"""Validate active plan coverage; this is not a runtime CRUD test."""
from pathlib import Path
from datetime import datetime, timezone
import json
import re
root = Path(__file__).resolve().parents[1]
def read(path): return json.loads((root / path).read_text())
active = read('docs/planning/active-plan.json')
source, matrix, tasks = [read(active[key]) for key in ['sourceRoutes', 'routeMatrix', 'tasks']]
legacy, additional = read(active['legacyTasks']), read(active['additionalRoutes'])
manifest, menu = read('src/data/route-manifest.json'), read('src/data/menu.json')
paths = {row['path'] for row in source}
by_id = {task['id']: task for task in tasks}
assert len(source) == len(paths), 'duplicate source routes'
assert paths == {row['path'] for row in matrix} == {row['path'] for row in manifest}, 'route coverage gap'
assert len(matrix) == len(manifest) == len(paths), 'duplicate route mappings'
assert len(by_id) == len(tasks), 'duplicate task IDs'
assert len({row['e2e_id'] for row in matrix}) == len(paths), 'duplicate E2E IDs'
assert {item['path'] for group in menu for item in group['items']} <= paths, 'unmapped menu'
assert {row['path'] for row in additional}.isdisjoint(paths), 'additional/source overlap'
assert all(row['task'] in by_id and row['gate'] in by_id for row in additional)
assert {key for task in tasks for key in task['legacy_tasks']} == {task['id'] for task in legacy}, 'legacy mapping gap'
visited, visiting = set(), set()
def visit(task_id):
    assert task_id not in visiting, 'dependency cycle: ' + task_id
    if task_id in visited: return
    visiting.add(task_id)
    for dependency in by_id[task_id]['dependencies']:
        assert dependency in by_id, 'unknown dependency: ' + dependency
        visit(dependency)
    visiting.remove(task_id)
    visited.add(task_id)
for task_id in by_id: visit(task_id)
models = set(re.findall(r'^model (\w+) ', (root / 'prisma/schema.prisma').read_text(), re.M))
for row in matrix:
    assert set(row['models']) <= models, 'unknown model: ' + row['path']
    assert all(row[key] in by_id for key in ['data_task', 'api_task', 'ui_task', 'gate_task'])
    assert row['screen_work'] and row['page_acceptance'] and row['actors']
    if '*' in row['path']:
        assert row['route_kind'] == 'fallback' and not row['api_operations'], 'wildcard cannot be CRUD page'
for task in tasks:
    assert task['scope'] and task['acceptance'] and task['files']
    assert set(task['dependencies']) == set(task['dependency_gates'])
    if task['status'] == 'completed':
        assert task['completion_evidence'], 'completed without evidence: ' + task['id']
        assert all((root / evidence).exists() for evidence in task['completion_evidence'])
output = root / 'docs/qa/R00-T01'
output.mkdir(parents=True, exist_ok=True)
report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'result': 'passed',
          'scope': 'active plan coverage and dependency validation only; not runtime CRUD acceptance',
          'sourcePaths': len(paths), 'concretePatterns': sum('*' not in path for path in paths),
          'fallbackPatterns': sum('*' in path for path in paths), 'additionalPatterns': len(additional),
          'taskCount': len(tasks), 'legacyTasksPreserved': len(legacy),
          'menuEntries': sum(len(group['items']) for group in menu), 'dependencyCycles': 0,
          'modelsReferenced': len({model for row in matrix for model in row['models']}), 'sourceRevisited': False}
(output / 'route-contract-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
(output / 'README.md').write_text('# R00-T01 active route and task coverage\n\n'
    'Source inventory, active plan and app manifest match. Wildcards remain fallback descriptors, not unrestricted page allowlist entries. '
    'All legacy tasks are mapped. Command: `python3 scripts/verify-plan.py`. Evidence: `route-contract-check.json`. '
    'This check proves plan consistency only, not runtime CRUD acceptance.\n')
print(json.dumps(report, ensure_ascii=False))
