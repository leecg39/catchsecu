# R07 현재 화면 보완

SSO 공급자 목록의 검색·정렬·페이지를 URL에서 복원하도록 수정했다. 실제12개 fixture의2페이지에서 새로고침 전후 같은2행을 유지하고 빈 검색·뒤로 가기 입력 복원을 Ego Lite에서 확인했다. [이전 결함](list-reload-before.json), [수정 후 검증](list-url-after.json).

목록과 편집창은390/768/1440px에서 가로 넘침이 없다. [6개 폭 검증](provider-widths.json), [390px 편집창](provider-editor-mobile.png).

`/oauth2/signup`은 검증된 이름·이메일·초대 회사명을 읽기 전용으로 표시하고 연령·약관·개인정보 동의를 받는다. 동의 전 제출 차단, 키보드 전체 동의, 새로고침 복원과 체크 초기화, 네트워크 실패 입력 보존, 취소·만료·위조 직접 진입·재로그인을 [가입 검증](../../R07-T04/signup/README.md)에서 확인했다. 성공 후 실제 화면 이동까지 중복 제출 잠금을 유지한다.

기존 전체 경로·인증 여정 증거는 R07-T04의 각 과거 폴더에 보존했다. native beforeunload 새로고침 취소, 모든 정상 인증/역할/라이선스 조합과 실제 외부기관 수용은 이번 검증으로 완료 주장하지 않는다.

최종 production 빌드에서도 자동화 reload는 native dialog를 노출하지 않았다. [관측](native-reload-observation.json)은 사람의 새로고침 취소 성공으로 집계하지 않는다.
