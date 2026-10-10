# 파일 검사 서비스 복구 검증

2026-10-10. 파일 API는 검사 서비스를 사용할 수 없을 때503으로 차단한다. 최초 전체 시험의 파일 fixture들이 이 조건에 걸렸다. 공식 소스를 사용자 폴더에 빌드해 현재 복구했고, 관리자 설치 요청은 더 이상 필요하지 않다.

기존 `.local/tools/clamav/bin/freshclam`은 `codesign --verify`에서 `invalid signature`이며 실행 시137로 종료됐다. `.local/tools/clamav-1.5.4.pkg`는 Cisco 배포 인증서 및 Apple 공증이 유효하다. [패키지 서명](package-signature.txt), [별도 복원한17개 원본의 코드서명과 SHA-256](signatures.json).

원본 프로그램은 `/usr/local/clamav/lib`를 사용한다. 별도 복원본은 코드서명이 유효하지만 정식 경로가 없어 실행되지 않는다. `sudo -n installer`는 관리자 암호가 필요하여 종료했다. 사용자에게 이 패키지의 정식 설치를 요청했고, 실행파일 서명을 다시 쓰거나 macOS 검증을 끄지 않았다.

## 복구 결과

[ClamAV 공식 소스 설치 문서](https://docs.clamav.net/manual/Installing/Installing-from-source-Unix.html)에 따라1.5.4 공식 배포 소스의 GPG 서명을 확인한 뒤 별도 사용자 경로에 설치했다. 공식 키 지문은 `5BADCA2665EF59DCF8A23D8B707F0DB480836771`이며 소스 SHA-256과 빌드·서명 검증 기록은 [source-build](source-build/result.json)에 보존했다. 시스템 실행파일 서명이나 macOS 검증을 바꾸지 않았다.

첫 소스 빌드의 시스템 libcurl/SecureTransport와 OpenSSL 콜백 조합에서 `NULL X509 store` 경고가 발생했다. [curl 공식 설치 방법](https://curl.se/docs/install.html)에 따라 서명 검증한 curl8.22.0을 기존 OpenSSL3.6.5로 빌드해 ClamAV와 연결했다. 최종 빌드의 [공식 CTest6개](source-build/ctest-tls.log)가 모두 통과했다. [실제 HTTPS 공식 bytecode 다운로드](source-build/https-signed-download.log)와 [정의 갱신](source-build/definitions-final.log)에 오류·경고가 없다. TLS 인증서와 공식 정의 서명 검증을 유지한다.

- [실제 파일/EICAR/접근 권한41개](files-restored-tests.json) 통과.
- 이전에 실패했던 나머지16파일의 [359개 회귀](../../R00-T02/scanner-restored-regressions.json) 통과. 이전 실패18파일을 합쳐400개가 통과했다.
- 최종 실행파일로 [정상 파일 허용·EICAR 차단·정의 최신성·socket0600·OfficialDatabaseOnly](source-build/runtime-final.json)를 확인했다.
- 전체 서버시험의 최종 재실행은 진행 중이며, 위400개를 전체 시험 완료로 표현하지 않는다.

## 로컬 재기동

작업 저장소 루트에서 Node24를 사용한다. `.local/tools/clamav-source`와 `.local/tools/curl-openssl3`는 함께 보존한다.

```sh
CLAMAV_LOCAL_ROOT="$PWD/.local/tools/clamav-source" node --import tsx scripts/clamav-local.ts update
CLAMAV_LOCAL_ROOT="$PWD/.local/tools/clamav-source" node --import tsx scripts/clamav-local.ts serve
node --env-file=.env.local --import tsx scripts/qa-rea-scanner.ts
```

소스 빌드 의존성으로 Homebrew `check`, `libpsl`을 설치했다. curl의 패키지 설치 시도는 OpenSSL4 전환 전에 중단했으며, 이때 갱신된 `libnghttp2`1.70.0·`libnghttp3`1.18.0은 보존했다. 실제 사용하는 ClamAV/curl 조합은 OpenSSL3.6.5이다. 다른 프로젝트가 사용하는 라이브러리를 임의로 롤백하지 않았다.
