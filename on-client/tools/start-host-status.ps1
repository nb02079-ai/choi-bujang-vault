<#
  Endministrator PC 상태 관제 실행 도구

  하는 일
   - 이 파일이 들어 있는 앱 폴더(on-client)의 src\host-status-server.mjs 하나만 실행합니다.
   - 실행 전에 폴더 구성, Node.js 버전, 포트 사용 여부를 확인하고, 문제가 있으면 이유와 다음에 할 일을 알려 줍니다.
   - 서버가 뜨면 브라우저로 열 주소를 알려 주고, 관제 화면이 실제로 들어갔는지도 확인해서 알려 줍니다.

  하지 않는 일
   - 프로그램 설치, 전역 실행 정책 변경, 관리자 권한 요청, PC 설정 변경을 하지 않습니다.
   - 이미 포트를 쓰는 다른 프로그램을 종료하지 않습니다.
   - 열쇠·토큰 같은 비밀 환경변수를 서버에 넘기지 않습니다.

  사용 (앱 폴더 on-client 에서)
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-host-status.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-host-status.ps1 -Port 5190
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-host-status.ps1 -Demo
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-host-status.ps1 -Background
  -ExecutionPolicy Bypass 는 이 한 번의 실행에만 적용되며 컴퓨터 설정을 바꾸지 않습니다.
  -Demo 는 SDP 쪽만 「예제 자료」로 표시합니다. PC에서 잰 값은 예제 모드에서도 이 PC의 실측값입니다.
#>
[CmdletBinding()]
param(
  [string]$Port = '5189',
  [switch]$Demo,
  [switch]$Background,
  [string]$WaitSeconds = '20'
)
Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

function Say([string]$text) { Write-Host $text }
function Stop-With([string]$text, [int]$code = 1) { Write-Host $text -ForegroundColor Yellow; exit $code }

# 0) 입력 확인: 번호가 올바르지 않으면 영어 오류 대신 이유와 다음에 할 일을 알려 줍니다.
if ($Port -notmatch '^[0-9]+$' -or [int]$Port -lt 1024 -or [int]$Port -gt 65535) { Stop-With "포트 번호가 올바르지 않습니다($Port). 1024~65535 사이의 숫자를 쓰세요. 예: -Port 5190" }
if ($WaitSeconds -notmatch '^[0-9]+$' -or [int]$WaitSeconds -lt 1 -or [int]$WaitSeconds -gt 120) { Stop-With "-WaitSeconds 는 1~120 사이의 숫자여야 합니다($WaitSeconds). 예: -WaitSeconds 30" }
$portNumber = [int]$Port
$waitSeconds = [int]$WaitSeconds

# 1) 폴더 확인: 이 스크립트가 있는 tools 의 상위가 앱 폴더여야 합니다.
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root 'src\host-status-server.mjs'
$panel = Join-Path $root 'student\host-panel.mjs'
$package = Join-Path $root 'package.json'
foreach ($path in @($root, $server, $panel, $package)) {
  if (-not (Test-Path -LiteralPath $path)) { Stop-With "앱 폴더가 아닙니다. 받은 폴더의 on-client 안에서 tools\start-host-status.ps1 을 실행해 주세요. (없는 파일: $path) 파일이 모자라면 host-status 브랜치로 다시 받았는지 확인하세요." }
}
foreach ($path in @($root, $server, $panel)) {
  $item = Get-Item -LiteralPath $path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-With "바로가기(링크)로 연결된 폴더나 파일에서는 실행하지 않습니다. 실제 앱 폴더(on-client)에서 실행해 주세요. ($path)" }
}
try { $meta = Get-Content -LiteralPath $package -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Stop-With 'package.json 을 읽지 못했습니다. 폴더를 다시 받아 주세요.' }
if ($meta.name -ne 'alekov-client-starter') { Stop-With '앱 폴더가 아닙니다. 받은 폴더의 on-client 폴더에서 실행해 주세요.' }

