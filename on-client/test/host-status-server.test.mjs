import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostStatusServer, injectDashboard, buildStatusView, nextStep, DASHBOARD_MARKER, DASHBOARD_SECTION } from '../src/host-status-server.mjs';
import { createTrend } from '../src/host-status/host-trend.mjs';
import { demoEngine } from '../src/engine.mjs';

const REAL_INDEX = new URL('../public/index.html', import.meta.url);
const IPV4_SHAPE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/u;
const T0 = '2026-10-27T07:30:00.000Z';
const GB = 1024 ** 3;

// ---- 가짜 읽기 결과 (서버 동작을 시험하기 위한 입력이며 이 PC의 실측값이 아님) ----
const okMetrics = (at = T0) => ({
  measuredAt: at,
  cpu: { status: 'ok', source: 'measured', percent: 12.3, cores: 12, intervalMs: 250, measuredAt: at },
  memory: { status: 'ok', source: 'measured', totalBytes: 16 * GB, usedBytes: 8 * GB, freeBytes: 8 * GB, percent: 50, measuredAt: at },
  disk: { status: 'ok', source: 'measured', path: 'C:\\', totalBytes: 100 * GB, usedBytes: 60 * GB, freeBytes: 40 * GB, percent: 60, measuredAt: at },
});
const okSystem = (at = T0) => ({
  measuredAt: at,
  network: { status: 'ok', source: 'measured', adapters: [{ name: '이더넷', linkSpeed: '1 Gbps', dhcp: 'Enabled', ipv4Connectivity: 'Internet', category: 'Private' }], totalAdapters: 1, measuredAt: at, durationMs: 5 },
  firewall: { status: 'ok', source: 'measured', profiles: [{ name: 'Domain', enabled: 'True', inbound: 'NotConfigured', outbound: 'NotConfigured' }, { name: 'Private', enabled: 'True', inbound: 'NotConfigured', outbound: 'NotConfigured' }, { name: 'Public', enabled: 'False', inbound: 'Block', outbound: 'Allow' }], rules: { total: 581, enabled: 352 }, measuredAt: at, durationMs: 5 },
  events: { status: 'ok', source: 'measured', windowHours: 24, system: { errors: 2, warnings: 10, errorsAtLeast: false, warningsAtLeast: false }, application: { errors: 3, warnings: 6, errorsAtLeast: false, warningsAtLeast: false }, measuredAt: at, durationMs: 5 },
});

async function startServer(options = {}) {
  const server = createHostStatusServer({ readMetrics: async () => okMetrics(), readSystem: async () => okSystem(), sampleIntervalMs: 0, ...options });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return { server, port, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }) };
}
const get = (port, path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const request = http.request({ host: '127.0.0.1', port, path, method, headers }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let json = null;
      try { json = JSON.parse(text); } catch { /* 본문이 JSON이 아님 */ }
      resolve({ status: response.statusCode, headers: response.headers, text, json });
    });
  });
  request.on('error', reject);
  request.end();
});
const sha = (text) => createHash('sha256').update(text).digest('hex');

test('GET /api/host-status: 카드 4개와 추이·기록, SDP 상태를 따로 돌려준다', async () => {
  const { port, close } = await startServer();
  try {
    const reply = await get(port, '/api/host-status');
    assert.equal(reply.status, 200);
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.equal(reply.json.ok, true);
    const data = reply.json.data;
    assert.equal(data.source, 'measured');
    assert.deepEqual(data.cards.map((card) => card.key), ['cpu', 'memory', 'disk', 'firewall']);
    assert.equal(data.cards.every((card) => card.status === 'ok' && card.badge.startsWith('실측 · 측정 ')), true);
    assert.equal(data.cards[0].value, '12.3 %');
    assert.equal(data.cards[2].value, '40.0 GB 남음');
    assert.equal(data.cards[3].value, '2/3 프로필 켜짐');
    assert.equal(data.trend.sampleCount, 1);
    assert.equal(data.records.map((row) => row.key).join(), 'network,firewall,events,security-log');
    assert.match(data.notice, /침해나 공격을 탐지한 결과가 아닙니다/u);
    assert.equal(data.sdp.label, 'SDP 미연결');
    assert.equal(data.sdp.separateFromPc, true);
    assert.doesNotMatch(reply.text, IPV4_SHAPE);
  } finally { await close(); }
});

