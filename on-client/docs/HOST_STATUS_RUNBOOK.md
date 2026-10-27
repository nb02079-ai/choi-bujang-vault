# 이 PC 상태 관제 실행 안내 (처음 보는 사람용)

이 문서는 Endministrator 앱의 「이 PC 상태 관제」를 처음 실행하는 사람이 그대로 따라 할 수 있게 쓴 안내입니다. 작성일은 2026-10-27입니다.

**먼저 알아 둘 것**: 이 관제는 **전용 시작 스크립트(`tools\start-host-status.ps1`)로 켤 때만** 화면에 나옵니다. 기존 안내(`docs/STUDENT_RUNBOOK.md`)의 `start-alekov.ps1`로 켜면 앱은 뜨지만 관제 카드는 없습니다. 이것은 오류가 아니라 서로 다른 시작 파일입니다.

표기: **실측**은 이 PC에서 방금 읽은 값, **예시**는 설명용 값(이 앱은 PC 값에 예시를 쓰지 않습니다), **확인 불가**는 읽지 못해 값을 보이지 않는 항목입니다. 이 문서의 「확인함」은 2026-10-27에 이 PC(Windows 11 Pro 10.0.26200, Node.js v24.21.0, Windows PowerShell 5.1)에서 직접 실행해 본 것입니다.

## 1. 준비물

| 준비물 | 내용 | 확인 방법 |
|---|---|---|
| Windows | Windows 10 또는 11 (확인한 것은 Windows 11 Pro) | |
| Node.js | 22~24 버전. **24 LTS 권장**(24에서만 확인함) | PowerShell에서 `node --version` |
| PowerShell | Windows 기본의 Windows PowerShell 5.1 | 시작 메뉴에서 「Windows PowerShell」 |
| Git | 폴더를 GitHub에서 받을 때만 필요 | `git --version` |
| 권한 | **관리자 권한이 필요 없습니다.** 관리자로 실행하지 마세요. | |

Node.js가 없으면 https://nodejs.org 에서 24 LTS를 설치하고 PowerShell 창을 새로 엽니다. 설치 프로그램이나 외부 패키지(`npm install`)는 필요 없습니다. 이 앱은 Node.js 기본 기능만 씁니다.

## 2. 받기

```powershell
git clone -b host-status https://github.com/nb02079-ai/choi-bujang-vault.git
cd choi-bujang-vault\on-client
```

- 반드시 **`-b host-status`**(브랜치 이름)를 붙입니다. 기본 브랜치에는 이 앱이 없습니다.
- 폴더를 ZIP이나 복사로 받았다면 `on-client` 폴더 안으로 들어가면 됩니다. `on-client` 안에 `tools\start-host-status.ps1`과 `student\host-panel.mjs`가 있어야 합니다.
- `.env` 같은 설정 파일은 필요 없고, 다른 PC의 설정 파일을 복사하지 마세요.

## 3. 실행

`on-client` 폴더에서 PowerShell을 열고(파일 탐색기 주소 표시줄에 `powershell`을 입력해 Enter) 아래 한 줄을 실행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-host-status.ps1
```

`-ExecutionPolicy Bypass`는 이 한 번의 실행에만 적용되며 컴퓨터 설정을 바꾸지 않습니다.

**정상 시작 신호** (확인함, 이 순서로 나옵니다):

```
PC 상태 관제가 켜졌습니다. 브라우저에서 http://127.0.0.1:5189/ 을 여세요.
관제 화면이 들어갔습니다. 「보호 현황」 탭 맨 위에서 「이 PC 상태 관제」 카드 4개를 확인하세요.
끄려면 이 창에서 Ctrl+C 를 누르세요.
```

Node.js가 24가 아니면 첫 줄 앞에 「참고: 지금 Node.js 는 vXX 입니다…」가 한 줄 더 나옵니다. 이것은 실행을 막지 않는 참고 문구입니다.

## 4. 화면에서 확인

1. 브라우저에서 `http://127.0.0.1:5189/`을 엽니다.
2. 「보호 현황」 탭(처음 열리는 탭) **맨 위**에 「이 PC 상태 관제」가 보여야 합니다. 「업무 앱」, 「보안 기록」 탭에서는 보이지 않습니다.
3. 카드 4개: **CPU 사용률, 메모리, 디스크, 방화벽**. 카드마다 「실측 · 측정 HH:MM:SS」 배지와 값이 있습니다.
4. 아래에 **추이**(직전 대비, 평균, 최대), **기록**(네트워크, 방화벽, Windows 기록 경고·오류 건수, Security 기록 「읽지 않음」)이 있습니다.
5. 맨 아래 「SDP 연결 상태」는 PC 값과 **별개**입니다. 기본 실행에서는 「SDP 미연결」이 정상입니다.
6. 「다시 조회」를 누르면(Tab 키로 이동해 Enter도 됨) 「조회 중입니다」가 나온 뒤 약 2초 뒤에 새 값으로 바뀝니다. 자동으로 다시 조회하지 않습니다.
7. Windows 기록의 건수는 **침해나 공격을 탐지한 결과가 아니라** Windows가 기록한 경고·오류의 개수입니다.