# 2) Node.js 확인: 설치하지 않고 안내만 합니다.
$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) { Stop-With 'Node.js 가 없습니다. https://nodejs.org 에서 Node.js 24 LTS 를 설치한 뒤 PowerShell 창을 새로 열고 다시 실행해 주세요.' }
$versionText = (& $node.Source --version 2>$null | Out-String).Trim()
if ($versionText -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { Stop-With "Node.js 버전을 확인하지 못했습니다($versionText). Node.js 24 LTS 를 설치해 주세요." }
$major = [int]$Matches[1]
if ($major -lt 22 -or $major -gt 24) { Stop-With "지금 Node.js 는 $versionText 입니다. 이 앱은 Node.js 22~24 에서 실행합니다. Node.js 24 LTS 를 설치해 주세요." }
if ($major -ne 24) { Say "참고: 지금 Node.js 는 $versionText 입니다. 이 관제는 Node.js 24 에서 확인했고 다른 버전에서의 동작은 확인하지 못했습니다." }

# 3) 포트 확인: 사용 중이면 다른 프로그램을 끄지 않고 다른 번호를 안내합니다.
$busy = $false
try {
  $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $portNumber)
  $probe.Start(); $probe.Stop()
} catch { $busy = $true }
if ($busy) { Stop-With "포트 $portNumber 를 다른 프로그램이 쓰고 있습니다. 이 앱이 이미 켜져 있다면 그 창을 닫고, 아니면 다른 번호로 실행해 주세요. 예: -Port $($portNumber + 1)" }

# 4) 실행: 셸을 거치지 않고 node 를 직접 실행합니다. 비밀로 보이는 환경변수는 넘기지 않습니다.
$info = [Diagnostics.ProcessStartInfo]::new()
$info.FileName = $node.Source
$info.WorkingDirectory = $root
$info.UseShellExecute = $false
$info.Arguments = '"' + $server + '"' + $(if ($Demo) { ' --demo' } else { '' })
$secret = '(?i)(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|^ON_AI_|^OPENAI|^ANTHROPIC|^SUPABASE)'
foreach ($name in @($info.EnvironmentVariables.Keys)) { if ($name -match $secret) { $info.EnvironmentVariables.Remove($name) } }
$info.EnvironmentVariables['ON_PORT'] = [string]$portNumber
if ($Background) {
  $info.CreateNoWindow = $true
  $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
}
$process = [Diagnostics.Process]::Start($info)
$url = "http://127.0.0.1:$portNumber/"

# 5) 뜰 때까지 기다립니다. 서버가 응답한 것과 관제 화면이 들어간 것을 확인합니다. PC 값을 읽는 것은 화면에서 합니다.
$page = $null
$deadline = (Get-Date).AddSeconds($waitSeconds)
while ((Get-Date) -lt $deadline -and -not $process.HasExited) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
    if ($response.StatusCode -eq 200) { $page = $response; break }
  } catch { Start-Sleep -Milliseconds 300 }
}
if (-not $page) {
  if (-not $process.HasExited) { $process.Kill() }
  Stop-With "앱 서버가 $waitSeconds 초 안에 뜨지 않았습니다. 이 창에 나온 HOST_STATUS_ 로 시작하는 메시지를 확인하고, 해결되지 않으면 그 메시지를 그대로 알려 주세요."
}
Say "PC 상태 관제가 켜졌습니다. 브라우저에서 $url 을 여세요."
if ($page.Headers['x-host-dashboard'] -eq 'injected') {
  Say '관제 화면이 들어갔습니다. 「보호 현황」 탭 맨 위에서 「이 PC 상태 관제」 카드 4개를 확인하세요.'
} else {
  Say '주의: 관제 화면이 들어가지 않았습니다. 제공 화면의 구조가 달라진 것입니다. 이 경우에도 제공 화면은 그대로 동작하지만 관제 카드는 보이지 않습니다.'
}
if ($Demo) { Say '예제 자료 모드입니다. SDP 쪽 표시만 예제이고, PC 카드의 값은 이 PC에서 잰 실측값입니다.' }
if ($Background) {
  Say "뒤에서 실행 중입니다(프로세스 번호 $($process.Id)). 끄려면 이 번호의 node 를 작업 관리자에서 종료하세요."
  exit 0
}
Say '끄려면 이 창에서 Ctrl+C 를 누르세요.'
$process.WaitForExit()
