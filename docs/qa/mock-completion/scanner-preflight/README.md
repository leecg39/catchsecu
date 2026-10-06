# Mock 검증 전 파일 검사 서비스 점검

2026-10-07. 실제 전체 시험 시작 때 파일 검사 서비스가 꺼져 있어 첨부 시험들이 실패했다. scripts/verify-mock.mjs는 이제 마이그레이션·서버 시험 전 실제 파일 검사 서비스의 버전·서명 기한, 정상 파일 통과, EICAR 거절을 확인한다. 준비되지 않았으면 종료 코드1과 원인 코드가 기록되며 DB 검증을 시작하지 않는다.

[검증 결과](verification.json): 실제 서비스 정상 검사 종료0, 없는 소켓의 점검 종료1, 없는 소켓 설정으로 검증 도구를 실행한 결과 scanner 한 단계만 실패하고 마이그레이션·시험·공급자 검증은 실행되지 않았다. [의도된 거절 기록](missing-service/report.json)의 failed는 이 음성 시나리오의 기대 결과다. [린트](lint.log)와 [타입](typecheck.log) 통과.

새 결과를 이전 기록과 분리할 때 MOCK_VERIFICATION_EVIDENCE_DIR을 docs/qa/mock-completion 아래 새 폴더로 지정한다. MOCK_VERIFICATION_ENV_FILE은 비공개 .local 아래의 대체 시험 설정을 받을 수 있으며 기존 loopback catchsecu_test 제한을 유지한다. 검사 실패 재현에 쓴 비밀 설정은 Git에 저장하지 않았다. 기존 기록은 덮어쓰지 않았다.

대체 설정을 /etc/passwd로 지정하거나 증거 위치를 /tmp로 지정한 호출도 종료1로 거부했다. 실제 외부 파일을 읽거나 QA 밖에 결과를 만들지 않았다. [설정 제한](env-boundary.log) · [증거 제한](evidence-boundary.log).
