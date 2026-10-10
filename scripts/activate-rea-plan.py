from pathlib import Path
import json
import shutil

root = Path(__file__).resolve().parents[1]
source = root.parent / 'outputs/catchsecu-fullstack-plan-2026-10-09'
destination = root / 'docs/planning/09-rea-fullstack'
destination.mkdir(exist_ok=True)
for name in ['README.md', 'TASKS.md', 'tasks.json', 'domains.json', 'route-matrix.json', 'route-matrix.csv',
             'route-matrix.md', 'data-models.md', 'api-ui-spec.md', 'scope-gaps.md', 'acceptance.md',
             'external-integrations.md', 'model-ownership.json', 'api-ownership.json', 'additional-routes.json']:
    if not (destination / name).exists():
        shutil.copyfile(source / name, destination / name)
for name in ['objectives.md', 'progress.md', 'blockers.md', 'timeline.md']:
    target = destination / '.Codex/goals' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        shutil.copyfile(source / '.Codex/goals' / name, target)

routes = json.loads((root.parent / 'outputs/catchsecu-reverse-2026-10-09/route-coverage.json').read_text())
(destination / 'source-routes.json').write_text(json.dumps(routes, ensure_ascii=False, indent=2) + '\n')
manifest_file = root / 'src/data/route-manifest.json'
manifest = json.loads(manifest_file.read_text())
existing = {row['path'] for row in manifest}
by_path = {row['path']: row for row in routes}
new_routes = [('/log/retention', '보유기간 규칙'), ('/login/gpki/callback', 'GPKI 인증 결과'),
              ('/login/saeol/callback', '새올 인증 결과'), ('/*', '알 수 없는 경로'),
              ('/security/*', '알 수 없는 보안 경로')]
for index, (path, label) in enumerate(new_routes, 182):
    if path in existing:
        continue
    row = by_path[path]
    manifest.append({'id': index, 'category': row['category'], 'name': label, 'path': path,
                     'sourceUrl': 'https://app.catchsecu.com' + path, 'dynamic': False,
                     'status': 'static-declaration', 'requiresFixture': True,
                     'statusLabel': '최신 원본 정적 경로 확인·실제 동작 검증 중', 'sourceObserved': False,
                     'evidence': ['docs/planning/09-rea-fullstack/source-routes.json'], 'observedUrl': '',
                     'limitation': row['reason'], 'routeKind': 'fallback' if '*' in path else 'page'})
manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
active = {'version': 'rea-2026-10-09', 'activatedOn': '2026-10-10',
          'directory': 'docs/planning/09-rea-fullstack',
          'tasks': 'docs/planning/09-rea-fullstack/tasks.json',
          'sourceRoutes': 'docs/planning/09-rea-fullstack/source-routes.json',
          'routeMatrix': 'docs/planning/09-rea-fullstack/route-matrix.json',
          'additionalRoutes': 'docs/planning/09-rea-fullstack/additional-routes.json',
          'legacyTasks': 'docs/planning/tasks.json', 'legacyRouteMatrix': 'docs/planning/03-route-matrix.csv',
          'legacyScope': '2026-10-02 181개 경로 및 기존72작업 이력; 최신 전체완료 기준 아님'}
(root / 'docs/planning/active-plan.json').write_text(json.dumps(active, ensure_ascii=False, indent=2) + '\n')
menu_file = root / 'src/data/menu.json'
menu = json.loads(menu_file.read_text())
for group in menu:
    if group['label'] == '개인정보 모니터링' and not any(item['path'] == '/log/retention' for item in group['items']):
        group['items'].append({'label': '보유기간 규칙', 'path': '/log/retention'})
menu_file.write_text(json.dumps(menu, ensure_ascii=False, indent=2) + '\n')
headers = {
    'TASKS.md': '# 2026-10-10 활성 구현 계획\n\n[최신 전체 TASKS](docs/planning/09-rea-fullstack/TASKS.md): 186개 원본 경로·20개 부가 경로·107개 작업. 사용자 승인에 따라 구현·검증을 재개했다. 실행 상태의 기준은 `docs/planning/active-plan.json`이다. 아래72개 작업은 기존 이력으로 보존하며 신규 작업과 이중 합산하지 않는다.\n\n',
    '.Codex/goals/progress.md': '# 2026-10-10 전 페이지 구현 재개\n\n[활성 계획](../../docs/planning/09-rea-fullstack/TASKS.md)의 107개 작업을 추적한다. 기존72개 상태는 이력으로 보존한다. 현재 R00 기준선 통합과 누락 경로 연결을 진행 중이다.\n\n',
    'docs/IMPLEMENTATION-STATUS.md': '# 2026-10-10 최신 전체 계획 구현 중\n\n186개 원본 경로를 기준으로 [107개 작업](planning/09-rea-fullstack/TASKS.md)을 활성화했다. 기존 결제 수정과 검증 자료를 보존한다. 아직 전체완료가 아니며 서버·브라우저·외부검증을 다시 기록한다.\n\n',
}
for name, header in headers.items():
    path = root / name
    current = path.read_text()
    if not current.startswith(header):
        path.write_text(header + current)
print(json.dumps({'sourceRoutes': len(manifest), 'legacyTasksPreserved': True}))