test('실패한 항목은 값 없이 이유와 다음에 할 일을 보이고 예시 값으로 채우지 않으며 나머지는 그대로 보인다', async () => {
  const metrics = okMetrics();
  metrics.cpu = { status: 'unavailable', code: 'CPU_READ_FAILED', measuredAt: T0 };
  const system = okSystem();
  system.firewall = { status: 'unavailable', code: 'ACCESS_DENIED', measuredAt: T0, durationMs: 3 };
  system.events = { status: 'unavailable', code: 'COMMAND_TIMEOUT', measuredAt: T0, durationMs: 15000 };
  const { port, close } = await startServer({ readMetrics: async () => metrics, readSystem: async () => system });
  try {
    const { json } = await get(port, '/api/host-status');
    const [cpu, memory, , firewall] = json.data.cards;
    assert.equal(cpu.status, 'unavailable');
    assert.equal(cpu.value, '확인 불가');
    assert.equal(cpu.percent, null);
    assert.equal(cpu.code, 'CPU_READ_FAILED');
    assert.match(cpu.detail, /CPU_READ_FAILED/u);
    assert.match(cpu.nextStep, /다시 조회/u);
    assert.equal(memory.status, 'ok', '다른 카드는 그대로 실측으로 남는다');
    assert.equal(firewall.status, 'unavailable');
    assert.match(firewall.nextStep, /관리자 권한/u);
    assert.match(firewall.badge, /^확인 불가 · 시도 /u);
    const events = json.data.records.find((row) => row.key === 'events');
    assert.equal(events.status, 'unavailable');
    assert.deepEqual(events.lines, ['확인 불가']);
    assert.equal(events.code, 'COMMAND_TIMEOUT');
    assert.match(events.nextStep, /다시 조회/u);
    for (const card of [cpu, firewall]) assert.doesNotMatch(JSON.stringify(card), /\d+(?:\.\d+)? %|GB 남음/u, '확인 불가 카드에 숫자가 없다');
  } finally { await close(); }
});

test('읽기 전체가 실패하면 값 없이 오류와 다음에 할 일만 돌려준다', async () => {
  const { port, close } = await startServer({ readSystem: async () => { throw new Error('내부 오류 상세는 밖으로 나가지 않는다'); } });
  try {
    const reply = await get(port, '/api/host-status');
    assert.equal(reply.status, 503);
    assert.equal(reply.json.ok, false);
    assert.equal('data' in reply.json, false);
    assert.equal(reply.json.error.code, 'HOST_STATUS_FAILED');
    assert.match(reply.json.error.nextStep, /다시 조회/u);
    assert.doesNotMatch(reply.text, /내부 오류 상세/u);
  } finally { await close(); }
});

test('응답이 늦으면 시간 초과 오류와 다음에 할 일을 돌려준다', async () => {
  const { port, close } = await startServer({ readSystem: () => new Promise(() => {}), requestTimeoutMs: 80 });
  try {
    const reply = await get(port, '/api/host-status');
    assert.equal(reply.status, 503);
    assert.equal(reply.json.error.code, 'REQUEST_TIMEOUT');
    assert.match(reply.json.error.nextStep, /다시 조회/u);
  } finally { await close(); }
});

test('동시 요청은 읽기를 한 번만 하고 1초 안의 반복 요청은 직전 결과를 쓰며 시간이 지나면 새로 읽는다', async () => {
  let calls = 0;
  let clock = 1_000_000;
  const { port, close } = await startServer({
    now: () => clock, reuseMs: 1000,
    readMetrics: async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 40)); return okMetrics(); },
  });
  try {
    await Promise.all([get(port, '/api/host-status'), get(port, '/api/host-status'), get(port, '/api/host-status')]);
    assert.equal(calls, 1, '동시 요청은 한 번의 읽기를 함께 쓴다');
    clock += 500;
    await get(port, '/api/host-status');
    assert.equal(calls, 1, '1초 안의 반복 요청은 직전 결과를 쓴다');
    clock += 600;
    await get(port, '/api/host-status');
    assert.equal(calls, 2, '1초가 지나면 새로 읽는다');
  } finally { await close(); }
});

