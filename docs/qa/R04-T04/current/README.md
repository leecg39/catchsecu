# R04-T04 구성원·초대·권한·전문가 수용검증

2026-10-11 현재 로컬 PostgreSQL·production 서버·Ego Lite에서 내부 수용을 다시 실행했다. 공식 SMTP와 외부 SSO 공급자 자격증명은 없어 외부 검증은 `external_pending`으로 유지한다.

## 내부 수용 결과

- 합성 회사의 구성원·초대·서비스 권한·전문가 배정·감사·메일 outbox를 독립 PostgreSQL 조회로 검증했다.
- 도메인 변경 감사 33건, 로컬 메일 전달 4건, 최종 HTTP 12건을 확인했다. fresh 재로그인 구성원은 허용 서비스에 접근했고, 제거 전 세션은 401로 유지됐다.
- 로그인·화면 조회가 추가하는 `session.*`·`analytics.*` 감사를 재시작 지문에서 분리했다. 변경 도메인 상태 지문 `109076f46de9dbd95bc77834245330f41ef2209d2cd742424aa67dc8a9061312`는 서버 재시작 전후 동일했다.
- Ego Lite 로그인 세션은 서버 재시작 후 `/set/member?pageSize=10`에서 구성원 2명·1/1페이지를 다시 표시했고 콘솔 오류는 0건이었다.
- 별도 브라우저 프로필은 같은 주소에서 로그인 화면으로 이동해 세션 격리를 확인했다. 합성 계정 5개의 fresh 로그인과 재시작 후 세션 영속성은 HTTP 수용검증에서 확인했다.
- R04 서버·UI 회귀 12파일 249개, TypeScript, 변경 스크립트 ESLint, 전체 ESLint 오류 0건, production build 82페이지가 통과했다.

## 외부 대기

로컬 메일 어댑터는 검증했지만 실제 SMTP 받은편지함 영수증은 없다. Google·Microsoft·기관 SSO의 공식 왕복도 R07 공급자 자격증명이 필요하다. 외부 공급자 성공을 주장하지 않으며 R04-T04는 모든 외부 증거가 확보될 때까지 완료로 올리지 않는다.

## 증거

- [재시작 수용 요약](acceptance-summary.json)
- [재시작 전 기준 상태](../members-flow/current-baseline.json)
- [재시작 후 동일 상태](../members-flow/current-after-restart.json)
- [브라우저 재시작·격리](browser-restart.json)
- [회귀·품질 게이트](quality-gates.json)
- [외부 대기 목록](external-pending.json)
- [전체 구성원 흐름](../members-flow/README.md)
