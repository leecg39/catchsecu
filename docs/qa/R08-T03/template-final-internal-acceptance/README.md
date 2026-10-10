# R08-T03 템플릿 남은 내부 수용

## 상태

`awaiting_delete_confirmation` — 대표 이미지 추가·교체·제거와 409 입력 폐기 확정은 통과했다. Ego Lite에서 합성 QA 템플릿 삭제 대화상자까지 확인했으며, 브라우저 UI 삭제 최종 클릭은 사용자 확인을 기다린다.

## 대상

- 템플릿 ID: `848956e8-b6f2-4099-94da-d84134a15663`
- 초기 제목: `QA F6 템플릿 내부수용 20261011-0235`
- 서버 최신 제목: `서버 확정본 QA 20261011 F6`
- 종류: 개발 DB에서만 사용하는 합성 QA 레코드

## 확인한 행동

1. Ego Lite에서 템플릿을 생성하고 제목·분류·설명·질문·동의 목적을 저장했다.
2. Ego Lite 확장의 로컬 파일 URL 권한이 꺼져 있어 파일 선택만 격리 브라우저에서 실행했다. 확장 권한은 변경하지 않았다.
3. `template-1.png`를 대표 이미지로 추가하고, Ego Lite 미리보기에서 대표 이미지 렌더를 확인했다.
4. Ego Lite에 저장하지 않은 `Ego Lite 보존 입력 20261011`을 남겨둔 뒤 다른 브라우저에서 서버 최신본을 저장했다.
5. Ego Lite 저장이 409로 거절되고 현재 입력이 유지되는지 확인했다.
6. `입력 폐기 후 최신본 적용` → `입력 폐기하고 적용`을 실제로 선택했다. 서버 제목이 적용되고 충돌 상태와 저장 잠금이 해제됐다.
7. `template-2.png`로 대표 이미지를 교체했다. PostgreSQL에서 이전 pin이 풀리고 이전 자산에 파기 유예 `expiresAt`이 설정되며 새 자산만 `template_thumbnail` pin을 보유하는지 확인했다.
8. 대표 이미지를 제거하고 저장했다. PostgreSQL에서 `thumbnailAssetId=null`, 참조 0개, 두 자산의 파기 유예 시간을 확인했다.
9. Ego Lite의 삭제 대화상자에서 닫기를 눌러 레코드가 유지되는지 확인했다. 다시 연 `템플릿 삭제 확인` 최종 클릭은 실행 전이다.

## PostgreSQL 결과

- 첫 자산: `addb9e07-c638-4295-9cf4-f317a91deae9`
- 교체 자산: `a6c41736-d3c1-4623-8fec-7d7608933878`
- 교체 후: 교체 자산만 `template_thumbnail` 참조를 보유했고 첫 자산은 파기 유예 상태로 변경됐다.
- 제거 후: 템플릿 version 5, `thumbnailAssetId=null`, 대표 이미지 참조 0개였다.
- 삭제 직전: `template.created` 1건과 `template.updated` 4건이 보존되어 있다.

## 회귀 검사

- `npm test -- tests/server/author-asset-references.test.ts tests/server/form-current-authority.test.ts tests/server/templates.test.ts`
  - Vitest가 존재하는 2개 파일을 실행했고 63개 시험이 통과했다.
- `npm run typecheck`: 통과
- `npm run verify:plan`: 통과, 기존 72개 작업 보존·순환 참조 0

## 증거

- `01-thumbnail-preview.png`: Ego Lite 대표 이미지 미리보기
- `02-conflict-input-preserved.png`: 409 후 현재 입력 보존
- `03-conflict-latest-applied.png`: 입력 폐기 확정 후 서버 최신본 적용
- `04-db-after-replace.json`: 대표 이미지 교체 후 pin·파기 유예
- `05-thumbnail-removed.png`: 대표 이미지 제거 후 편집 화면
- `06-db-after-remove.json`: 대표 이미지 제거 후 DB
- `07-delete-confirm-ready.png`: Ego Lite 삭제 확정 직전
- `08-db-before-delete.json`: 삭제 직전 템플릿·자산 참조·감사 이벤트

## 남은 게이트

- Ego Lite에서 합성 QA 템플릿 삭제를 확정한다.
- 목록 제거, PostgreSQL 레코드 0개, `template.deleted` 감사 이벤트를 확인한다.
- 실제 외부 결제 라이선스는 외부 자격증명 의존으로 `external_pending`을 유지한다.