test('요청 검사: 다른 주소, 쿼리 문자열, 조회 외 방식, 다른 사이트에서 온 요청을 거절한다', async () => {
  const { port, close } = await startServer();
  try {
    assert.equal((await get(port, '/api/host-status', { headers: { Host: 'example.test' } })).json.error.code, 'HOST_REJECTED');
    assert.equal((await get(port, '/api/host-status?x=1')).json.error.code, 'QUERY_REJECTED');
    const post = await get(port, '/api/host-status', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.json.error.code, 'METHOD_NOT_ALLOWED');
    const cross = await get(port, '/api/host-status', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(cross.status, 403);
    assert.equal(cross.json.error.code, 'ORIGIN_REJECTED');
    assert.equal((await get(port, '/api/host-status')).status, 200);
  } finally { await close(); }
});

test('GET /: 제공 화면 파일은 그대로 두고 내보낼 때만 관제 자리를 더하며 보안 정책 머리글을 붙인다', async () => {
  const before = await readFile(REAL_INDEX, 'utf8');
  const { port, close } = await startServer();
  try {
    const reply = await get(port, '/');
    assert.equal(reply.status, 200);
    assert.equal(reply.headers['x-host-dashboard'], 'injected');
    assert.ok(reply.text.includes(`${DASHBOARD_MARKER}${DASHBOARD_SECTION}`));
    assert.ok(reply.text.includes('<link rel="stylesheet" href="/student/host-panel.css"><script type="module" src="/student/host-panel.mjs"></script></head>'));
    assert.match(reply.headers['content-security-policy'], /script-src 'self'; style-src 'self'/u);
    assert.equal(reply.text.replace(DASHBOARD_SECTION, '').replace('<link rel="stylesheet" href="/student/host-panel.css"><script type="module" src="/student/host-panel.mjs"></script>', '').replaceAll('\r\n', '\n'), before.replaceAll('\r\n', '\n'), '더한 것 외에는 제공 화면과 같다');
    assert.equal((await get(port, '/index.html')).headers['x-host-dashboard'], 'injected');
  } finally { await close(); }
  assert.equal(sha(await readFile(REAL_INDEX, 'utf8')), sha(before), '디스크의 제공 화면 파일은 바뀌지 않는다');
});

test('끼워 넣기: 표지를 정확히 한 번 찾지 못하면 제공 화면을 그대로 내보낸다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'host-status-'));
  try {
    await mkdir(join(dir, 'public'));
    const noMarker = '<!doctype html><html><head><title>x</title></head><body><main>다른 구조</main></body></html>';
    await writeFile(join(dir, 'public', 'index.html'), noMarker);
    const { port, close } = await startServer({ assetsRoot: dir });
    try {
      const reply = await get(port, '/');
      assert.equal(reply.status, 200);
      assert.equal(reply.headers['x-host-dashboard'], 'skipped');
      assert.equal(reply.text, noMarker);
    } finally { await close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
  const twice = `${DASHBOARD_MARKER}${DASHBOARD_MARKER}</head>`;
  assert.deepEqual(injectDashboard(twice), { html: twice, injected: false });
  assert.deepEqual(injectDashboard(undefined), { html: undefined, injected: false });
  assert.equal(injectDashboard(`<head></head>${DASHBOARD_MARKER}`).injected, true);
});

test('학생 영역 파일은 고정된 두 파일만 내주고 없으면 찾을 수 없다고 답한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'host-status-'));
  try {
    await mkdir(join(dir, 'student'));
    await mkdir(join(dir, 'public'));
    await writeFile(join(dir, 'public', 'index.html'), '<html></html>');
    await writeFile(join(dir, 'student', 'host-panel.mjs'), 'export const ok = true;');
    await writeFile(join(dir, 'student', 'secret.txt'), '내주면 안 되는 파일');
    const { port, close } = await startServer({ assetsRoot: dir });
    try {
      const mjs = await get(port, '/student/host-panel.mjs');
      assert.equal(mjs.status, 200);
      assert.match(mjs.headers['content-type'], /^text\/javascript/u);
      assert.equal(mjs.text, 'export const ok = true;');
      assert.match(mjs.headers['content-security-policy'], /default-src 'self'/u);
      const css = await get(port, '/student/host-panel.css');
      assert.equal(css.status, 404);
      assert.equal(css.json.error.code, 'FILE_NOT_FOUND');
      const other = await get(port, '/student/secret.txt');
      assert.notEqual(other.text, '내주면 안 되는 파일');
    } finally { await close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('관제 경로가 아닌 요청은 제공 서버가 그대로 처리한다', async () => {
  const { port, close } = await startServer();
  try {
    const diagnostics = await get(port, '/api/diagnostics');
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.json.data.component, 'on-client');
    assert.equal(diagnostics.json.data.engine.mode, 'disconnected');
    const me = await get(port, '/api/me');
    assert.equal(me.status, 503);
    assert.equal(me.json.error.code, 'ENGINE_NOT_CONNECTED');
    assert.equal((await get(port, '/app.js')).status, 200);
  } finally { await close(); }
});

test('SDP 상태는 PC 값과 별개: 예제 실행이면 SDP 아님으로, PC 카드는 그대로 실측으로 나온다', async () => {
  const { port, close } = await startServer({ engine: demoEngine() });
  try {
    const { json } = await get(port, '/api/host-status');
    assert.equal(json.data.sdp.label, '예제 자료 (SDP 아님)');
    assert.equal(json.data.cards.every((card) => card.status === 'ok'), true);
    assert.equal(JSON.stringify(json.data.cards).includes('SDP'), false, 'PC 카드에 SDP 문구가 섞이지 않는다');
  } finally { await close(); }
});

test('샘플링: 요청이 없어도 정해진 간격으로 값을 모아 추이에 쌓는다', async () => {
  let calls = 0;
  const { port, close } = await startServer({ sampleIntervalMs: 25, readMetrics: async () => { calls += 1; return okMetrics(new Date(Date.parse(T0) + calls * 1000).toISOString()); } });
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { json } = await get(port, '/api/host-status');
    assert.ok(json.data.trend.sampleCount >= 3, `샘플 ${json.data.trend.sampleCount}개`);
    assert.match(json.data.trend.period, /이 앱이 켜진 뒤 잰 값만/u);
  } finally { await close(); }
});

test('화면 응답 구성: 보관 개수를 보이고 다음에 할 일은 이유 코드별로 정해진다', () => {
  const trend = createTrend({ capacity: 5 });
  const view = buildStatusView({ engine: { evidenceMode: 'disconnected' }, metrics: okMetrics(), system: okSystem(), trend, now: () => Date.parse(T0) });
  assert.equal(view.trend.capacity, 5);
  assert.equal(view.trend.sampleCount, 0);
  assert.equal(view.generatedAt, T0);
  assert.match(view.legend.example, /PC에서 잰 값에는 쓰지 않습니다/u);
  assert.match(nextStep('ACCESS_DENIED'), /권한을 올리거나 설정을 바꾸지 않습니다/u);
  assert.match(nextStep('COMMAND_TIMEOUT'), /다시 조회/u);
  assert.match(nextStep('POWERSHELL_UNAVAILABLE'), /PowerShell/u);
  assert.match(nextStep('알수없음'), /다시 조회/u);
  assert.match(nextStep(undefined), /다시 조회/u);
});

test('측정 순서: CPU·메모리·디스크를 다 잰 뒤에 시스템 값을 읽어 앱 자신의 읽기 부하가 CPU 값에 섞이지 않는다', async () => {
  const order = [];
  const { port, close } = await startServer({
    readMetrics: async () => { order.push('metrics-start'); await new Promise((resolve) => setTimeout(resolve, 40)); order.push('metrics-end'); return okMetrics(); },
    readSystem: async () => { order.push('system-start'); return okSystem(); },
  });
  try {
    await get(port, '/api/host-status');
    assert.deepEqual(order, ['metrics-start', 'metrics-end', 'system-start']);
  } finally { await close(); }
});

test('샘플링 중에 요청이 오면 샘플링이 끝난 뒤에 시스템 값을 읽는다', async () => {
  const order = [];
  const { port, close } = await startServer({
    sampleIntervalMs: 10_000,
    readMetrics: async () => { order.push('metrics-start'); await new Promise((resolve) => setTimeout(resolve, 60)); order.push('metrics-end'); return okMetrics(); },
    readSystem: async () => { order.push('system-start'); return okSystem(); },
  });
  try {
    await get(port, '/api/host-status');
    const firstSystem = order.indexOf('system-start');
    assert.ok(firstSystem > order.indexOf('metrics-end'), '시스템 값 읽기는 첫 측정이 끝난 뒤에 시작한다');
  } finally { await close(); }
});

// ======== 화면(student/host-panel.mjs): 가짜 DOM으로 그리기·대기·실패·키보드·탭 표시를 시험합니다 ========
const panelModule = await import('../student/host-panel.mjs');
const { isValidStatus, describeFailure, loadHostStatus, createHostPanel, watchProtectionTab, mountHostPanel, ENDPOINT } = panelModule;

function fakeDocument() {
  const byId = new Map();
  const make = (tag) => {
    const node = {
      tag, children: [], attrs: {}, listeners: {}, className: '', hidden: false, _text: '',
      get textContent() { return this._text; },
      set textContent(value) { this._text = String(value); this.children = []; },
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes; this._text = ''; },
      setAttribute(name, value) { this.attrs[name] = String(value); if (name === 'id') byId.set(String(value), this); },
      getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; },
      addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); },
      click() { for (const listener of this.listeners.click ?? []) listener({ type: 'click' }); },
    };
    return node;
  };
  return { createElement: make, getElementById: (id) => byId.get(id) ?? null };
}
const allText = (node) => [node._text, ...node.children.map(allText)].filter(Boolean).join(' | ');
const findAll = (node, predicate, found = []) => { if (predicate(node)) found.push(node); node.children.forEach((child) => findAll(child, predicate, found)); return found; };
const sampleData = () => ({
  generatedAt: '2026-10-27T07:30:45.000Z', source: 'measured', notice: '이 건수는 Windows가 기록한 경고·오류의 개수이며 침해나 공격을 탐지한 결과가 아닙니다.',
  cards: [
    { key: 'cpu', label: 'CPU 사용률', status: 'ok', badge: '실측 · 측정 16:30:45', value: '12.3 %', detail: '250ms 평균', percent: 12.3 },
    { key: 'memory', label: '메모리', status: 'ok', badge: '실측 · 측정 16:30:45', value: '50.0 %', detail: '사용 8.0 GB / 전체 16.0 GB', percent: 50 },
    { key: 'disk', label: '디스크', status: 'ok', badge: '실측 · 측정 16:30:45', value: '40.0 GB 남음', detail: '드라이브 C:\\', percent: 60 },
    { key: 'firewall', label: '방화벽', status: 'ok', badge: '실측 · 측정 16:30:46', value: '3/3 프로필 켜짐', detail: '규칙 581개', percent: null },
  ],
  trend: { period: '16:30:42 ~ 16:30:45 (샘플 2개, 이 앱이 켜진 뒤 잰 값만)', rows: [{ id: 'cpu.percent', label: 'CPU 사용률', status: 'ok', text: '최근 12.3 %', note: '' }], sampleCount: 2, capacity: 60 },
  records: [
    { key: 'events', label: 'Windows 기록 경고·오류', status: 'ok', badge: '실측 · 측정 16:30:46', lines: ['System: 오류 2건 · 경고 10건'], note: '최근 24시간의 건수입니다.' },
    { key: 'security-log', label: 'Security 기록', status: 'not_read', badge: '읽지 않음', lines: ['읽지 않음'], note: '관리자 권한이 필요한 기록이라 읽지 않습니다.' },
  ],
  sdp: { label: 'SDP 미연결', note: '이 앱은 SDP 서버에 연결되어 있지 않습니다. PC에서 잰 값의 성공·실패와 별개입니다.' },
  legend: {},
});
const fetchReply = (status, body) => async () => ({ status, json: async () => { if (body === undefined) throw new Error('본문 없음'); return body; } });
const mountPanel = (fetchImpl) => {
  const document = fakeDocument();
  const root = document.createElement('section');
  root.setAttribute('id', 'host-dashboard');
  const panel = createHostPanel({ document, root, fetchImpl });
  return { document, root, panel };
};

