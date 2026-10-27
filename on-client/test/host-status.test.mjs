import test from 'node:test';
import assert from 'node:assert/strict';
import { readCpu, readMemory, readDisk, readHostMetrics, SOURCE_MEASURED, describeHostMetrics, formatGb, formatPercent, formatLocalTime, reasonText } from '../src/host-status/host-metrics.mjs';
import { createTrend, describeTrend, TREND_NEEDS_TWO_SAMPLES, TREND_NO_USABLE_SAMPLE } from '../src/host-status/host-trend.mjs';

const NOW = Date.parse('2026-10-27T07:00:00.000Z');
const now = () => NOW;
const core = (user, sys, idle) => ({ times: { user, nice: 0, sys, idle, irq: 0 } });
const sequence = (...samples) => { let i = 0; return () => samples[Math.min(i++, samples.length - 1)]; };
const noWait = async () => {};

// ---- CPU: 주입한 가짜 누적 시간으로 계산식을 확인합니다. 실제 측정값이 아닙니다. ----
test('CPU: 두 시점의 누적 시간 차이로 사용률을 계산하고 측정 시각을 붙인다', async () => {
  const cpus = sequence([core(100, 100, 800), core(100, 100, 800)], [core(250, 250, 900), core(250, 250, 900)]);
  const result = await readCpu({ cpus, wait: noWait, now });
  // 코어 2개 합산: 간격 동안 전체 시간 +800, 놀고 있던 시간 +200 -> 사용 600/800 = 75%
  assert.equal(result.status, 'ok');
  assert.equal(result.source, SOURCE_MEASURED);
  assert.equal(result.percent, 75);
  assert.equal(result.cores, 2);
  assert.equal(result.measuredAt, '2026-10-27T07:00:00.000Z');
});

test('CPU: 간격 동안 변화가 없거나 값이 이상하면 숫자를 만들지 않고 확인 불가로 둔다', async () => {
  const same = [core(10, 10, 80)];
  assert.deepEqual((await readCpu({ cpus: () => same, wait: noWait, now })).code, 'CPU_SAMPLE_EMPTY');
  assert.equal((await readCpu({ cpus: () => [], wait: noWait, now })).code, 'CPU_NOT_READABLE');
  assert.equal((await readCpu({ cpus: () => [{ times: { user: -1, nice: 0, sys: 0, idle: 0, irq: 0 } }], wait: noWait, now })).code, 'CPU_VALUE_INVALID');
  assert.equal((await readCpu({ cpus: () => { throw new Error('읽기 실패'); }, wait: noWait, now })).code, 'CPU_READ_FAILED');
  const failed = await readCpu({ cpus: () => same, wait: noWait, now });
  assert.equal(failed.status, 'unavailable');
  assert.equal('percent' in failed, false, '확인 불가에는 숫자가 없어야 한다');
});

test('CPU: 간격 중 놀고 있던 시간이 줄어드는 비정상 값은 거절한다', async () => {
  const cpus = sequence([core(10, 10, 100)], [core(20, 20, 50)]);
  assert.equal((await readCpu({ cpus, wait: noWait, now })).code, 'CPU_SAMPLE_EMPTY');
});

// ---- 메모리 ----
test('메모리: 전체와 빈 양에서 사용량과 사용률을 계산한다', () => {
  const result = readMemory({ totalmem: () => 16_000, freemem: () => 4_000, now });
  assert.deepEqual({ status: result.status, used: result.usedBytes, free: result.freeBytes, percent: result.percent }, { status: 'ok', used: 12_000, free: 4_000, percent: 75 });
  assert.equal(result.measuredAt, '2026-10-27T07:00:00.000Z');
});

