"""Update only the active REA execution plan; preserve legacy work records."""
from pathlib import Path
import json
import shutil

root = Path(__file__).resolve().parents[1]
plan = root / 'docs/planning/09-rea-fullstack'
original = root.parent / 'outputs/catchsecu-fullstack-plan-2026-10-09'
(plan / 'snapshots').mkdir(exist_ok=True)
for name in ['prisma-models.json', 'api-operations.json']:
    if not (plan / 'snapshots' / name).exists():
        shutil.copyfile(original / 'snapshots' / name, plan / 'snapshots' / name)
if not (plan / 'baseline.json').exists():
    shutil.copyfile(original / 'baseline.json', plan / 'baseline.json')

notes = {
    'R00-T01': '최신186경로·manifest 일치, fallback2개와 부가20경로 분리. 전체 메뉴 action 대조 진행.',
    'R00-T02': '전체 서버 회귀시험 실행 중. 모델·계약·핸들러·화면 코드 재대조.',
    'R00-T03': 'active-plan.json 및 root TASKS/goals 연결. 기존72개 작업과 결제 수정 보존.',
    'R00-T04': '보유기간·채널·월마감용 독립 dev회사A/B와 허용/거부 사용자 fixture 생성.',
    'R16-T01': 'RetentionRule 기존 스키마·관계·적용 우선순위 재사용 확인. 파기 전체 수용은 남음.',
    'R16-T02': '보유기간 HTTP·독립DB21개 통과. 파기 모듈 전체 수용은 남음.',
    'R16-T03': '규칙 CRUD UI·경로·메뉴 연결. 생성과 충돌 시 입력 보존을 Ego에서 확인.',
    'R16-T04': '실제HTTP21개 통과. 브라우저 및 재시작 수용 검증 진행.',
    'R19-T03': '누락된 channels 경로를 기존 채널 CRUD 컴포넌트에 연결. 다른 경로 검증 예정.',
    'R23-T03': '월마감 경로를 실제 집계마감 컴포넌트에 연결. 브라우저 검증 예정.',
}
tasks_file = plan / 'tasks.json'
tasks = json.loads(tasks_file.read_text())
for task in tasks:
    if task['id'] in notes and task['status'] != 'completed':
        task.update(status='in_progress', progress_note=notes[task['id']], updatedOn='2026-10-10')
tasks_file.write_text(json.dumps(tasks, ensure_ascii=False, indent=2) + '\n')

readme = plan / 'README.md'
text = readme.read_text().replace(
    '2026-10-09 · **계획 작성 완료 / 애플리케이션 구현은 이번 단계에서 변경하지 않음**',
    '2026-10-10 · **사용자 승인 후 구현·검증 진행 중**\n\n원본 계획은 outputs에 보존했다. 이 복사본과 tasks.json이 활성 실행 기준선이다. 증거는 저장소 docs/qa/Rxx-Tyy에 기록한다.')
text = text.replace('(validation.json)', '(../../qa/R00-T01/route-contract-check.json)')
text = text.replace('이 문서의 107개 구현 Task는 모두 계획 상태다. 이번에 통과한 것은 **계획의 누락·의존성·참조·원본 파일 보존 검사**이며 기능 테스트가 아니다.',
                    '현재 실행 상태는 tasks.json과 .Codex/goals/progress.md를 따른다. 계획 검산과 실제 기능 검증은 분리해 기록한다.')
text = text.replace('기존 파일 보존 지문은 `snapshots/source-hashes.json`에 있다.', '계획 작성 당시 기존 파일 보존 지문은 원본 outputs 폴더의 `snapshots/source-hashes.json`에 있다.')
readme.write_text(text)
task_markdown = plan / 'TASKS.md'
text = task_markdown.read_text().replace(
    '작성일: 2026-10-09. **계획만 작성. 이 문서의 구현 Task는 아직 실행하지 않았다.** 기존 코드·진행상태는 보존한다.',
    '계획일: 2026-10-09. 실행 시작: 2026-10-10. **사용자 승인 후 구현·검증 중.** 기존 코드·진행 이력을 보존하며 새 증거를 추가한다.')
for task_id in notes:
    text = text.replace('### [ ] ' + task_id, '### [~] ' + task_id)
task_markdown.write_text(text)
(plan / '.Codex/goals/progress.md').write_text('''# 실행 진행판 — 2026-10-10

사용자 승인으로 구현·검증을 재개했다. 기존 백엔드를 재사용하면서 확정된 연결 누락과 보유기간 화면을 보완한다. 선행 작업은 과거 구현 증거를 재검증 중이며 완료로 일괄 승계하지 않는다.

- 진행10/107·완료0/107. 전체 수용조건을 충족한 작업만 완료한다. 기존72개 중 완료17 기록은 별도 이력이다.
- 활성186경로·fallback2개·부가20경로·107작업의 연결과 의존성 검사 통과.
- 보유기간 실제HTTP21개·독립DB·감사로그 확인. 브라우저/재시작 수용 진행.
- 알림톡 채널·월마감 메뉴 경로 연결.
- 전체 서버 회귀시험 진행 중.
- 실제 외부 공급사·기관 시험은 아직 수행하지 않음.

세부 상태는 [tasks.json](../../tasks.json), 증거는 저장소 docs/qa/Rxx-Tyy를 따른다.
''')
print(json.dumps({'inProgress': sum(task['status'] == 'in_progress' for task in tasks), 'completed': sum(task['status'] == 'completed' for task in tasks)}))