test('화면 응답 확인: 모양이 맞는 응답만 사용한다', () => {
  assert.equal(isValidStatus(sampleData()), true);
  const bad = (change) => { const data = sampleData(); change(data); return isValidStatus(data); };
  assert.equal(bad((d) => { d.cards.pop(); }), false, '카드가 4개가 아님');
  assert.equal(bad((d) => { d.cards[1].key = 'cpu'; }), false, '카드 종류가 겹침');
  assert.equal(bad((d) => { d.cards[0].status = '성공'; }), false, '알 수 없는 상태');
  assert.equal(bad((d) => { d.cards[0].status = 'unavailable'; }), false, '확인 불가인데 다음에 할 일이 없음');
  assert.equal(bad((d) => { delete d.sdp; }), false);
  assert.equal(isValidStatus(null), false);
  assert.equal(isValidStatus('문자열'), false);
});

test('조회 실패 내용: 실패한 항목, 이유, 다음에 할 일이 있고 값은 없다', () => {
  const network = describeFailure({ error: new Error('x') });
  assert.equal(network.code, 'NETWORK_ERROR');
  assert.match(network.nextStep, /start-host-status\.ps1/u);
  const missing = describeFailure({ status: 404 });
  assert.equal(missing.code, 'HOST_STATUS_NOT_AVAILABLE');
  assert.match(missing.message, /이 실행에는 PC 상태 조회 기능이 없습니다/u);
  const server = describeFailure({ status: 503, body: { ok: false, error: { code: 'REQUEST_TIMEOUT', message: '응답 시간이 지났습니다.', nextStep: '「다시 조회」를 눌러 주세요.' } } });
  assert.deepEqual([server.code, server.message], ['REQUEST_TIMEOUT', '응답 시간이 지났습니다.']);
  assert.equal(describeFailure({ status: 500, body: null }).code, 'HTTP_500');
  assert.equal(describeFailure({ status: 200, body: { ok: true, data: {} } }).code, 'RESPONSE_INVALID');
  for (const failure of [network, missing, server]) for (const key of ['failedItem', 'message', 'nextStep', 'code']) assert.ok(failure[key], `${failure.code} ${key}`);
});

