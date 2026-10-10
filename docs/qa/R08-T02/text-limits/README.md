# F3 입력 길이 제한 체크포인트

2026-10-10. 새 질문의 단문100자·장문1000자 기본값과 버전별 최대 글자 수를 모델·CRUD·편집·공개 제출·정정·템플릿에 연결했다. F3 및 전 페이지 전체 목표는 계속 진행 중이다.

## 관측과 구현 계약

원본 번들 SHA256 `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`, REA `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`에서 TEXTBOX100·TEXTAREA1000의 **입력 UI maxLength**를 확인했다. 원본 서버의 강제 제한은 미관측이다. [UTF-16 오프셋·발췌·추가 유형 분석](source-observations.json).

독립 구현은 nullable `Question.textMaxLength`를 버전에 저장한다. 새 UI 질문 생성/유형 변경에서만100/1000을 지정하고, 명시 설정은 단문1~1000/장문1~20000까지 허용한다. 수정 가능한 길이 설정은 독립 구현 선택이며 원본에서 관측한 편집 기능이라고 주장하지 않는다. 다른 유형의 길이 설정,0·음수·소수·상한 초과는 계약/DB에서 거절한다. DB 기본값이나 과거 게시본 백필은 없다.

기존 null은 단문1000/장문20000을 유지한다. 조회 DTO는 null 키를 생략해 구 승인 지문을 보존한다. 길이만 변경해도 같은 질문 행에 저장되고 승인 지문은 변경된다. 설정 제거는 null로 저장되며 이전 지문으로 돌아온다. 복사·템플릿·개정은 해당 설정을 보존한다. 정정은 응답 당시 게시본의 규칙을 검사한다.

브라우저와 서버는 JavaScript UTF-16 길이 단위를 사용한다. 이모지1개는2단위이며 원본 HTML maxLength와 같은 단위다. 이름·이메일의 기존 서버 검증은 trim 후 역할별 상한을 유지한다. 독립 검토에서 역할 상한을 원문 길이에 적용하는 회귀를 발견해 일반 길이 검사와 분리했다. 기존 공백 포함 이름/이메일의 제출 및 다른 질문 정정/원문 보존 테스트를 추가했다. [검토 기록](review.json).

## 검증

- [도입 전](before.json):5개 중1통과·4실패. 신규 계약 미지원 재현이며 보안 취약점 재현이라는 뜻은 아니다.
- [첫 구현](after.json):5파일89개 통과(질문 ID·규칙·가져오기·정보주체 포함).
- [최종](final-after-space.json):4파일38개 통과(새 길이6개·EXACT·내보내기·승인 포함). 이전89개와 중복되므로 합산하지 않는다.
- [타입](typecheck-final-after-space.log), [변경 파일 린트](lint-final-after-space.log), [최종 빌드](build-final-after-space.log):exit0, 린트 오류/경고0. 후속 QA 도구 변경은 별도 최종 helper 검사로 확인한다.
- [113개 새 빈 스키마 설치](fresh-schema.json), [개발/시험 스키마](schema):예상밖 차이0.
- [마이그레이션 전](migration-before.json)/[후](migration-after.json):8테이블의 모든 기존 행·컬럼 해시 동일. 새 컬럼은 모든 기존 질문에서 null임을 별도로 단언한 후 기존 컬럼만 비교했다.

OpenAPI DTO도 새 길이 필드를 포함하도록 다시 생성했다. 최초 생성은 환경 파일 누락으로 실패했고(`openapi-generation.log`), `.env.local`을 로드한 [재실행](openapi-generation-final.log)은 성공했다. 이 실패는 런타임 변경을 일으키지 않았다.

실제 HTTP12개(prepare4,publish4,verify-flow1,final-http3). 길이 설정 저장/게시/조회, N+1 공개 응답/정정 거절을 검증했다. 가입 이메일의 검증 상태는 QA 준비로 DB에 지정했으며 외부 이메일 수신 증거가 아니다.

Ego에서 기존1000/20000 조회→100/1000 변경·저장, 새 단문100/장문1000 기본값, 날짜 변경 시 설정 제거, 새 질문 삭제를 실제 조작했다. 공개 입력에101/1001자를 붙여 넣었을 때100/1000자로 제한되며 실제 제출됐다. DB의 암호화 답변을 독립 복호화해 길이를 대조했다. 정정 초과 입력은 응답 버전/정정 행을 변경하지 않았다. [편집](flow/browser-editor.json), [공개 입력·세 폭·Tab](flow/browser-public.json), [DB 응답](flow/responses.json), [화면](flow/public-boundary.png). 편집/공개390·768·1440px에서 양수 가로 넘침이 없었다. 정정 화면 자체의 이번 길이 설정 조작은 별도로 실행하지 않았으며 API 정정과 공용 입력 컴포넌트를 확인했다.

최종 production 서버57719를 종료하고 새 프로세스로 재시작한 후 Ego 설정100/1000과 폼1·응답1·감사7건의 해시 `aae28c053ec57e2b13ceb5f93391181da7bd31f3fe51c4c5f487165a3b4737d2`가 유지됐다. [동결](flow/freeze.json), [재시작 DB](flow/verify.json), [Ego](flow/browser-after-restart.json). 기존 F1/F2/EXACT/SSO6세트도 읽기 전용 보존 검사에 통과했다. pre113 질문 스냅샷은 새 컬럼 null을 단언하고 그 컬럼만 제외해 원래 해시와 대조하며 기준 해시는 다시 쓰지 않았다.

## 실패 기록과 다음 작업

추가 테스트/타입·린트 실행 및 재빌드 중 디스크 공간 부족이 발생했다. `final.log`, `build-final.log` 등 실패를 보존하고 성공으로 집계하지 않았다. 중지된 이번 작업의 ignored build cache만 정리한 뒤 재실행했다. 소스·DB·compiled output·QA·private fixture를 삭제하지 않았다. [정리 경로와 바이트](cache-cleanup.json).

Ego 완료 문구 대기에서는 ‘제출되었습니다’를 찾았지만 실제 문구는 ‘제출이 완료되었습니다.’였다. 현재 화면과 DB의 기존 응답1건으로 성공을 확인했고 재제출하지 않았다. [기록](flow/browser-wait-note.json).

원본 CONTACT/EMAIL의 UI 객체→문자열 직렬화, EMAIL_DIRECT/BIRTH 문자열, FOREIGN_ADDRESS 객체, DRAW 파일 참조는 분석했으나 아직 구현 완료가 아니다. 설명·개인정보 분류는 단일 enum이 아니라 탐지 항목과 출처를 포함하는 원본 계약을 추가 검토한다. 임의 정규식·특수 유형·첨부·페이지 이동·외부 본인확인 및 전체 수용은 남아 있다.

재현: 격리 `.env.test.local`에서 `tests/server/question-text-limits.test.ts` 등을 직렬 실행한다. 동결된 흐름은 `node --env-file=.env.local --import tsx scripts/qa-rea-text-flow.ts verify`만 실행한다.
