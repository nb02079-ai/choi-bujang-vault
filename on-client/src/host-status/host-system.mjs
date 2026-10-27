// 이 PC의 네트워크 구성, 방화벽 설정, 최근 Windows 기록(System·Application)의 경고·오류 건수를 읽습니다.
// 지키는 규칙
//  - 읽기만 합니다. 방화벽과 보안 설정을 바꾸는 명령은 쓰지 않으며 시험이 명령 문자열을 검사합니다.
//  - 관리자 권한이 필요한 항목은 권한을 올리거나 바꾸려 하지 않고 「확인 불가」와 이유(ACCESS_DENIED)로 돌려줍니다.
//  - IP 주소와 MAC 주소는 앱으로 가져오지도 보이지도 저장하지도 않습니다. 주소 속성이 없는 명령만 쓰고 필요한 속성만 골라 냅니다.
//  - 건수는 Windows가 남긴 경고·오류 기록의 개수이며 침해나 공격을 탐지한 결과가 아닙니다.
//  - PowerShell 명령은 코드에 고정된 문자열뿐이고 사용자 입력을 끼워 넣지 않습니다.
import { execFile } from 'node:child_process';
import { formatLocalTime } from './host-metrics.mjs';

export const SOURCE_MEASURED = 'measured';
export const EVENT_WINDOW_HOURS = 24;
export const EVENT_MAX = 10000;
export const COMMAND_TIMEOUT_MS = 15000;
export const NOT_DETECTION_NOTICE = '이 건수는 Windows가 기록한 경고·오류의 개수이며 침해나 공격을 탐지한 결과가 아닙니다.';

export const SYSTEM_REASONS = Object.freeze({
  ACCESS_DENIED: '관리자 권한이 있어야 읽을 수 있어 읽지 않았습니다. 이 앱은 권한을 올리거나 설정을 바꾸지 않습니다.',
  COMMAND_TIMEOUT: '정해진 시간 안에 응답하지 않아 중단했습니다.',
  POWERSHELL_UNAVAILABLE: 'PowerShell을 실행할 수 없습니다.',
  COMMAND_FAILED: '읽는 중 오류가 났습니다.',
  OUTPUT_INVALID: '읽은 결과의 형식이 올바르지 않아 사용하지 않았습니다.',
});
export const systemReasonText = (code) => (Object.hasOwn(SYSTEM_REASONS, code) ? SYSTEM_REASONS[code] : '읽지 못한 이유를 알 수 없습니다.');

// ---- 고정 명령 (읽기 전용) ----
const joinScript = (...parts) => parts.join('; ');
const wrap = (body) => joinScript(
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  `try { ${body} } catch { $m = [string]$_.Exception.Message; $d = ($_.Exception.GetType().Name -eq 'UnauthorizedAccessException') -or ($m -match 'denied|unauthorized|권한|거부'); [pscustomobject]@{ error = $(if ($d) { 'ACCESS_DENIED' } else { 'COMMAND_FAILED' }) } | ConvertTo-Json -Compress }`,
);

export const SCRIPTS = Object.freeze({
  // 어댑터 이름·상태·속도, IPv4 인터페이스의 DHCP 사용 여부, 연결 프로필의 분류와 연결 수준만 냅니다. 주소 속성은 고르지 않습니다.
  network: wrap(joinScript(
    '$a = @(Get-NetAdapter | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; status = [string]$_.Status; linkSpeed = [string]$_.LinkSpeed } })',
    '$i = @(Get-NetIPInterface -AddressFamily IPv4 | ForEach-Object { [pscustomobject]@{ name = [string]$_.InterfaceAlias; dhcp = [string]$_.Dhcp; state = [string]$_.ConnectionState } })',
    '$p = @(Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ name = [string]$_.InterfaceAlias; category = [string]$_.NetworkCategory; ipv4 = [string]$_.IPv4Connectivity } })',
    '[pscustomobject]@{ adapters = $a; interfaces = $i; profiles = $p } | ConvertTo-Json -Compress -Depth 4',
  )),
  // 프로필별 켜짐 여부와 기본 동작, 규칙은 개수만 냅니다. 규칙 내용은 읽어 내보내지 않습니다.
  firewall: wrap(joinScript(
    '$f = @(Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; enabled = [string]$_.Enabled; inbound = [string]$_.DefaultInboundAction; outbound = [string]$_.DefaultOutboundAction } })',
    '$all = @(Get-NetFirewallRule).Count',
    '$on = @(Get-NetFirewallRule -Enabled True).Count',
    '[pscustomobject]@{ profiles = $f; rules = [pscustomobject]@{ total = $all; enabled = $on } } | ConvertTo-Json -Compress -Depth 4',
  )),
  // 일치하는 기록이 없으면 0건이고, 권한 오류 같은 다른 오류는 0건으로 바꾸지 않고 그대로 실패로 돌려줍니다.
  events: wrap(joinScript(
    `$since = (Get-Date).AddHours(-${EVENT_WINDOW_HOURS})`,
    // 조건 검색은 읽기 권한이 없어도 「일치하는 기록 없음」으로 끝나 0건처럼 보일 수 있습니다. 그래서 먼저 조건 없이 한 건을 읽어 권한을 확인합니다.
    "function Check-Access($log) { try { $null = Get-WinEvent -LogName $log -MaxEvents 1 -ErrorAction Stop } catch { if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { return } throw } }",
    `function Count-Events($log, $level) { Check-Access $log; try { return @(Get-WinEvent -FilterHashtable @{ LogName = $log; Level = $level; StartTime = $since } -MaxEvents ${EVENT_MAX} -ErrorAction Stop).Count } catch { if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { return 0 } throw } }`,
    "[pscustomobject]@{ system = [pscustomobject]@{ errors = (Count-Events 'System' 2); warnings = (Count-Events 'System' 3) }; application = [pscustomobject]@{ errors = (Count-Events 'Application' 2); warnings = (Count-Events 'Application' 3) } } | ConvertTo-Json -Compress -Depth 4",
  )),
});

