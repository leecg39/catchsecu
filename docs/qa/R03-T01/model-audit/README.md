# 회사·서비스·접근 요청 모델 대조

2026-10-10. 원본 계획의 R03을 기존 PostgreSQL 모델·DTO·실제 화면 필드와 대조했다. 신규 migration은 추가하지 않았다. 원본 유료 정상 화면의 완전한 동등성을 확인한 결과가 아니다.

`scripts/qa-rea-management-model.ts`는 dev/test를 각각 읽고 6모델·66컬럼·29제약·24인덱스를 기록한다. 회사 내 서비스명 unique, 멤버/서비스별 권한 unique, 접근 요청의 회사 복합FK 3개·RESTRICT 삭제, 대기 요청 partial unique와 상태 check를 실제 카탈로그에서 검사한다. 결과는 `catchsecu_dev.json`, `catchsecu_test.json`이다.

| 모델 | 화면/처리 필드 | 변경·보존 규칙 |
|---|---|---|
| Company | 회사명·공개명·주소·전화·웹사이트·사업자번호·청구이메일·청구담당자명/전화, version | 최초 등록과 정보 편집. 폐쇄는 사유 암호문·요청시각·요청자를 함께 기록하고 취소 시 함께 제거한다. 회사 즉시 삭제 API가 아니다. |
| Service | 회사FK·이름·외부 공개명·설명·유형·status·version | 생성/수정/보관/복원. 회사 내 같은 이름409. 업무 참조가 있으면 보관409. 서비스 레코드·기존 권한은 물리 삭제하지 않는다. |
| Membership | 회사/사용자·역할·상태·version·전문가 배정 | 현재 사용자/멤버 상태를 재검사한다. 접근 승인 시 현재 역할에 해당하는 서비스 권한을 만들고 멤버 version을 올린다. |
| ServiceGrant | 회사/멤버/서비스·capabilities | 승인 트랜잭션 안에서 생성한다. 취소/거절/실패에는 만들지 않는다. |
| AccessRequest | 서비스·요청자·사유·상태·version·검토자·답변·해결시각 | pending→approved/rejected/cancelled. 승인/거절은 다른 검토자, 취소는 본인. 동일 대기 요청 재전송은 기존 요청을 반환한다. 이력을 물리 삭제하지 않는다. |
| CompanyBusinessFile | 회사·암호화 파일명·mime·크기·해시·저장키·상태·검사엔진/시각 | 합성 PDF 실제 업로드·다운로드·교체·삭제 검증. 삭제 행은 파일명/키/해시/mime 제거·크기0을 DB check가 강제한다. |

실행 근거: [회사·서비스 권한 경계](../../R03-T02/authority/README.md), [접근 요청 권한 경계](../../R03-T02/access-authority/README.md), [회사/서비스 DB 수용](../../R03-T04/management-flow/README.md), [접근 요청 DB 수용](../../R03-T04/access-flow/README.md).

남은 범위: 회사 폐쇄의 운영 승인/최종 처리 정책, 최초 가입부터의 온보딩 전 과정, 전문가/라이선스 조합별 전체 화면 수용 및 원본 미관측 정상 화면 대조. R03 전체 완료로 집계하지 않는다.