test('메모리: 값이 이상하면 확인 불가로 둔다', () => {
  assert.equal(readMemory({ totalmem: () => 0, freemem: () => 0, now }).code, 'MEMORY_VALUE_INVALID');
  assert.equal(readMemory({ totalmem: () => 100, freemem: () => 200, now }).code, 'MEMORY_VALUE_INVALID');
  assert.equal(readMemory({ totalmem: () => NaN, freemem: () => 1, now }).code, 'MEMORY_VALUE_INVALID');
  assert.equal(readMemory({ totalmem: () => { throw new Error('x'); }, freemem: () => 1, now }).code, 'MEMORY_READ_FAILED');
});

// ---- 디스크 ----
test('디스크: 블록 수와 크기에서 전체·남은 용량·사용률을 계산한다', async () => {
  const result = await readDisk({ path: 'C:\\', readStats: async () => ({ blocks: 1000, bsize: 4096, bavail: 250 }), now });
  assert.equal(result.status, 'ok');
  assert.equal(result.totalBytes, 4_096_000);
  assert.equal(result.freeBytes, 1_024_000);
  assert.equal(result.percent, 75);
});

test('디스크: 읽기 실패와 이상한 값은 확인 불가로 둔다', async () => {
  assert.equal((await readDisk({ readStats: async () => { throw new Error('접근 거부'); }, now })).code, 'DISK_READ_FAILED');
  assert.equal((await readDisk({ readStats: async () => ({ blocks: 0, bsize: 4096, bavail: 0 }), now })).code, 'DISK_VALUE_INVALID');
  assert.equal((await readDisk({ readStats: async () => ({ blocks: 10, bsize: 4096, bavail: 99 }), now })).code, 'DISK_VALUE_INVALID');
});

test('하나가 실패해도 나머지는 그대로 돌려준다', async () => {
  const result = await readHostMetrics({
    now,
    cpu: { cpus: () => { throw new Error('x'); }, wait: noWait },
    memory: { totalmem: () => 100, freemem: () => 50 },
    disk: { readStats: async () => ({ blocks: 100, bsize: 1, bavail: 50 }) },
  });
  assert.equal(result.cpu.status, 'unavailable');
  assert.equal(result.memory.percent, 50);
  assert.equal(result.disk.percent, 50);
});

// ---- 이 PC에서 실제로 잰 값 확인(예시가 아닌 실측). 값 자체는 PC마다 달라 범위와 형식만 봅니다. ----
test('실측: 이 PC의 값을 읽으면 범위 안의 숫자와 측정 시각이 나온다', async () => {
  const result = await readHostMetrics();
  for (const key of ['cpu', 'memory', 'disk']) {
    const item = result[key];
    assert.ok(['ok', 'unavailable'].includes(item.status), `${key} 상태`);
    assert.ok(Number.isFinite(Date.parse(item.measuredAt)), `${key} 측정 시각`);
    if (item.status === 'ok') {
      assert.equal(item.source, SOURCE_MEASURED);
      assert.ok(item.percent >= 0 && item.percent <= 100, `${key} 사용률 범위`);
    }
  }
  assert.equal(result.memory.status, 'ok');
});

// ---- 표시: 단위, 잰 시각, 확인 불가 이유 (가짜 입력으로 형식만 확인, 실측이 아님) ----
const GB = 1024 ** 3;
const snapshot = (at, { cpu, memPct, memUsed, diskPct, diskFree }) => ({
  measuredAt: at,
  cpu: cpu === null
    ? { status: 'unavailable', code: 'CPU_READ_FAILED', measuredAt: at }
    : { status: 'ok', source: 'measured', percent: cpu, cores: 12, intervalMs: 250, measuredAt: at },
  memory: { status: 'ok', source: 'measured', totalBytes: 16 * GB, usedBytes: memUsed * GB, freeBytes: (16 - memUsed) * GB, percent: memPct, measuredAt: at },
  disk: { status: 'ok', source: 'measured', path: 'C:\\', totalBytes: 100 * GB, usedBytes: (100 - diskFree) * GB, freeBytes: diskFree * GB, percent: diskPct, measuredAt: at },
});
const base = { cpu: 10, memPct: 40, memUsed: 6, diskPct: 50, diskFree: 50 };