/** 고정 명령 하나를 실행해 JSON을 돌려줍니다. 실패는 이유 코드만 돌려주고 원문 오류 메시지는 쓰지 않습니다. */
export function runPowerShell(script, { timeoutMs = COMMAND_TIMEOUT_MS, execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    try {
      execFileImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
          if (error) {
            resolve({ ok: false, code: error.code === 'ENOENT' ? 'POWERSHELL_UNAVAILABLE' : error.killed ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED' });
            return;
          }
          try {
            const data = JSON.parse(String(stdout).replace(/^﻿/u, '').trim());
            if (data && typeof data === 'object' && typeof data.error === 'string') {
              resolve({ ok: false, code: Object.hasOwn(SYSTEM_REASONS, data.error) ? data.error : 'COMMAND_FAILED' });
            } else resolve({ ok: true, data });
          } catch {
            resolve({ ok: false, code: 'OUTPUT_INVALID' });
          }
        });
    } catch {
      resolve({ ok: false, code: 'POWERSHELL_UNAVAILABLE' });
    }
  });
}

// ---- 읽은 결과를 확인하고 필요한 값만 남깁니다 ----
const text = (value, max = 80) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, max) : '');
const list = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const isoAt = (now) => new Date(now()).toISOString();
const failed = (code, now, durationMs) => ({ status: 'unavailable', code, measuredAt: isoAt(now), durationMs });

export function parseNetwork(raw) {
  if (!raw || typeof raw !== 'object' || !('adapters' in raw)) return null;
  const adapters = list(raw.adapters);
  const up = adapters.filter((adapter) => text(adapter?.status) === 'Up').map((adapter) => {
    const name = text(adapter.name);
    const iface = list(raw.interfaces).find((item) => text(item?.name) === name);
    const profile = list(raw.profiles).find((item) => text(item?.name) === name);
    return { name, linkSpeed: text(adapter.linkSpeed, 24), dhcp: iface ? text(iface.dhcp, 24) : null, ipv4Connectivity: profile ? text(profile.ipv4, 24) : null, category: profile ? text(profile.category, 32) : null };
  }).filter((adapter) => adapter.name !== '');
  return { adapters: up, totalAdapters: adapters.length };
}

export function parseFirewall(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const profiles = list(raw.profiles).map((item) => ({ name: text(item?.name, 24), enabled: text(item?.enabled, 24), inbound: text(item?.inbound, 24), outbound: text(item?.outbound, 24) })).filter((item) => item.name !== '');
  const total = count(raw.rules?.total);
  const enabled = count(raw.rules?.enabled);
  if (profiles.length === 0 || total === null || enabled === null || enabled > total) return null;
  return { profiles, rules: { total, enabled } };
}

export function parseEvents(raw) {
  const read = (log) => {
    const errors = count(log?.errors);
    const warnings = count(log?.warnings);
    if (errors === null || warnings === null || errors > EVENT_MAX || warnings > EVENT_MAX) return null;
    return { errors, warnings, errorsAtLeast: errors === EVENT_MAX, warningsAtLeast: warnings === EVENT_MAX };
  };
  const system = read(raw?.system);
  const application = read(raw?.application);
  return system && application ? { windowHours: EVENT_WINDOW_HOURS, system, application } : null;
}

async function readOne(script, parse, { run, now }) {
  const started = Date.now();
  const reply = await run(script);
  const durationMs = Date.now() - started;
  if (!reply.ok) return failed(reply.code, now, durationMs);
  const parsed = parse(reply.data);
  return parsed ? { status: 'ok', source: SOURCE_MEASURED, ...parsed, measuredAt: isoAt(now), durationMs } : failed('OUTPUT_INVALID', now, durationMs);
}

