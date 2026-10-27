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