test('그리기: 카드 4개, 실측 배지, 게이지, 추이, 기록, SDP 줄이 따로 나온다', async () => {
  const { root, panel } = mountPanel(fetchReply(200, { ok: true, data: sampleData() }));
  await panel.refresh();
  const cards = findAll(root, (n) => n.tag === 'li' && n.className === 'hp-card');
  assert.deepEqual(cards.map((c) => c.getAttribute('data-key')), ['cpu', 'memory', 'disk', 'firewall']);
  assert.equal(cards.every((c) => allText(c).includes('실측 · 측정')), true);
  assert.equal(findAll(root, (n) => n.tag === 'meter').length, 3, '비율이 있는 카드 3개에만 게이지');
  const cpuMeter = findAll(cards[0], (n) => n.tag === 'meter')[0];
  assert.equal(cpuMeter.getAttribute('value'), '12.3');
  assert.match(cpuMeter.getAttribute('aria-label'), /CPU 사용률 사용률 12\.3 %/u);
  const text = allText(root);
  assert.match(text, /12\.3 %/u);
  assert.match(text, /침해나 공격을 탐지한 결과가 아닙니다/u);
  const sdp = findAll(root, (n) => n.className.includes('hp-sdp'))[0];
  assert.match(allText(sdp), /SDP 연결 상태 \(PC에서 잰 값과 별개\)/u);
  assert.match(allText(sdp), /SDP 미연결/u);
  assert.equal(allText(cards[0]).includes('SDP'), false, 'PC 카드에 SDP 문구가 섞이지 않는다');
  assert.equal(root.getAttribute('data-phase'), 'ok');
  assert.match(panel.status.textContent, /조회 완료 \(16:30:45\)\. 카드 4개 중 4개를 읽었고 0개는 확인 불가입니다\./u);
});

