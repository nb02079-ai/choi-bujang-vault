# 포장 보류 기록 (PACKAGING_PENDING)

작성일은 2026-10-27입니다. 이 문서는 Endministrator 앱의 포장(기본 포장 뒤 Inno Setup 설치 프로그램)을 **보류한 사유와 담당자 준비가 필요한 항목**을 남깁니다. 포장은 하지 않았고, 아래의 「확인함」은 이 PC에서 직접 검색하고 실행해 본 것, 「미확인」은 확인하지 못한 것입니다.

## 1. 결정

- 사용자 결정(2026-10-27): **포장 보류. 기록만 남기고 그동안 폴더 실행으로 임시 사용.**
- 우회하지 않습니다. `PROVIDED_RUNTIME_NOT_INSTALLED`나 운영 앱 승인 키가 없다는 안내가 나오면 `--app-only-v1`로 바꾸거나 다른 방법으로 대신하지 않고 담당자 준비 항목으로 기록합니다.
- 새 포장 스크립트를 만들지 않습니다. 이미 이 PC에 있는 다른 포장 도구(Desktop의 `keshev-portable-tools-0.1.1`)도 이번에는 쓰지 않기로 했습니다.

## 2. 요청한 포장 명령

```powershell
npm run package-app -- --source . --out "<아직 없는 출력 폴더>" --iconPath "<아이콘 파일>"
```

도구가 준비되기 전에는 실행하지 않았습니다.

## 3. 확인한 사실 (이 PC, 2026-10-27, 읽기 전용 검색)

| 항목 | 결과 |
|---|---|
| `npm run package-app` | **없음(확인함).** `on-client`의 npm 명령은 `start`, `demo`, `check`뿐이고 저장소 루트 `package.json`과 전역 npm 패키지에도 없음 |
| 도구 코드·문서 | `package-app`, `APP_PACKAGE_MANIFEST`, `PROVIDED_RUNTIME_NOT_INSTALLED`, `app-only-v1`, `iconPath`를 Documents, Desktop, ALEPH 설치 폴더, Downloads, Roaming 전체와 저장소 전 브랜치에서 검색해 **없음(확인함)**. `iconPath`는 무관한 다른 스크립트에서만 나옴 |
| 승인된 실행 환경, host 바로가기, `INSTALL.md` 틀 | **없음(확인함)** |
| 운영 앱 승인 키 | 준비된 흔적 없음(확인함, 키 값은 찾거나 열어 보지 않음) |
| Inno Setup(`ISCC.exe`) | **설치되어 있지 않음(확인함).** `winget`은 있음 |
| ALEPH 서버 쪽에 도구나 환경이 있는지 | **미확인**(이 PC의 파일과 저장소 이력만 확인함) |

## 4. 담당자 준비가 필요한 항목

| 번호 | 항목 | 상태 | 이 항목이 없을 때 |
|---|---|---|---|
| 1 | `package-app` 도구(또는 그 도구가 들어 있는 시작 틀 갱신본) | 없음 | 포장 명령을 실행할 수 없음 |
| 2 | 승인된 실행 환경(`PROVIDED_RUNTIME`)과 승인된 host 바로가기 | 없음 | `PROVIDED_RUNTIME_NOT_INSTALLED` 안내가 나올 것으로 예상(도구가 없어 재현하지 못함, 미확인) |
| 3 | 운영 앱 승인 키 | 없음 | 승인 키가 없다는 안내가 나올 것으로 예상(미확인) |

## 5. 포장 전 사전 확인 결과 (확인함)

| 항목 | 결과 |
|---|---|
| 작업 커밋 | 브랜치 `host-status`, 커밋 `6a8f5475cd15b11c7c8fa00dbbbd9bb6b39f7992`, 작업 트리 변경 0개, 원격과 같음 |
| 학생 원본 | `on-20`~`on-22` 브랜치와 21·22단계 제출 문서는 변경하지 않음 |
| 출력 폴더 후보 | `Documents\내 앱 마무리 묶음`은 **없음**(사용 가능), 부모 폴더 존재. 원본 폴더 밖이라 겹치지 않음 |
| 아이콘 | 저장소에는 `public/icon-512.png`(PNG 512×512), `icon-192.png`, `icon.svg`, `alekov-app-icon.webp`가 있고 **`.ico`는 없음.** 이 아이콘들은 자료실 웹페이지용이며 Endministrator 앱 전용이 아님. `package-app`이 요구하는 형식은 도구가 없어 **미확인** |

## 6. 준비가 끝나면 이어갈 순서

1. 담당자에게서 `package-app` 도구와 승인된 실행 환경, 운영 앱 승인 키 준비 여부를 받는다.
2. 이 문서의 5번을 다시 확인한다(작업 트리 깨끗, 출력 폴더 없음, 아이콘 형식).
3. 2번의 명령을 실행한다. 원본(`on-client`)에 변경이 없는지 `git status`로 확인한다.
4. 출력 폴더의 `APP_PACKAGE_MANIFEST.json`(파일 목록, 해시, 원본 커밋)을 확인한다.
5. 출력 폴더의 `INSTALL.md`의 설치 명령을 따라 하고, 승인된 host 바로가기로 실행해 「보호 현황」 맨 위의 관제 카드 4개를 확인한다. 값은 「실측」과 「예시 값」을 구분해 기록한다.
6. 그다음 Inno Setup 단계: Inno Setup 설치(외부 프로그램 설치이므로 그때 별도 승인), 사용자 단위 설치(관리자 권한 없음) 설정, 아이콘 `.ico` 준비, `setup.exe` 생성과 새 폴더 설치·실행 확인.
7. 이 앱의 새 진입점(`node src/host-status-server.mjs`)이 포장 결과의 시작 방법에 반영되는지 확인한다. 도구가 기본 시작 명령을 다르게 기록하면 그 차이를 그대로 기록한다(미확인).

## 7. 그동안의 임시 사용 방법

설치 프로그램 없이 폴더에서 직접 실행합니다. 받기, 실행, 확인, 종료, 문제 해결은 [HOST_STATUS_RUNBOOK.md](HOST_STATUS_RUNBOOK.md)에 있고, 핵심은 아래 한 줄입니다(`on-client` 폴더에서).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-host-status.ps1
```

화면의 값은 이 PC에서 방금 읽은 **실측**이며, 읽지 못한 항목은 **확인 불가**와 이유로 표시됩니다. 예시 값은 PC 값에 쓰지 않습니다(예제 모드는 SDP 줄만 예제).