## 5. 종료와 다시 실행

- 종료: 실행한 PowerShell 창에서 **Ctrl+C**
- 다시 실행: 3번의 한 줄을 다시 실행합니다.
- 뒤에서 실행했다면(`-Background`) 창이 없으므로 작업 관리자에서 해당 `node`를 종료하거나 아래 명령으로 끕니다(확인함).

```powershell
Get-NetTCPConnection -LocalPort 5189 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

## 6. 실행 옵션 (확인함)

| 옵션 | 뜻 | 예 |
|---|---|---|
| `-Port 번호` | 다른 포트로 실행(1024~65535). 이미 5189를 쓰고 있을 때 | `... start-host-status.ps1 -Port 5190` |
| `-Demo` | 예제 자료 모드. **SDP 쪽 표시만 예제**이고 PC 카드는 이 PC의 실측값입니다 | `... start-host-status.ps1 -Demo` |
| `-Background` | 창을 점유하지 않고 뒤에서 실행 | `... start-host-status.ps1 -Background` |
| `-WaitSeconds 초` | 서버가 뜰 때까지 기다리는 시간(1~120, 기본 20) | `... -WaitSeconds 30` |

## 7. 막혔을 때

### 7.1 시작할 때 (이 창에 나오는 문구)

| 나온 문구(일부) | 원인 | 할 일 |
|---|---|---|
| `앱 폴더가 아닙니다 … (없는 파일: …)` | `on-client` 밖에서 실행했거나 파일이 모자람 | `on-client` 폴더에서 실행. 파일이 없으면 `git clone -b host-status …`로 다시 받음 |
| `Node.js 가 없습니다` | Node.js 미설치 또는 PowerShell 창을 새로 열지 않음 | 24 LTS 설치 후 **PowerShell 창을 새로 열고** 다시 실행 |
| `지금 Node.js 는 vXX 입니다. 이 앱은 Node.js 22~24 에서 실행합니다` | 지원 범위 밖 버전 | Node.js 24 LTS 설치 |
| `포트 5189 를 다른 프로그램이 쓰고 있습니다` | 이 앱이 이미 켜져 있거나 다른 프로그램이 5189 사용 | 이미 켜진 창을 닫거나 `-Port 5190`으로 실행. 다른 프로그램은 종료하지 않음 |
| `포트 번호가 올바르지 않습니다(…)` | 1024~65535 밖이거나 숫자가 아님 | 예: `-Port 5190` |
| `앱 서버가 N 초 안에 뜨지 않았습니다` | 서버가 시작 중 종료되었거나 느림 | 창에 나온 `HOST_STATUS_`로 시작하는 줄을 확인. 아래 표 참고. 이 문구 자체는 재현하지 못함(미확인) |
| `주의: 관제 화면이 들어가지 않았습니다` | 제공 화면의 구조가 달라져 관제 자리를 못 찾음 | 앱은 정상 동작하지만 관제 카드가 없음. 제공 화면이 바뀐 것이므로 문의 |

### 7.2 서버가 직접 내는 오류 (확인함)

| 문구 | 뜻 | 할 일 |
|---|---|---|
| `HOST_STATUS_CONFIGURATION_INVALID: … (UNKNOWN_ARGUMENT)` | 알 수 없는 실행 옵션 | `--demo`만 쓸 수 있음. 옵션 없이 실행 |
| `HOST_STATUS_CONFIGURATION_INVALID: … (INVALID_PORT)` | 환경변수 `ON_PORT`가 올바르지 않음 | `$env:ON_PORT = 5190`처럼 숫자로 설정하거나 비움 |
| `HOST_STATUS_PORT_IN_USE: 포트 N를 …` | 그 포트를 이미 사용 중 | 안내된 다른 번호로 실행 |
| `HOST_STATUS_START_FAILED` | 서버 시작 실패 | 다시 실행. 계속되면 이 메시지를 기록해 문의 |

### 7.3 화면에서 「조회에 실패했습니다」가 나올 때

화면에는 **실패한 항목, 이유, 다음에 할 일**만 나오고 이전 값이나 예시 값은 나오지 않습니다.

| 이유 코드 | 뜻 | 할 일 |
|---|---|---|
| `NETWORK_ERROR` | 서버에 연결하지 못함 | 서버가 꺼져 있는지 확인하고 3번 명령으로 다시 실행한 뒤 「다시 조회」 |
| `HOST_STATUS_NOT_AVAILABLE` | **기존 시작 스크립트(`start-alekov.ps1`)로 켠 앱** | `start-host-status.ps1`로 다시 실행 |
| `REQUEST_TIMEOUT` | 응답이 늦음 | 「다시 조회」. 계속되면 PC가 바쁜지 확인 |
| `RESPONSE_INVALID`, `HTTP_숫자` | 서버 응답이 올바르지 않음 | 「다시 조회」. 계속되면 서버를 다시 실행 |

### 7.4 카드나 기록 한 칸만 「확인 불가」일 때

그 칸만 읽지 못한 것이고 나머지는 정상 실측입니다. 칸에 이유 코드와 「다음에 할 일」이 같이 나옵니다.

| 이유 코드 | 뜻 | 할 일 |
|---|---|---|
| `ACCESS_DENIED` | 관리자 권한이 있어야 읽을 수 있음 | **권한을 올리지 않습니다.** 꼭 필요하면 PC 관리자에게 문의 |
| `COMMAND_TIMEOUT` | 15초 안에 응답하지 않음 | 「다시 조회」 |
| `POWERSHELL_UNAVAILABLE` | PowerShell을 실행할 수 없음 | PowerShell이 설치·허용되어 있는지 확인 |
| `COMMAND_FAILED`, `OUTPUT_INVALID` | 읽는 중 오류 또는 결과 형식 오류 | 「다시 조회」. 계속되면 코드를 기록 |
| `CPU_…`, `MEMORY_…`, `DISK_…` | 해당 값을 읽지 못함 | 「다시 조회」 |

## 8. 이 앱이 하지 않는 것

- PC 설정, 방화벽 설정, 보안 설정을 **바꾸지 않습니다.** 읽기만 합니다(Get 계열 명령만 사용, 시험으로 확인).
- 관리자 권한을 요청하거나 올리지 않습니다. Security 기록은 읽지 않습니다.
- IP 주소와 MAC 주소를 읽지도 표시하지도 않습니다.
- 값을 디스크에 저장하지 않습니다. 추이는 앱이 켜진 동안 메모리에만 있고 끄면 사라집니다.
- 예시 값으로 빈 곳을 채우지 않습니다.

## 9. 지원 범위와 확인하지 못한 것

| 항목 | 상태 |
|---|---|
| Windows 11 Pro, Node.js v24.21.0, PowerShell 5.1 | 확인함 |
| Node.js 22, 23 | 시작 스크립트는 허용하지만 **동작은 확인하지 못함** |
| 다른 PC, 다른 Windows 버전 | **미확인** |
| 브라우저 | Microsoft Edge로 화면 확인(정상·일부 실패·전체 실패). 다른 브라우저 **미확인** |
| 실제 SDP(기존 접속·XDR 서버) 연결 | 지원하지 않음. 「SDP 미연결」 또는 「예제 자료(SDP 아님)」만 표시 |
| AI 연결, 보안 조치 집행, 실제 OSV 조회 | 이 관제의 범위 밖(연결 설정 필요) |
| 설치 프로그램(setup.exe) | **아직 없음.** 이 문서는 폴더에서 직접 실행하는 방법만 다룹니다 |
| macOS, Linux | 지원하지 않음 |

## 10. 같은 결과를 다시 만드는 순서

1. `node --version`으로 22~24인지 확인합니다.
2. 2번의 두 줄로 받고 `on-client`로 이동합니다.
3. 아래 시험을 실행해 **실패 0**인지 확인합니다(Node.js 기본 기능만 씀, 설치 없음).

```powershell
node --test test/host-status.test.mjs test/host-status-server.test.mjs
```

4. 3번의 한 줄로 실행하고 정상 시작 신호 3줄을 확인합니다.
5. 브라우저에서 4번의 항목 1~7을 차례로 확인합니다.
6. Ctrl+C로 끄고, `-Port 5190 -Demo`로 다시 실행해 「SDP」 줄만 「예제 자료 (SDP 아님)」로 바뀌고 CPU·메모리 값은 그대로 실측 배지인지 확인합니다.
7. 같은 창에서 3번의 한 줄을 한 번 더 실행해(앞의 것이 켜져 있는 상태에서) 「포트 … 를 다른 프로그램이 쓰고 있습니다」가 나오는지 확인합니다.