test('대기: 조회 중에는 값 없이 대기 표시만 보이고 중복 조회는 막으며 완료되면 풀린다', async () => {
  let release;
  let calls = 0;
  const { root, panel } = mountPanel(() => { calls += 1; return new Promise((resolve) => { release = () => resolve({ status: 200, json: async () => ({ ok: true, data: sampleData() }) }); }); });
  const pending = panel.refresh();
  assert.equal(root.getAttribute('data-phase'), 'loading');
  assert.equal(root.getAttribute('aria-busy'), 'true');
  assert.equal(panel.button.getAttribute('aria-disabled'), 'true');
  assert.equal(panel.button.getAttribute('type'), 'button');
  assert.match(panel.status.textContent, /조회 중입니다/u);
  assert.equal(findAll(root, (n) => n.className === 'hp-card').length, 0, '대기 중에는 카드가 없다');
  assert.doesNotMatch(allText(panel.body), /\d+(?:\.\d+)? %|GB/u, '대기 중에는 숫자가 없다');
  panel.button.click();
  panel.button.click();
  assert.equal(calls, 1, '대기 중 클릭은 새 조회를 만들지 않는다');
  release();
  await pending;
  assert.equal(root.getAttribute('aria-busy'), 'false');
  assert.equal(panel.button.getAttribute('aria-disabled'), 'false');
  assert.equal(calls, 1);
});

test('실패: 이전 값이나 예시 값을 남기지 않고 실패한 항목·이유·다음에 할 일과 마지막 성공 시각만 보인다', async () => {
  let mode = 'ok';
  const { root, panel } = mountPanel(async () => {
    if (mode === 'ok') return { status: 200, json: async () => ({ ok: true, data: sampleData() }) };
    throw new TypeError('Failed to fetch');
  });
  await panel.refresh();
  assert.match(allText(root), /12\.3 %/u);
  mode = 'down';
  await panel.refresh();
  const text = allText(root);
  assert.equal(root.getAttribute('data-phase'), 'error');
  assert.match(text, /조회에 실패했습니다/u);
  assert.match(text, /실패한 항목: PC 상태 전체/u);
  assert.match(text, /이유: PC 상태 서버에 연결하지 못했습니다\. \(NETWORK_ERROR\)/u);
  assert.match(text, /다음에 할 일: .*start-host-status\.ps1/u);
  assert.match(text, /마지막으로 조회에 성공한 시각: 16:30:45/u);
  assert.doesNotMatch(text, /12\.3 %|40\.0 GB|3\/3 프로필/u, '이전 값이 남지 않는다');
  assert.equal(findAll(root, (n) => n.className === 'hp-card').length, 0);
  assert.equal(findAll(root, (n) => n.attrs.role === 'alert').length, 1, '실패 화면은 알림 역할');
  assert.match(panel.status.textContent, /^조회 실패: /u);
  mode = 'ok';
  await panel.refresh();
  assert.equal(root.getAttribute('data-phase'), 'ok', '다시 조회하면 회복한다');
});

test('실패: 표준 서버(404)와 서버 오류 응답과 형식 오류를 구분해서 보인다', async () => {
  const run = async (reply) => { const { root, panel } = mountPanel(reply); await panel.refresh(); return allText(root); };
  assert.match(await run(fetchReply(404, { error: '없음' })), /HOST_STATUS_NOT_AVAILABLE/u);
  assert.match(await run(fetchReply(503, { ok: false, error: { code: 'REQUEST_TIMEOUT', message: '응답 시간이 지났습니다.', nextStep: '「다시 조회」를 눌러 주세요.' } })), /REQUEST_TIMEOUT[\s\S]*다음에 할 일: 「다시 조회」를 눌러 주세요/u);
  assert.match(await run(fetchReply(200, { ok: true, data: { cards: [] } })), /RESPONSE_INVALID/u);
  assert.match(await run(fetchReply(500, undefined)), /HTTP_500/u);
});

test('일부 항목만 읽지 못해도 그 카드는 값 없이 확인 불가와 다음에 할 일을 보이고 나머지는 그대로 보인다', async () => {
  const data = sampleData();
  data.cards[3] = { key: 'firewall', label: '방화벽', status: 'unavailable', badge: '확인 불가 · 시도 16:30:46', value: '확인 불가', detail: '관리자 권한이 있어야 읽을 수 있어 읽지 않았습니다. (ACCESS_DENIED)', percent: null, code: 'ACCESS_DENIED', nextStep: '관리자 권한이 필요한 항목입니다.' };
  const { root, panel } = mountPanel(fetchReply(200, { ok: true, data }));
  await panel.refresh();
  const firewall = findAll(root, (n) => n.className === 'hp-card' && n.getAttribute('data-key') === 'firewall')[0];
  const text = allText(firewall);
  assert.equal(firewall.getAttribute('data-status'), 'unavailable');
  assert.match(text, /확인 불가 · 시도 16:30:46/u);
  assert.match(text, /ACCESS_DENIED/u);
  assert.match(text, /다음에 할 일: 관리자 권한이 필요한 항목입니다\./u);
  assert.equal(findAll(firewall, (n) => n.tag === 'meter').length, 0);
  assert.doesNotMatch(text, /\d+ ?%/u);
  assert.match(panel.status.textContent, /카드 4개 중 3개를 읽었고 1개는 확인 불가입니다/u);
});