export const readNetwork = (options = {}) => readOne(SCRIPTS.network, parseNetwork, { run: options.run ?? runPowerShell, now: options.now ?? Date.now });
export const readFirewall = (options = {}) => readOne(SCRIPTS.firewall, parseFirewall, { run: options.run ?? runPowerShell, now: options.now ?? Date.now });
export const readEvents = (options = {}) => readOne(SCRIPTS.events, parseEvents, { run: options.run ?? runPowerShell, now: options.now ?? Date.now });

/** 세 가지를 동시에 읽습니다. 하나가 실패해도 나머지는 그대로 돌려줍니다. */
export async function readHostSystem(options = {}) {
  const now = options.now ?? Date.now;
  const [network, firewall, events] = await Promise.all([readNetwork({ ...options, now }), readFirewall({ ...options, now }), readEvents({ ...options, now })]);
  return { measuredAt: isoAt(now), network, firewall, events };
}

// ---- 화면과 설명에 쓸 문구 ----
const CATEGORY = { Public: '공용', Private: '개인', DomainAuthenticated: '도메인 인증' };
const CONNECTIVITY = { Internet: '인터넷 연결', LocalNetwork: '로컬 네트워크만', Subnet: '같은 서브넷만', NoTraffic: '트래픽 없음', Disconnected: '연결 안 됨' };
const DHCP = { Enabled: 'DHCP 사용', Disabled: 'DHCP 사용 안 함, 고정 설정' };
const NO_PROFILE = '연결 프로필 없음';
const ON_OFF = { True: '켜짐', False: '꺼짐', NotConfigured: '정책 미지정' };
const ACTION = { Allow: '허용', Block: '차단', NotConfigured: '정책 미지정' };
const label = (map, value) => (value && Object.hasOwn(map, value) ? `${map[value]}(${value})` : value ? `알 수 없는 값(${value})` : '정보 없음');
const badge = (item) => (item.status === 'ok' ? `실측 · 측정 ${formatLocalTime(item.measuredAt)}` : `확인 불가 · 시도 ${formatLocalTime(item.measuredAt)}`);
const unavailableRow = (key, title, item) => ({ key, label: title, status: 'unavailable', badge: badge(item), lines: ['확인 불가'], note: `${systemReasonText(item.code)} (${item.code})` });
const eventsLine = (name, log) => `${name}: 오류 ${log.errors}${log.errorsAtLeast ? ' 이상' : ''}건 · 경고 ${log.warnings}${log.warningsAtLeast ? ' 이상' : ''}건`;

export function describeHostSystem(result) {
  const missing = (item) => !item || typeof item !== 'object' || !item.status;
  const pick = (item) => (missing(item) ? { status: 'unavailable', code: 'COMMAND_FAILED', measuredAt: null } : item);
  const network = pick(result?.network);
  const firewall = pick(result?.firewall);
  const events = pick(result?.events);
  const rows = [];
  rows.push(network.status !== 'ok' ? unavailableRow('network', '네트워크 구성', network) : {
    key: 'network', label: '네트워크 구성', status: 'ok', badge: badge(network),
    lines: network.adapters.length ? network.adapters.map((a) => `${a.name} · 속도 ${a.linkSpeed || '정보 없음'} · ${label(DHCP, a.dhcp)} · ${a.ipv4Connectivity === null ? NO_PROFILE : label(CONNECTIVITY, a.ipv4Connectivity)} · 분류 ${a.category === null ? NO_PROFILE : label(CATEGORY, a.category)}`) : ['연결된 어댑터가 없습니다'],
    note: `연결된 어댑터 ${network.adapters.length}개 / 전체 ${network.totalAdapters}개. IP 주소와 MAC 주소는 읽지도 표시하지도 않습니다.`,
  });
  rows.push(firewall.status !== 'ok' ? unavailableRow('firewall', '방화벽 설정', firewall) : {
    key: 'firewall', label: '방화벽 설정', status: 'ok', badge: badge(firewall),
    lines: [...firewall.profiles.map((p) => `${p.name} 프로필: ${label(ON_OFF, p.enabled)} · 기본 인바운드 ${label(ACTION, p.inbound)} · 기본 아웃바운드 ${label(ACTION, p.outbound)}`), `규칙 ${firewall.rules.total}개 (사용 중 ${firewall.rules.enabled}개)`],
    note: '읽기만 했습니다. 방화벽 설정은 바꾸지 않습니다.',
  });
  rows.push(events.status !== 'ok' ? unavailableRow('events', 'Windows 기록 경고·오류', events) : {
    key: 'events', label: 'Windows 기록 경고·오류', status: 'ok', badge: badge(events),
    lines: [eventsLine('System', events.system), eventsLine('Application', events.application)],
    note: `최근 ${events.windowHours}시간의 건수입니다. ${NOT_DETECTION_NOTICE}`,
  });
  rows.push({ key: 'security-log', label: 'Security 기록', status: 'not_read', badge: '읽지 않음', lines: ['읽지 않음'], note: '관리자 권한이 필요한 기록이라 읽지 않습니다. 권한을 올리거나 설정을 바꾸지 않습니다.' });
  return { notice: NOT_DETECTION_NOTICE, rows };
}
