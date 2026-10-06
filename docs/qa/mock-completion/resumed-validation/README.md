# 재개 후 회귀·개발 도구 감사

2026-10-07 계속 진행 요청에 따라 작업을 재개했다. 외부 공급자는 Mock으로 검증하며 원본 화면·실제 공급자 수용은 별도로 남긴다.

## 회귀

- 첫 전체 실행: 115파일·1,774개 중 1,761통과/13실패, skip0. 초기 파일 검사 서비스 부재로 campaigns 첨부 13개가 FILE_SCANNER_UNAVAILABLE(503)로 실패했다. first-full.log에 실패를 보존했다. 이 실행은 b9aae2에서 시작했으며 도중 문구/검증도구 후속 커밋이 있었다.
- 실제 ClamAV를 정상화한 뒤 campaigns 파일 81개를 재실행하여 모두 통과했다(campaigns-final.log). 정상 파일 허용·EICAR 거절을 scanner-health-final.json에 기록했다.
- 첫 실행의 나머지 114파일 1,693개와 재실행 1파일 81개, 총 고유 1,774개의 통과 근거를 연결한다. 단일 전체 실행 1,774개 통과로 표시하지 않는다.
- 시험이 갱신한 과거 lock-barriers 6개는 barriers 하위에 이번 실행 결과로 별도 보존했다. 기존 증거 파일은 원래 내용으로 유지했다.

## 의존성

- shadcn CLI는 실행 도구로 사용되지 않으나 globals.css가 패키지의 tailwind.css를 참조하고 있었다. CLI 제거 뒤 첫 빌드가 이를 탐지했다(build-before-css.log). 정확한 4.21.1 원본 CSS와 MIT 라이선스를 src/app/vendor/shadcn에 보존하고 import를 로컬 파일로 변경했다. CSS 바이트·SHA 일치는 css-provenance.json에 기록했다.
- CLI 및 개발 전용 220개 의존성을 제거했다. 남은 패키지 버전과 운영 패키지는 바뀌지 않았다(lock-change.json). Next.js/린트 도구를 이전 주 버전으로 내리지 않았다.
- 운영 npm audit: 0건. 전체 개발 도구 포함: high9→5, critical0. 남은 패키지는 braces·micromatch·fast-glob·@next/eslint-plugin-next·eslint-config-next다. runtime 0건을 전체 high 0건으로 표현하지 않는다.
- braces 공식 권고: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm . 확인 당시 3.0.3이 최신이며 수정 버전이 없다. 전체 high0 조건은 아직 충족하지 않는다.

타입·전체 린트 종료0. 최종 빌드 결과는 build.log 및 result.json에 기록한다. 브라우저 새 검사는 실행하지 않았으며 누적 화면 근거172/181·잔여9와 실제 외부/원본 수용 미완료를 유지한다.
