# 개인정보 활동 검토 UI 검증

2026-10-04. P03-T03/P12-T01 부분 구현 후속이며 전체 Task 완료가 아니다. 모델/API 검증은 [이전 기록](activity-README.md)에 보존한다.

## 구현 및 실제 조작

- 처리로그에서 선택한 기록의 처리자에게 요청 등록; 마이페이지 받은/보낸/회사 전체 목록, 제목·상태·서비스·기간 필터와 서버 페이지, 상세 메시지 및 답변·처리 완료·취소를 연결했다.
- 화면 중복 클릭 방지와 동일 내용 재시도의 요청 키 유지, 409 발생 시 입력 보존·저장 차단·명시적인 최신 이력 재조회를 구현했다.
- Ego45/p1의 실제 UI로 owner 요청 → member 답변 → owner 처리 완료를 수행했다. 두 번째 요청은 member가 입력 중 별도 HTTP 답변으로 version을 바꿔 충돌을 유도했다. 오래된 입력은 보존되고 저장은 거부됐다. 최신 이력 조회 후 owner가 화면에서 취소했다.
- 로그인과 회사 선택은 시험 준비용 API로 수행했다. 출처 감사 기록은 합성 QA 데이터이며 실제 개인정보 열람 UI에서 발생한 기록이라고 주장하지 않는다.
- 총14건 중 페이지용11건은 직접 DB에 만든 합성 자료다. 두 번째 페이지4행/첫 번호11, 제목 검색1건, 취소 상태1건, 서비스B0건, 초기화14건을 확인했다. 기간 필터 UI는 구현했지만 이번 UI 시험에서 날짜 조작은 수행하지 않았다.
- 네트워크를 끊어 목록 새로고침의 한국어 오류를 확인한 후 온라인 복원·재조회로14건을 확인했다. 상세 네트워크 오류는 별도로 시험하지 않았다.
- 390×844에서 목록/상세 document scrollWidth=390을 확인하고 이미지를 검토했다. 표는 자체 가로 스크롤을 사용한다. 데스크톱1440×1000도 확인했다.

## 검증 자료

- production v14 빌드/타입 통과: [빌드 로그](activity-ui-build.log). 변경 TSX3개 lint 통과: [로그](activity-ui-lint.log). 서버/API 코드는 이전20개·관련다른21개 검증 이후 변경하지 않았다.
- [요청](activity-ui-created.txt), [답변](activity-ui-replied.txt), [처리 완료](activity-ui-resolved.txt), [취소](activity-ui-cancelled.txt).
- [충돌 및 입력 보존](activity-ui-conflict.json), [필터/페이지](activity-ui-filters.json), [오프라인 오류](activity-ui-network.txt), [모바일 크기](activity-ui-mobile.json).
- [처리 완료 이미지](activity-ui-resolved.png), [모바일 상세](activity-ui-mobile-detail.png), [모바일 목록](activity-ui-mobile-list.png).
- [독립 DB 재시작 전](activity-ui-db-before-restart.json) / [후](activity-ui-db-after-restart.json), [재시작 화면](activity-ui-restarted.txt).
- 새 UI 요청2건은 resolved/cancelled 각version3, 각각messages3/audits3/idempotency3이다. 거부된 충돌 초안은 DB에 없다. 원본 감사·요청·암호화 메시지·감사·요청 키·페이지 행 해시가 PID82384→89929 동일 빌드 재시작 전후 일치한다.
- [기계 판독 결과와 소스 해시](activity-ui-summary.json).

## 실행 환경과 한계

Node24의 `.local/recovery-production-v14`, customserver3115, ALLOW_LOCAL_MAIL=1. 최초 브라우저 연결 실패는 서버 준비 전 접근이었으며 동일 PID 준비 후 성공했다. 이전 자체3114 서버는 종료했고 사용자3100은 유지했다.

실행: `node24 --env-file=.env.local --import tsx .local/activity-ui-state.ts before-restart|after-restart`. 합성 페이지 생성 스크립트 `.local/activity-ui-pages.ts`는 중복 실행을 거부한다. 자격증명은 `.local/`에만 보관한다. 외부 발송은 하지 않았다.

독립 검토 흐름의 이메일 알림·보유 정책, 원본 정상 동작 대조와 전체 Task 공통 게이트는 남아 있다. 공식 완료15·진행21·계획36 유지. 전체57개 목표는 계속 진행 중이다.
