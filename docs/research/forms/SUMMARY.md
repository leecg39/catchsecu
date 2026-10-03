# 폼·동의서 조사 결과

- 총 25개: 정상 화면 6개, 유료 제한 10개, 워크플로 상태 필요 6개, 유효 ID 없음 3개.
- 정적 22개 모두 실제 경로 방문. 안정 대기 후 상세 JSON을 재추출한 대표 6유형에는 desktop1440/tablet768/mobile390 근거가 있음.
- /form/ai/create 는 최초 blank 과도 상태를 지나 실제 폼 에디터가 표시됨. create-detail.json 사용.
- 최초 단순 경로 캡처의 "잘못된 접근입니다." 알림은 이전 라우트에서 남은 toast일 수 있음. 상세 JSON을 우선 사용.
- /basic/* 7개 전부 현재 무료 계정에서 "접근할 수 없습니다. 유료 라이선스에 제공되는 기능입니다. 라이선스 구독 후 사용하실 수 있습니다."
- /form/info-upload* 3개 유료 구독 안내 화면.
- /form/ai/{recipient,agreement,setting} 직접 접근은 원본 오류 경계. /form/ai/{set,share,basic-frame/v3}는 워크플로 상태가 없어 접근 불가. 정상 내부 화면을 관찰했다고 주장하지 않음.
- /form/manage/applicant 관련 3개는 캐치폼 0건으로 실제 ID 미확보. 추측 ID 요청 안함.
- 생성/저장/다음/발송/삭제 등 원본 서버 쓰기 없음.

## 공통 스타일

Noto Sans KR. heading24px/700/33.6px #202327, section20px/700/28px #484e55. 기본 버튼 height40 padding12 radius4 bg#6558ff transition .15s cubic-bezier(.4,0,.2,1).
템플릿 카드 bg#fbfbfc border1px #e7e9ed radius10. Grid gap24, 1440=3열,768=2열,390=1열. 카드 제목16px/700/22.4px.

## 컴포넌트 계약

7개 *.spec.md (34~150줄), template-content.json 실제 템플릿 데이터, routes.json 경로별 조사상태.
공통 타입 권장: TemplateItem{title,description,image}; FormEditorQuestion{id,type,label,required}; GateKind='basic'|'upload'; WorkflowUnavailable route.

## 검증 제약

모든 상태·버튼을 완전 조사하지 않음. MarketingConsentList 모바일 추가 조사 필요. 실제 인증/전자서명 및 다단계 저장 뒤 화면은 서버 데이터 필요하므로 로컬 데모와 구별해야 함.