test('표시: 단위와 한국 시각 형식', () => {
  assert.equal(formatGb(16 * GB), '16.0 GB');
  assert.equal(formatPercent(4.26), '4.3 %');
  assert.equal(formatLocalTime('2026-10-27T07:04:10.413Z'), '16:04:10');
  assert.equal(formatLocalTime('깨진 값'), '시각 없음');
  assert.match(reasonText('DISK_READ_FAILED'), /디스크/u);
  assert.equal(reasonText('없는코드'), '읽지 못한 이유를 알 수 없습니다.');
});

test('표시: 실측 줄에는 단위·측정 시각이, 확인 불가 줄에는 이유와 코드가 붙고 숫자는 없다', () => {
  const [cpu, memory, disk] = describeHostMetrics(snapshot('2026-10-27T07:04:10.413Z', { ...base, cpu: null, memPct: 43.3, memUsed: 6.9, diskPct: 58.6, diskFree: 41.4 }));
  assert.equal(cpu.status, 'unavailable');
  assert.equal(cpu.text, '확인 불가');
  assert.match(cpu.note, /CPU_READ_FAILED/u);
  assert.equal(cpu.badge, '확인 불가 · 시도 16:04:10');
  assert.equal(memory.badge, '실측 · 측정 16:04:10');
  assert.equal(memory.text, '사용 6.9 GB / 전체 16.0 GB (사용률 43.3 %)');
  assert.match(disk.text, /남은 공간 41\.4 GB/u);
  assert.match(disk.note, /드라이브 C:/u);
});

test('표시: 출처가 실측이 아닌 값이나 값이 없는 입력은 실측으로 보이지 않는다', () => {
  const fake = snapshot('2026-10-27T07:04:10.413Z', base);
  fake.cpu.source = 'example';
  assert.equal(describeHostMetrics(fake)[0].status, 'unavailable');
  assert.equal(describeHostMetrics(undefined).every((row) => row.status === 'unavailable'), true);
});

// ---- 추이 비교 ----
test('추이: 직전 대비 변화량, 구간 평균과 최대를 계산한다', () => {
  const trend = createTrend({ capacity: 10 });
  trend.add(snapshot('2026-10-27T07:00:00.000Z', { cpu: 10, memPct: 40, memUsed: 6.4, diskPct: 50, diskFree: 50 }));
  trend.add(snapshot('2026-10-27T07:00:10.000Z', { cpu: 30, memPct: 45, memUsed: 7.2, diskPct: 50, diskFree: 49 }));
  trend.add(snapshot('2026-10-27T07:00:20.000Z', { cpu: 20, memPct: 50, memUsed: 8, diskPct: 51, diskFree: 48 }));
  const summary = trend.summary();
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.from, '2026-10-27T07:00:00.000Z');
  const cpu = summary.series.find((item) => item.id === 'cpu.percent');
  assert.equal(cpu.latest.value, 20);
  assert.equal(cpu.comparison.delta, -10);
  assert.equal(cpu.average, 20);
  assert.deepEqual(cpu.max, { at: '2026-10-27T07:00:10.000Z', value: 30 });
  assert.equal(summary.series.find((item) => item.id === 'disk.freeBytes').comparison.delta, -1 * GB);
  const text = describeTrend(summary);
  assert.equal(text.rows.find((row) => row.id === 'cpu.percent').text,
    '최근 20.0 % (16:00:20) · 직전 대비 -10.0 %p · 평균 20.0 % · 최대 30.0 % (16:00:10)');
  assert.match(text.rows.find((row) => row.id === 'disk.freeBytes').text, /직전 대비 -1\.0 GB/u);
  assert.match(text.period, /샘플 3개, 이 앱이 켜진 뒤 잰 값만/u);
});

