# 마케팅 수신동의·발송 제외 검증

검증일: 2026-10-03. P07-T02의 부분 구현 증거다. 전체 181경로·72 Task의 완료 보고서가 아니다.

## 구현

- 서비스·이메일/문자별 동의 등록·목록·상세·근거·변경 이력, 제외 설정, 개별/선택 철회, 개인정보 삭제, 필터·페이지·CSV·통계.
- 폼에 이름/채널 연락처 질문과 목적을 지정하고 별도 선택 동의를 수집한다. 일반 개인정보 동의와 이전 boolean 값으로 마케팅 동의를 만들지 않는다. 기존 CSV 응답은 별도 근거를 확인한 후 등록한다.
- 재동의는 기존 동의/철회보다 새로운 근거를 요구한다. 발송 제외와 정보주체 철회 차단을 임의로 풀지 않는다.
- 원본 정정·철회·보유 만료·실제 파기를 연결했다. 삭제는 마케팅 연락처/근거와 큐의 암호화 원문·실제 로컬 메일 파일을 제거하고 최소 차단 표식/이력만 남긴다.
- DB는 회사/서비스/출처 관계, 변경 버전·필수 이벤트·불변 이력·삭제 자료의 복원을 검사한다. 파기 대기는 일시 차단이며 취소 후 기존 유효 동의를 유지한다.
- 실제 전달 시점에 원본 응답·현재 동의 버전·채널별 제외·서비스·정보주체 차단을 잠금 안에서 다시 검사한다. 이메일과 SMS에 같은 판정 함수를 제공했다.
- owner/admin/privacy는 관리, sender는 조회. 현재 구성원과 서비스 권한을 매 요청에서 다시 검사한다.

## 자동 검증

| 검사 | 결과 | 근거 |
|---|---|---|
| 마케팅 PostgreSQL 통합 | 22/22 통과 | [로그](tests-scheduling.log) |
| 전체 PostgreSQL 회귀 | 256/256, 13개 파일 통과 | [로그](tests-all-final.log) |
| 타입 검사 | 통과 | [로그](typecheck-final.log) |
| 린트 | 오류 0, 기존 이미지 경고 19 | [로그](lint.log) |
| 최종 모바일 CSS 포함 프로덕션 빌드 | 통과 | [로그](build-mobile-fix.log) |
| API 명세 생성 | 177 경로 | [로그](openapi.log) |
| 계획 대조 | 181경로·34메뉴·72 Task, 순환 0 | [로그](plan-check-final.log) |

회귀 검사는 서비스/회사/채널 격리, 현재 권한, 입력·DB 제약, 멱등 등록/철회, 동시 수정, 검색·CSV 수식 무해화, 재동의, 실제 로컬 worker 전달/취소, 템플릿 질문 ID 재연결, 정정·만료·파기와 실제 메일 사본 제거를 포함한다. 전체 검사 후 변경한 CSS는 최종 빌드와 실제 390px 화면으로 확인했다.

## Ego 실동작

기존 Space30/p1과 localhost:3100 프로덕션 서버에서 합성 데이터만 사용했다.

1. [설정](01-form-config.png) → [공개 폼](02-public-consent.png) → [두 채널 수집](03-list-collected.png). 채널 체크박스는 [기본 미선택](browser-default-consent.json).
2. 동의 상태에서 실제 로컬 메일 전달을 [worker 결과](mail-delivered.json)로 확인했다.
3. 미래 실행 시각으로 큐를 등록 → 화면에서 [이메일 제외](04-excluded-detail.png) → [제외 커밋과 대기 상태 확인](queue-before-release.json) → 실행 시각 도달 처리 → [SUPPRESSED 취소·메일 파일 부재](queued-mail-blocked.json).
4. [두 채널 일괄 철회](05-bulk-withdrawn.png) → [이메일 개인정보 삭제](06-erased.png). 원본 응답은 유지했다.
5. [CSV 응답 근거 입력](07-csv-evidence-entry.png) → [등록 상세](08-csv-consent-detail.png) → [동일 필터 내보내기](09-filtered-export.png), [실제 CSV](filtered-export.csv).
6. [서버 재시작 후 3행 보존](10-restart-persistence.png), [통계](11-statistics.png)와 [API/화면 대조](browser-statistics.json): 동의 1·철회 1·삭제 1·제외 0·현재 발송 가능 1.
7. [390px 목록](12-mobile-list.png), [등록창](13-mobile-dialog.png), [측정](browser-mobile.json). 긴 선택 항목 때문에 발생한 가로 잘림을 수정했다. 최종 문서 폭 390px, 등록창 폭/스크롤 폭 모두 342px이며 모든 입력란이 안에 들어간다. 수정 전 증거는 before-mobile-fix/에 보존했다.

초기 두 차례 수동 큐 시험에서는 worker가 제외 저장보다 먼저 전달했다. [실제 시각 대조](browser-dispatch-order.json)에 그 순서를 남겼으며 이를 제외 후 차단 증거로 사용하지 않았다. 위 3번은 미래 실행 예약을 사용해 제외 커밋 이후의 전달 차단을 확인한 결과다.

[독립 DB·저장소 최종 대조](final-verification.json): 이메일 원문/근거 없음, 문자 철회, 원본 응답 유지, 관련 작업 4개의 payload 제거와 로컬 메일 파일 부재, 이후 마케팅 요청 차단, CSV 근거 암호화, 감사 이력에 연락처·근거 원문 없음.

## 범위와 남은 검증

원본은 빈 목록과 메뉴/열 문구까지 관찰했다. 비어 있지 않은 상세 상태 전이는 확인하지 못했으므로 [독립 구현 계약](PLAN.md)을 사용했다. 외부 SMTP 실제 수신, SMS 공급자 전송, 캠페인·발신자 CRUD는 후속 P08 작업이다. 이 단계의 로컬 전달이나 SMS 판정 함수 테스트를 외부 발송 성공으로 간주하지 않는다. 원문 파기 증명 범위는 현재 DB와 비공개 저장소이며 외부 수신자 사본·백업/WAL은 포함하지 않는다.

관련 코드: src/contracts/marketing.ts, src/server/marketing.ts, src/server/marketing-jobs.ts, src/server/jobs.ts, src/components/forms/Marketing.tsx, migrations 26~28, tests/server/marketing.test.ts.
