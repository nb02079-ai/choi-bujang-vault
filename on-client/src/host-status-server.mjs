// 이 PC의 상태 관제를 더하는 새 진입점입니다. 제공 서버(src/server.mjs)를 고치지 않고 감싸서 다음만 더합니다.
//  - GET /api/host-status : 이 PC에서 방금 읽은 값(CPU·메모리·디스크·방화벽·네트워크·Windows 기록 건수)과 추이
//  - GET /student/host-panel.mjs, /student/host-panel.css : 학생 영역의 관제 화면 파일
//  - GET / : 제공 화면을 디스크에서 바꾸지 않고, 내보낼 때만 관제 자리를 끼워 넣습니다. 자리를 찾지 못하면 제공 화면을 그대로 내보냅니다.
// 그 밖의 모든 요청은 제공 서버가 처리합니다. 읽기만 하며 PC의 설정을 바꾸지 않습니다.
// PC에서 잰 값은 SDP 연결 상태와 따로 나갑니다. 실패한 항목에 예시 값을 채우지 않습니다.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOnServer } from './server.mjs';
import { loadEngine, demoEngine } from './engine.mjs';
import { readHostMetrics, describeHostMetrics, formatPercent, formatGb } from './host-status/host-metrics.mjs';
import { createTrend, describeTrend } from './host-status/host-trend.mjs';
import { readHostSystem, describeHostSystem } from './host-status/host-system.mjs';
import { readSdpState } from './host-status/sdp-state.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export const DASHBOARD_MARKER = '<main id="main" tabindex="-1">';
export const DASHBOARD_SECTION = '<section id="host-dashboard" class="host-dashboard" aria-label="이 PC 상태 관제" data-host-dashboard hidden></section>';
export const DASHBOARD_HEAD = '<link rel="stylesheet" href="/student/host-panel.css"><script type="module" src="/student/host-panel.mjs"></script>';
const STUDENT_FILES = new Map([
  ['/student/host-panel.mjs', { rel: 'student/host-panel.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/student/host-panel.css', { rel: 'student/host-panel.css', type: 'text/css; charset=utf-8' }],
]);
// 제공 서버가 화면 파일에 붙이는 보안 정책과 같은 값입니다.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";

const NEXT_STEPS = Object.freeze({
  ACCESS_DENIED: '관리자 권한이 필요한 항목입니다. 이 앱은 권한을 올리거나 설정을 바꾸지 않습니다. 꼭 필요하면 PC 관리자에게 문의하세요.',
  COMMAND_TIMEOUT: '응답이 늦었습니다. 「다시 조회」를 눌러 주세요. 계속되면 PC가 바쁜지 확인하세요.',
  POWERSHELL_UNAVAILABLE: 'Windows PowerShell을 실행할 수 없습니다. PowerShell이 설치되어 있고 막혀 있지 않은지 확인하세요.',
  OUTPUT_INVALID: '읽은 결과의 형식이 맞지 않았습니다. 「다시 조회」를 눌러 보고, 계속되면 오류 코드를 기록해 두세요.',
});
const DEFAULT_NEXT_STEP = '「다시 조회」를 눌러 주세요. 계속되면 오류 코드를 기록해 두세요.';
export const nextStep = (code) => (Object.hasOwn(NEXT_STEPS, code) ? NEXT_STEPS[code] : DEFAULT_NEXT_STEP);
const failure = (code, message, status = 503) => Object.assign(new Error(code), { code, status, safeMessage: message });

/** 제공 화면에 관제 자리를 끼워 넣습니다. 표지를 정확히 한 번 찾지 못하면 바꾸지 않고 injected=false를 돌려줍니다. */
export function injectDashboard(html) {
  const count = (needle) => html.split(needle).length - 1;
  if (typeof html !== 'string' || count(DASHBOARD_MARKER) !== 1 || count('</head>') !== 1) return { html, injected: false };
  return { html: html.replace('</head>', `${DASHBOARD_HEAD}</head>`).replace(DASHBOARD_MARKER, `${DASHBOARD_MARKER}${DASHBOARD_SECTION}`), injected: true };
}

// ---- 읽은 값을 화면 카드 4개와 추이·기록으로 바꿉니다 ----
// 읽지 못한 항목은 값 없이 「확인 불가」와 이유, 다음에 할 일만 담습니다. 예시 값으로 채우지 않습니다.
const unavailableCard = (key, label, badge, detail, code) => ({ key, label, status: 'unavailable', badge, value: '확인 불가', detail, percent: null, code: code ?? 'COMMAND_FAILED', nextStep: nextStep(code) });

function buildCards(metrics, systemView, system) {
  const [cpuRow, memoryRow, diskRow] = describeHostMetrics(metrics);
  const metricCard = (row, source, value) => (row.status === 'ok'
    ? { key: row.key, label: row.label, status: 'ok', badge: row.badge, value: value(source), detail: row.text === value(source) ? row.note : `${row.text}. ${row.note}`, percent: Number.isFinite(source.percent) ? source.percent : null }
    : unavailableCard(row.key, row.label, row.badge, row.note, source?.code));
  const firewallRow = systemView.rows.find((row) => row.key === 'firewall');
  const firewall = system?.firewall;
  const firewallCard = firewall?.status === 'ok'
    ? { key: 'firewall', label: '방화벽', status: 'ok', badge: firewallRow.badge, value: `${firewall.profiles.filter((profile) => profile.enabled === 'True').length}/${firewall.profiles.length} 프로필 켜짐`, detail: `규칙 ${firewall.rules.total}개 (사용 중 ${firewall.rules.enabled}개). 읽기만 했고 설정은 바꾸지 않습니다.`, percent: null }
    : unavailableCard('firewall', '방화벽', firewallRow.badge, firewallRow.note, firewall?.code);
  return [
    metricCard(cpuRow, metrics?.cpu ?? {}, (v) => formatPercent(v.percent ?? 0)),
    metricCard(memoryRow, metrics?.memory ?? {}, (v) => formatPercent(v.percent ?? 0)),
    metricCard(diskRow, metrics?.disk ?? {}, (v) => `${formatGb(v.freeBytes ?? 0)} 남음`),
    firewallCard,
  ];
}

/** 화면이 그대로 그릴 수 있는 응답을 만듭니다. */
export function buildStatusView({ engine, metrics, system, trend, now }) {
  const summary = trend.summary();
  const systemView = describeHostSystem(system);
  return {
    generatedAt: new Date(now()).toISOString(),
    source: 'measured',
    cards: buildCards(metrics, systemView, system),
    trend: { ...describeTrend(summary), sampleCount: summary.sampleCount, capacity: summary.capacity },
    records: systemView.rows.map((row) => (row.status === 'unavailable' ? { ...row, code: system?.[row.key]?.code ?? 'COMMAND_FAILED', nextStep: nextStep(system?.[row.key]?.code) } : row)),
    notice: systemView.notice,
    sdp: readSdpState(engine),
    legend: { measured: '실측 = 이 PC에서 방금 읽은 값입니다.', example: '예시 = 설명용 값입니다. PC에서 잰 값에는 쓰지 않습니다.', unavailable: '확인 불가 = 읽지 못해 값을 보이지 않습니다. 이유와 다음에 할 일을 함께 보입니다.' },
  };
}

/** 관제 기능이 더해진 서버를 만듭니다. */
export function createHostStatusServer({
  engine = { evidenceMode: 'disconnected' }, assetsRoot = root, readMetrics = readHostMetrics, readSystem = readHostSystem,
  now = Date.now, sampleIntervalMs = 10_000, reuseMs = 1_000, requestTimeoutMs = 25_000, trendCapacity = 60,
} = {}) {
  const server = createOnServer({ engine, assetsRoot, aiEnv: {} });
  const legacy = server.listeners('request')[0];
  server.removeAllListeners('request');
  const trend = createTrend({ capacity: trendCapacity });
  let latest = null;
  let latestAt = 0;
  let inflight = null;
  let sampling = null;
  let timer = null;
  let skippedWarned = false;

  /** 이 PC의 값을 새로 읽습니다. 동시에 들어온 요청은 한 번의 읽기를 함께 쓰고, reuseMs 안의 반복 요청은 직전 결과를 씁니다. */
  function readNow() {
    if (inflight) return inflight;
    if (latest && now() - latestAt < reuseMs) return Promise.resolve(latest);
    inflight = (async () => {
      // CPU를 재는 250ms 동안 이 앱이 띄운 PowerShell의 부하가 값에 섞이지 않도록 CPU·메모리·디스크를 먼저 재고 끝낸 뒤에 시스템 값을 읽습니다.
      if (sampling) await sampling;
      const metrics = await readMetrics();
      const system = await readSystem();
      trend.add(metrics);
      latest = buildStatusView({ engine, metrics, system, trend, now });
      latestAt = now();
      return latest;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  function sample() {
    if (sampling || inflight) return;
    sampling = (async () => {
      try { trend.add(await readMetrics()); } catch { /* 이번 샘플만 건너뜁니다 */ } finally { sampling = null; }
    })();
  }
  server.on('listening', () => {
    if (sampleIntervalMs > 0) { sample(); timer = setInterval(sample, sampleIntervalMs); timer.unref?.(); }
  });
  server.on('close', () => { if (timer) clearInterval(timer); timer = null; });

  server.on('request', async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { legacy(req, res); return; }
    const path = url.pathname;
    const own = path === '/api/host-status' || STUDENT_FILES.has(path) || (path === '/' || path === '/index.html');
    if (!own) { legacy(req, res); return; }
    const send = (status, type, body, extra = {}) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
      res.end(body);
    };
    const json = (status, body) => send(status, 'application/json; charset=utf-8', JSON.stringify(body));
    let timeout;
    try {
      const port = server.address()?.port;
      if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress) || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) throw failure('HOST_REJECTED', '로컬 실행 주소에서 다시 요청하세요.', 403);
      if (url.search) throw failure('QUERY_REJECTED', '지원하지 않는 요청입니다.', 400);
      if (req.method !== 'GET') throw failure('METHOD_NOT_ALLOWED', '조회만 할 수 있습니다.', 405);
      if (path !== '/' && path !== '/index.html' && req.headers['sec-fetch-site'] === 'cross-site') throw failure('ORIGIN_REJECTED', '앱 화면에서 다시 요청하세요.', 403);

      if (path === '/api/host-status') {
        const data = await Promise.race([readNow(), new Promise((_, reject) => { timeout = setTimeout(() => reject(failure('REQUEST_TIMEOUT', '응답 시간이 지났습니다. 「다시 조회」를 눌러 주세요.')), requestTimeoutMs); })]);
        json(200, { ok: true, data });
        return;
      }
      if (STUDENT_FILES.has(path)) {
        const file = STUDENT_FILES.get(path);
        let bytes;
        try { bytes = await readFile(resolve(assetsRoot, file.rel)); } catch { throw failure('FILE_NOT_FOUND', '화면 파일을 찾을 수 없습니다.', 404); }
        send(200, file.type, bytes, { 'content-security-policy': CSP });
        return;
      }
      // 제공 화면: 디스크는 그대로 두고 내보낼 때만 관제 자리를 더합니다.
      let html;
      try { html = await readFile(resolve(assetsRoot, 'public/index.html'), 'utf8'); } catch { throw failure('FILE_NOT_FOUND', '제공 화면 파일을 찾을 수 없습니다.', 404); }
      const result = injectDashboard(html);
      if (!result.injected && !skippedWarned) { skippedWarned = true; console.warn('HOST_DASHBOARD_NOT_INJECTED: 제공 화면에서 관제 자리를 찾지 못해 제공 화면을 그대로 보입니다.'); }
      send(200, 'text/html; charset=utf-8', result.html, { 'content-security-policy': CSP, 'x-host-dashboard': result.injected ? 'injected' : 'skipped' });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 503;
      json(status, { ok: false, error: { code: typeof error?.code === 'string' ? error.code : 'HOST_STATUS_FAILED', message: error?.safeMessage ?? '이 PC의 상태를 읽지 못했습니다.', nextStep: DEFAULT_NEXT_STEP } });
    } finally {
      clearTimeout(timeout);
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let demo = false;
    for (const arg of args) {
      if (arg === '--demo' && !demo) demo = true;
      else throw Error('UNKNOWN_ARGUMENT');
    }
    const port = Number(process.env.ON_PORT ?? 5189);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('INVALID_PORT');
    const engine = demo ? demoEngine() : await loadEngine(process.env.ON_ENGINE_ADAPTER);
    const server = createHostStatusServer({ engine });
    server.on('error', (error) => {
      console.error(error?.code === 'EADDRINUSE' ? `HOST_STATUS_PORT_IN_USE: 포트 ${port}를 다른 프로그램이 쓰고 있습니다. 다른 번호로 실행하세요(환경변수 ON_PORT).` : 'HOST_STATUS_START_FAILED: 서버를 시작하지 못했습니다.');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Endministrator PC 상태 관제 ${demo ? '(예제 자료 모드)' : '(SDP 미연결 실행)'}: http://127.0.0.1:${port}/`));
  } catch (error) {
    console.error(`HOST_STATUS_CONFIGURATION_INVALID: ${error?.message ?? ''}`);
    process.exitCode = 1;
  }
}