test('추이: 읽지 못한 샘플은 계산에서 빼고 몇 개를 뺐는지 밝힌다', () => {
  const trend = createTrend();
  trend.add(snapshot('2026-10-27T07:00:00.000Z', { ...base, cpu: 10 }));
  trend.add(snapshot('2026-10-27T07:00:10.000Z', { ...base, cpu: null }));
  trend.add(snapshot('2026-10-27T07:00:20.000Z', { ...base, cpu: 30 }));
  const cpu = trend.summary().series.find((item) => item.id === 'cpu.percent');
  assert.equal(cpu.usableSamples, 2);
  assert.equal(cpu.excludedSamples, 1);
  assert.equal(cpu.comparison.delta, 20, '확인 불가 샘플을 0으로 채우지 않고 직전에 읽은 값과 비교한다');
  assert.equal(cpu.comparison.from, '2026-10-27T07:00:00.000Z');
  assert.match(describeTrend(trend.summary()).rows.find((row) => row.id === 'cpu.percent').note, /제외한 샘플 1개/u);
});

test('추이: 값이 부족하거나 하나도 없으면 변화량을 만들지 않는다', () => {
  const empty = createTrend().summary();
  assert.equal(empty.sampleCount, 0);
  assert.equal(empty.series.every((item) => item.status === 'unavailable' && item.code === TREND_NO_USABLE_SAMPLE), true);
  assert.equal(describeTrend(empty).period, '아직 잰 값이 없습니다');
  const one = createTrend();
  one.add(snapshot('2026-10-27T07:00:00.000Z', base));
  const cpu = one.summary().series.find((item) => item.id === 'cpu.percent');
  assert.equal(cpu.comparison, null);
  assert.equal(cpu.code, TREND_NEEDS_TWO_SAMPLES);
  assert.match(describeTrend(one.summary()).rows[0].note, /비교할 값이 부족합니다/u);
});

test('추이: 보관 개수를 넘으면 오래된 값부터 버리고 형식이 틀린 값은 넣지 않는다', () => {
  const trend = createTrend({ capacity: 3 });
  for (let i = 0; i < 5; i += 1) assert.equal(trend.add(snapshot(`2026-10-27T07:00:0${i}.000Z`, { ...base, cpu: i })), true);
  assert.equal(trend.size(), 3);
  assert.equal(trend.summary().from, '2026-10-27T07:00:02.000Z');
  assert.equal(trend.add(null), false);
  assert.equal(trend.add({ measuredAt: '깨진 값' }), false);
  assert.equal(trend.size(), 3);
  for (const bad of [1, 0, 601, 2.5, NaN]) assert.throws(() => createTrend({ capacity: bad }), /TREND_CAPACITY_INVALID/u);
});

test('추이: 실제 측정 결과를 두 번 넣으면 이 PC의 값으로 비교가 만들어진다 (실측)', async () => {
  const trend = createTrend();
  trend.add(await readHostMetrics());
  trend.add(await readHostMetrics());
  const memory = trend.summary().series.find((item) => item.id === 'memory.percent');
  assert.equal(memory.status, 'ok');
  assert.equal(memory.usableSamples, 2);
  assert.equal(Number.isFinite(memory.comparison.delta), true);
});

test('추이: 소수 1자리에서 0으로 읽히는 변화는 -0.0이 아니라 ±0.0으로 보인다', () => {
  const trend = createTrend();
  trend.add(snapshot('2026-10-27T07:00:00.000Z', { ...base, memUsed: 6.9, diskFree: 158.6 }));
  trend.add(snapshot('2026-10-27T07:00:10.000Z', { ...base, memUsed: 6.9 - 0.01, diskFree: 158.6 - 0.02 }));
  const text = describeTrend(trend.summary());
  assert.match(text.rows.find((row) => row.id === 'memory.usedBytes').text, /직전 대비 ±0\.0 GB/u);
  assert.match(text.rows.find((row) => row.id === 'disk.freeBytes').text, /직전 대비 ±0\.0 GB/u);
  assert.match(text.rows.find((row) => row.id === 'cpu.percent').text, /직전 대비 ±0\.0 %p/u);
  assert.equal(text.rows.some((row) => row.text.includes('-0.0')), false);
});