test('키보드: 「다시 조회」는 button이고 조회가 끝나도 같은 요소라 포커스가 유지되며 결과는 읽어 주는 영역으로 알린다', async () => {
  const { root, panel } = mountPanel(fetchReply(200, { ok: true, data: sampleData() }));
  const head = root.children[0];
  assert.equal(panel.button.tag, 'button');
  assert.equal(panel.button.textContent, '다시 조회');
  assert.ok(head.children.includes(panel.button));
  panel.button.click();
  await panel.state.running;
  assert.equal(root.children[0], head, '머리줄은 다시 그려지지 않는다');
  assert.ok(root.children[0].children.includes(panel.button), '같은 버튼 요소가 그대로 남는다');
  assert.equal(panel.status.getAttribute('role'), 'status');
  assert.equal(panel.status.getAttribute('aria-live'), 'polite');
  assert.equal(panel.button.getAttribute('aria-describedby'), panel.status.getAttribute('id'));
  const headings = findAll(root, (n) => /^h[234]$/u.test(n.tag));
  assert.ok(headings.length >= 8, '제목 구조가 있어 화면 읽기 도구로 이동할 수 있다');
  assert.equal(findAll(root, (n) => n.tag === 'input' || n.tag === 'a').length, 0, '마우스 전용 요소가 없다');
});

test('탭 표시: 「보호 현황」 탭이 선택됐을 때만 보이고 처음 보일 때 한 번만 조회를 시작한다', () => {
  const document = fakeDocument();
  const tab = document.createElement('button');
  tab.setAttribute('id', 'tab-protection');
  tab.setAttribute('aria-selected', 'false');
  const root = document.createElement('section');
  const watchers = [];
  class FakeObserver { constructor(callback) { watchers.push(callback); } observe() {} }
  let shown = 0;
  watchProtectionTab({ document, root, onShow: () => { shown += 1; }, MutationObserverImpl: FakeObserver });
  assert.equal(root.hidden, true);
  assert.equal(shown, 0);
  tab.setAttribute('aria-selected', 'true');
  watchers[0]();
  assert.equal(root.hidden, false);
  assert.equal(shown, 1);
  tab.setAttribute('aria-selected', 'false');
  watchers[0]();
  assert.equal(root.hidden, true);
  tab.setAttribute('aria-selected', 'true');
  watchers[0]();
  assert.equal(root.hidden, false);
  assert.equal(shown, 1, '다시 보여도 자동으로 다시 조회하지 않는다');
  assert.equal(root.getAttribute('data-tab-guard'), 'protection-only');
});

test('탭 표시: 탭을 찾지 못하면 기능이 사라지지 않게 보이고, 자리가 없으면 아무것도 하지 않는다', () => {
  const document = fakeDocument();
  const root = document.createElement('section');
  root.hidden = true;
  let shown = 0;
  watchProtectionTab({ document, root, onShow: () => { shown += 1; }, MutationObserverImpl: undefined });
  assert.equal(root.hidden, false);
  assert.equal(root.getAttribute('data-tab-guard'), 'tab-not-found');
  assert.equal(shown, 1);
  assert.equal(mountHostPanel({ document: fakeDocument(), fetchImpl: async () => { throw new Error('호출되면 안 됨'); } }), null);
});

