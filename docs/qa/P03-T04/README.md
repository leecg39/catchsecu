# P03-T04 서비스 표시 동의·재위탁

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

## 개요

서비스 내 동의서 및 처리방침 연결, 재위탁 수탁자(Subprocessor) 관리 및 재위탁 발생 시 공지 메일 발송 큐잉을 구현한다.

## 구현 내용

1. **엔드포인트**:
   - `GET /api/v1/services/[id]/subprocessors`: 재위탁 수신자 목록
   - `POST /api/v1/services/[id]/subprocessors`: 재위탁 수신자 등록 (이메일 암호화 저장 및 해시 인덱싱)
   - `PATCH /api/v1/services/[id]/subprocessors/[subId]`: 재위탁 수신자 정보 수정 및 보관
   - `GET /api/v1/services/[id]/subprocessor-notices`: 재위탁 안내 발송 이력
   - `POST /api/v1/services/[id]/subprocessor-notices`: 재위탁 공지 발송 (Outbox 큐잉)
2. **보안 및 무결성**:
   - 타 회사 및 권한 없는 구성원의 접근 차단 (403/404)
   - 동일 서비스 내 동일 수신자 중복 등록 차단 (409)
   - 보관된(`archived`) 수신자에 대한 안내 발송 차단
   - 동일한 내용의 중복 발송 시 409 차단 및 멱등키 보장
   - Outbox Mail Job 생성 시 중복 키 방어 및 페이로드 암호화

## 검증 내역

- 테스트 스위트: `tests/server/subprocessor-notices.test.ts`
- 주요 검증 항목:
  - 타 회사 및 editor 권한의 수신자 등록 차단
  - 수신자 등록 및 중복 등록 409 거부
  - 공지 발송 멱등키 재전송 시 동일 결과 반환
  - 동일 공지 중복 발송 409 거부
  - Outbox `Job`에 정확한 수신자 및 본문 큐잉 확인
  - 발송 이력 정상 조회 및 내부 암호화 필드 비노출

2026-10-04 추가 구현: [발송 이력 재검증](revalidation/README.md). 실제 Job 상태·과거 주소·서버 페이지 보완, 관련41개·Ego/DB/재시작 통과. Task는 in_progress이며 전체 게이트는 미완료다.

후속: [수신자 관리 화면 검증](revalidation/recipient-README.md). 등록/수정/보관/복원·검색/서버 페이지·103번째 선택·충돌 복구·발송 전 주소 버전 검사, 관련44개 및 Ego/DB/새 프로세스 유지·모바일 overflow 보완을 확인했다.
