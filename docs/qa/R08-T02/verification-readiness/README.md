# F3 외부 본인확인·전자서명 준비 상태 검증

2026-10-11 현재 로컬 `sandbox` 어댑터의 challenge→서명 assertion→callback→영수증→제출 소비 흐름을 다시 확인했다. 화면은 로컬 테스트 성공과 외부 공급자의 공식 인증을 구분하며, 외부 공급자·운영 환경은 준비되지 않은 상태로 유지한다.

## 구현 결과

- 소비 전 `verified`와 제출에서 정상 소비된 `consumed` 인증 시도를 모두 `sandboxVerified` 근거로 계산한다. 제출 후 준비 상태가 거짓으로 돌아가지 않는다.
- 연동 설정 화면은 `enabled`를 “사용”으로 표시하고, 로컬 테스트 성공 여부와 외부 공급자 공식 검증 대기를 별도로 안내한다.
- 공개 폼은 인증 전과 완료 후 모두 `local sandbox` 테스트라는 사실과 외부 공급자의 공식 인증이 아니라는 문구를 노출한다.
- 외부 공급자 또는 `production` 환경을 `enabled`로 전환하는 기존 차단을 유지한다. 가상 성공을 운영 인증 완료로 저장하지 않는다.

## 검증 결과

| 구분 | 결과 |
|---|---|
| 인증 설정·흐름·화면 집중 시험 | 3파일 37개 통과 |
| 관련 게시·제출·파기 회귀 | 7파일 118개 통과 |
| 타입·변경 파일 린트 | 통과 |
| production build | 82/82 정적 페이지 생성 통과 |
| 계획 검증 | 107개 활성 작업, 의존 순환 0 통과 |
| 실제 브라우저 | 전자서명 완료 뒤 테스트 안내 유지, 제출 완료·접수 번호 발급 |
| PostgreSQL | `local`/`sandbox`/`signature`, attempt `consumed`, receipt와 submission 연결 확인 |

현재 브라우저 검증은 Ego Lite가 다른 작업에서 사용 중인 상태라 격리된 인앱 브라우저에서 실행했다. 이전 Ego Lite 전자서명 증거는 [P06-T06 기록](../../P06-T06/README.md)과 [서명 단계](../../P06-T06/states/signature-step.png), [제출 완료](../../P06-T06/states/signature-submitted.png)에 보존돼 있다. 이번 실행의 구조화 결과는 [verification-final.json](verification-final.json)에 기록했다.

## 상태 판정

- F3의 “제공사 준비 여부 표시·가상 성공 비공식 처리” 하위 조건은 완료했다.
- 실제 PASS·KG이니시스 등 외부 공급자의 자격증명, 허용 callback, 공식 sandbox 성공·실패·위조 검증은 `external_pending`이다.
- R08-T01~T04와 F3 전체는 다른 특수 질문·NLP/AI 분류·F4~F7 수용이 남아 `in_progress`다.
- 공식 전체 상태는 완료 0·진행 53·계획 54를 유지한다.
