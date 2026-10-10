# 보유기간 규칙 화면 연결 및 실제 CRUD 검증

2026-10-10. 전체 R16 도메인 완료 판정은 보류한다. 이 기록은 새 `/log/retention` 화면과 연결한 기존 PostgreSQL API의 부분 수용 증거다.

- 실제 HTTP 21개: 생성·상세·검색/페이지·수정·보관, 멱등 재전송, 동일 서비스 중복409, 과거 버전409, 보관 후 수정409와 이전 생성키410, 익명401·viewer403·다른 회사404. [결과](http-db.json)
- 별도 DB 조회로 60일/버전 갱신과 생성·수정·보관 감사기록을 확인했다. 첫 실행의 실패는 시험 요청에서 필수 Idempotency-Key를 빠뜨린 결과다. 해당 요청을 수정하고 필수키 누락400 검사도 추가했다. [최초 기록](http-db-failure.json)
- Ego Lite에서 새 규칙90일 생성, 다른 창100일 변경과 현재120일 저장 충돌, 입력 보존·최신 데이터 불러오기·미저장 이동 취소·120일 수정·보관을 직접 조작했다. [CRUD](browser/crud.json), [충돌](browser/conflict.json)
- 모바일 제목·필터·표 배치를 수정했다. 최종1440/768/390 CSS viewport에서 문서 가로넘침이 없고 표는 내부 스크롤한다. [배치 검사](browser/responsive-final.json), [모바일 화면](browser/retention-final-390.png)
- 실제 viewer 로그인으로 접근 차단, 임의 일반/보안 주소404를 확인했다. 서비스 권한 없는 viewer의 로그인 도착은 `/service/none`이다. [권한](browser/role-and-wildcards.json)
- dev PID21665에서 production PID45513으로 교체 후, 독립 Node 프로세스의 업무 데이터 대조 및 브라우저 세션·규칙·채널 삭제·월 마감 유지 검증을 통과했다. [전](db-before.json), [후](db-after.json), [브라우저](browser/restart.json)
- 새 경로 단위검사3개와 기존 retention-rules PostgreSQL검사5개 통과. [결과](unit-integration.json)

이후 폼 제출에 서비스 규칙이 적용되는 검증을 별도로 진행한다. 위 재시작 증거의 시각 이후 해당 시험 데이터의 규칙을 재활성화했으므로, 현재 데이터가 위 스냅샷과 항상 같다는 의미는 아니다. 실제 외부 제공사 시험은 포함하지 않았다.