test('화면 모듈 소스: HTML 문자열 삽입과 브라우저 저장소 사용이 없고 예시 값을 만들지 않으며 CSS에는 외부 주소가 없다', async () => {
  const source = await readFile(new URL('../student/host-panel.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/u);
  assert.doesNotMatch(source, /Math\.random|예시 값으로 보|가짜 값/u);
  assert.equal(ENDPOINT, '/api/host-status');
  const css = await readFile(new URL('../student/host-panel.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /https?:\/\/|@import|url\(/u);
  assert.match(css, /var\(--surface/u, '제공 화면의 색 변수를 쓴다');
});

test('서버와 화면의 계약: 실제 서버 응답을 화면 모듈이 그대로 읽어 그린다', async () => {
  const { port, close } = await startServer();
  try {
    const reply = await get(port, '/student/host-panel.mjs');
    assert.equal(reply.status, 200);
    assert.match(reply.headers['content-type'], /^text\/javascript/u);
    assert.equal((await get(port, '/student/host-panel.css')).status, 200);
    const page = await get(port, '/');
    assert.ok(page.text.includes('/student/host-panel.mjs'));
    const viaServer = (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options);
    const loaded = await loadHostStatus(viaServer);
    assert.equal(loaded.ok, true, '서버 응답이 화면의 확인을 통과한다');
    const { root, panel } = mountPanel(viaServer);
    await panel.refresh();
    assert.equal(root.getAttribute('data-phase'), 'ok');
    assert.equal(findAll(root, (n) => n.className === 'hp-card').length, 4);
    assert.match(allText(root), /SDP 미연결/u);
  } finally { await close(); }
});

test('서버와 화면의 계약: 일부 읽기가 실패한 실제 서버 응답도 화면이 확인 불가로 그린다', async () => {
  const system = okSystem();
  system.firewall = { status: 'unavailable', code: 'ACCESS_DENIED', measuredAt: T0, durationMs: 1 };
  const metrics = okMetrics();
  metrics.cpu = { status: 'unavailable', code: 'CPU_READ_FAILED', measuredAt: T0 };
  const { port, close } = await startServer({ readMetrics: async () => metrics, readSystem: async () => system });
  try {
    const { root, panel } = mountPanel((path, options) => fetch(`http://127.0.0.1:${port}${path}`, options));
    await panel.refresh();
    assert.equal(root.getAttribute('data-phase'), 'ok');
    const unavailable = findAll(root, (n) => n.className === 'hp-card' && n.getAttribute('data-status') === 'unavailable');
    assert.deepEqual(unavailable.map((c) => c.getAttribute('data-key')), ['cpu', 'firewall']);
    assert.equal(unavailable.every((c) => allText(c).includes('다음에 할 일:') && allText(c).includes('확인 불가')), true);
  } finally { await close(); }
});

// ======== 시작 오류 문구와 시작 스크립트: 처음 실행하는 사람이 이유와 다음에 할 일을 읽을 수 있어야 합니다 ========
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startupMessage, STARTUP_MESSAGES } from '../src/host-status-server.mjs';

const ENTRY = fileURLToPath(new URL('../src/host-status-server.mjs', import.meta.url));
const runEntry = (args, env = {}) => spawnSync(process.execPath, [ENTRY, ...args], { encoding: 'utf8', timeout: 8000, env: { ...process.env, ...env } });

test('시작 오류: 모르는 옵션은 코드와 함께 쓸 수 있는 옵션과 다시 할 일을 알려 준다', () => {
  const result = runEntry(['--x'], { ON_PORT: '5290' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('HOST_STATUS_CONFIGURATION_INVALID'));
  assert.ok(result.stderr.includes('--demo'));
  assert.ok(result.stderr.includes('(UNKNOWN_ARGUMENT)'));
  assert.equal(result.stdout, '', '실패한 실행은 정상 시작 문구를 내지 않는다');
});

test('시작 오류: 포트 번호가 올바르지 않으면 범위와 예를 알려 준다', () => {
  for (const bad of ['80', 'abc', '99999', '-5']) {
    const result = runEntry([], { ON_PORT: bad });
    assert.equal(result.status, 1, `ON_PORT=${bad}`);
    assert.ok(result.stderr.includes('1024~65535'), `ON_PORT=${bad}`);
    assert.ok(result.stderr.includes('ON_PORT'));
    assert.ok(result.stderr.includes('(INVALID_PORT)'));
  }
});

test('시작 오류: 이미 쓰는 포트이면 어떤 포트인지와 다른 번호 예를 알려 준다', async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => { blocker.listen(0, '127.0.0.1', resolve); });
  const port = blocker.address().port;
  try {
    const result = await new Promise((resolve) => {
      const child = spawnSync(process.execPath, [ENTRY], { encoding: 'utf8', timeout: 8000, env: { ...process.env, ON_PORT: String(port) } });
      resolve(child);
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('HOST_STATUS_PORT_IN_USE'));
    assert.ok(result.stderr.includes(`포트 ${port}`));
    assert.ok(result.stderr.includes(`ON_PORT = ${port + 1}`), '다른 번호의 예를 보여 준다');
  } finally { await new Promise((resolve) => { blocker.close(resolve); }); }
});

test('시작 오류 문구: 알려진 코드는 한국어 이유가 있고 모르는 코드도 다음에 할 일을 보인다', () => {
  for (const code of Object.keys(STARTUP_MESSAGES)) assert.match(startupMessage(code), /[가-힣]/u, code);
  assert.match(startupMessage('알수없음'), /ON_PORT/u);
  assert.match(startupMessage(undefined), /ON_ENGINE_ADAPTER/u);
  assert.match(startupMessage('constructor'), /확인할 수 없습니다/u, '객체 기본 속성 이름도 알려진 코드로 착각하지 않는다');
});

test('시작 스크립트: 한글이 깨지지 않게 BOM이 있고, 관리자 권한·정책 변경·설정 변경 구문이 없으며 새 진입점만 실행한다', async () => {
  const bytes = await readFile(new URL('../tools/start-host-status.ps1', import.meta.url));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'PowerShell 5.1에서 한글이 깨지지 않으려면 BOM이 필요하다');
  const text = bytes.toString('utf8');
  assert.ok(text.includes('src\\host-status-server.mjs'));
  assert.doesNotMatch(text, /Set-ExecutionPolicy|-Verb\s+RunAs|RunAs|Set-NetFirewall|New-NetFirewall|Remove-NetFirewall|netsh|Stop-Process|taskkill|Invoke-Expression|\biex\b/iu);
  assert.doesNotMatch(text, /ValidateRange/u, '영어 검증 오류 대신 한국어 안내를 쓴다');
  for (const phrase of ['Node.js 가 없습니다', '포트 번호가 올바르지 않습니다', '를 다른 프로그램이 쓰고 있습니다', '끄려면']) assert.ok(text.includes(phrase), phrase);
});
