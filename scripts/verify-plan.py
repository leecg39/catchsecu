from pathlib import Path
import csv, json, re
from datetime import datetime, timezone
from collections import Counter
root = Path(__file__).resolve().parents[1]
def csvread(path):
    with path.open(encoding='utf-8-sig') as f: return list(csv.DictReader(f))
source = csvread(root.parent / 'outputs/catchsecu-pages/catchsecu-pages.csv')
matrix = csvread(root / 'docs/planning/03-route-matrix.csv')
coverage = csvread(root / 'docs/research/route-coverage.csv')
manifest = json.loads((root/'src/data/route-manifest.json').read_text())
tasks = json.loads((root/'docs/planning/tasks.json').read_text())
menu = json.loads((root/'src/data/menu.json').read_text())
paths = {r['path'] for r in matrix}
assert len(source) == len(matrix) == len(manifest) == 181
assert len(paths) == 181
assert paths == {r['경로'] for r in source} == {r['path'] for r in manifest} == {r['path'] for r in coverage}
assert len({r['test_id'] for r in matrix}) == 181
assert {r['task_id'] for r in matrix} <= {t['id'] for t in tasks}
menus = [i for group in menu for i in group['items']]
assert {m['path'] for m in menus} <= paths
visited, active = set(), set()
byid = {t['id']: t for t in tasks}
def visit(t):
    assert t not in active, 'dependency cycle'
    if t in visited: return
    active.add(t)
    for d in byid[t]['dependencies']: visit(d)
    active.remove(t); visited.add(t)
for task in byid: visit(task)
unknown = [r for r in coverage if r['status'] != 'source-based']
for row in matrix:
    assert all(row[key] for key in ['models','actor_scope','acceptance','common_checks','api_contract'])
out = root/'docs/qa/P00-T01'
out.mkdir(parents=True, exist_ok=True)
report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'result': 'passed',
          'paths': len(paths), 'menuEntries': len(menus), 'missingPaths': [],
          'uniqueTestIds': 181, 'taskCount': len(tasks), 'dependencyCycles': 0,
          'sourceStatus': dict(Counter(r['status'] for r in coverage)),
          'sourceLimitations': len(unknown), 'sourceRevisited': False}
(out/'route-contract-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
(out/'README.md').write_text('''# P00-T01 경로·계약 대조
원본 CSV, 라우트 manifest, 조사 근거 CSV, 구현 계획 CSV의 181개 경로가 정확히 일치한다. 메뉴 항목은 모두 이 집합에 포함된다. 각 행에 모델·API·권한·정상/오류/권한 거부 검증 조건과 고유 E2E ID가 있다.

실행: `python3 scripts/verify-plan.py`. 결과: `route-contract-check.json`.
이 검사는 경로와 계약의 완전성을 검사한다. 181개 CRUD 동작 시험을 통과했다는 의미는 아니다.

## 원본 상태가 확인되지 않은 범위
기존 조사자료를 재검토했다. 아래 경로의 정상 동작은 관찰하지 못했으며, 계획 CSV의 독립 구현 계약을 사용한다. 기능을 실제 시험할 때까지 완료로 표시하지 않는다. 문서 P/C/OC 약어의 원본 의미, 기관 인증과 결제 공급자 계약은 별도 결정이 필요하다.

| 경로 | 관찰 분류 | 독립 구현 작업 |
|---|---|---|
'''+'\n'.join('| `'+r['path']+'` | '+r['status_ko']+' | '+next(m['task_id'] for m in matrix if m['path']==r['path'])+' |' for r in unknown)+'\n')
print(json.dumps(report, ensure_ascii=False))
