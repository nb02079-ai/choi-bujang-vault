// 이 PC의 CPU·메모리·디스크를 실제로 재서 측정 시각과 함께 돌려줍니다. 읽기만 하며 아무것도 바꾸지 않습니다.
// 값은 두 가지로만 나옵니다.
//   status 'ok'          : 이번에 실제로 잰 값(source 'measured')이며 measuredAt이 그 시각입니다.
//   status 'unavailable' : 읽지 못했거나 값이 이상해서 숫자를 보이지 않습니다. 이유는 code에 적습니다.
// 예시 값은 이 모듈이 만들지 않습니다. 설명용 예시는 화면의 예제 모드가 따로 표시합니다.
import os from 'node:os';
import { statfs } from 'node:fs/promises';

export const SOURCE_MEASURED = 'measured';
export const CPU_INTERVAL_MS = 250;

const round1 = (value) => Math.round(value * 10) / 10;
const isCount = (value) => Number.isFinite(value) && value >= 0;
const isoAt = (now) => new Date(now()).toISOString();
const unavailable = (code, now) => ({ status: 'unavailable', code, measuredAt: isoAt(now) });
const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// 코어별 누적 시간(밀리초)을 합쳐 놀고 있던 시간과 전체 시간을 구합니다.
function totals(cpus) {
  let idle = 0;
  let total = 0;
  for (const core of cpus) {
    const t = core?.times;
    if (!t) return null;
    const parts = [t.user, t.nice, t.sys, t.idle, t.irq];
    if (!parts.every(isCount)) return null;
    idle += t.idle;
    total += parts.reduce((sum, part) => sum + part, 0);
  }
  return { idle, total };
}

/** CPU 사용률: 짧은 간격 두 번의 누적 시간 차이로 계산합니다. 한 시점의 값이 아니라 그 간격의 평균입니다. */
export async function readCpu({ cpus = os.cpus, wait = delay, now = Date.now, intervalMs = CPU_INTERVAL_MS } = {}) {
  try {
    const first = cpus();
    if (!Array.isArray(first) || first.length === 0) return unavailable('CPU_NOT_READABLE', now);
    const before = totals(first);
    if (!before) return unavailable('CPU_VALUE_INVALID', now);
    await wait(intervalMs);
    const second = cpus();
    const after = totals(second);
    if (!after || second.length !== first.length) return unavailable('CPU_VALUE_INVALID', now);
    const total = after.total - before.total;
    const idle = after.idle - before.idle;
    if (!(total > 0) || idle < 0 || idle > total) return unavailable('CPU_SAMPLE_EMPTY', now);
    return { status: 'ok', source: SOURCE_MEASURED, percent: round1(((total - idle) / total) * 100), cores: second.length, intervalMs, measuredAt: isoAt(now) };
  } catch {
    return unavailable('CPU_READ_FAILED', now);
  }
}

/** 메모리: 전체와 비어 있는 양에서 사용량과 사용률을 계산합니다. */
export function readMemory({ totalmem = os.totalmem, freemem = os.freemem, now = Date.now } = {}) {
  try {
    const total = totalmem();
    const free = freemem();
    if (!(Number.isFinite(total) && total > 0) || !isCount(free) || free > total) return unavailable('MEMORY_VALUE_INVALID', now);
    const used = total - free;
    return { status: 'ok', source: SOURCE_MEASURED, totalBytes: total, usedBytes: used, freeBytes: free, percent: round1((used / total) * 100), measuredAt: isoAt(now) };
  } catch {
    return unavailable('MEMORY_READ_FAILED', now);
  }
}

/** 디스크: 시스템 드라이브의 전체와 남은 용량을 읽습니다. 파일을 만들거나 쓰지 않습니다. */
export async function readDisk({ path = `${process.env.SystemDrive ?? 'C:'}\\`, readStats = statfs, now = Date.now } = {}) {
  try {
    const stats = await readStats(path);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (!(Number.isFinite(total) && total > 0) || !isCount(free) || free > total) return unavailable('DISK_VALUE_INVALID', now);
    const used = total - free;
    return { status: 'ok', source: SOURCE_MEASURED, path, totalBytes: total, usedBytes: used, freeBytes: free, percent: round1((used / total) * 100), measuredAt: isoAt(now) };
  } catch {
    return unavailable('DISK_READ_FAILED', now);
  }
}

// ---- 표시용 도우미: 값마다 단위와 잰 시각을 붙이고, 읽지 못한 값은 이유와 함께 확인 불가로 보입니다. ----
export const UNAVAILABLE_REASONS = Object.freeze({
  CPU_NOT_READABLE: 'CPU 정보를 읽지 못했습니다.',
  CPU_VALUE_INVALID: 'CPU 값이 올바르지 않아 사용하지 않았습니다.',
  CPU_SAMPLE_EMPTY: '측정 간격 동안 CPU 시간 변화가 없어 사용률을 계산할 수 없습니다.',
  CPU_READ_FAILED: 'CPU 값을 읽는 중 오류가 났습니다.',
  MEMORY_VALUE_INVALID: '메모리 값이 올바르지 않아 사용하지 않았습니다.',
  MEMORY_READ_FAILED: '메모리 값을 읽는 중 오류가 났습니다.',
  DISK_VALUE_INVALID: '디스크 값이 올바르지 않아 사용하지 않았습니다.',
  DISK_READ_FAILED: '디스크 정보를 읽지 못했습니다.',
});
export const reasonText = (code) => (Object.hasOwn(UNAVAILABLE_REASONS, code) ? UNAVAILABLE_REASONS[code] : '읽지 못한 이유를 알 수 없습니다.');

const GIB = 1024 ** 3;
const SEOUL_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export const formatPercent = (value) => `${value.toFixed(1)} %`;
export const formatGb = (bytes) => `${(bytes / GIB).toFixed(1)} GB`;
/** 한국 시각 HH:MM:SS. 시각을 읽을 수 없으면 「시각 없음」. */
export const formatLocalTime = (iso) => (Number.isFinite(Date.parse(iso)) ? SEOUL_TIME.format(new Date(iso)) : '시각 없음');

/** 화면과 설명에 그대로 쓸 줄을 만듭니다. 실측과 확인 불가는 글자로 구분하며 예시 값은 만들지 않습니다. */
export function describeHostMetrics(result) {
  const rows = [
    ['cpu', 'CPU 사용률', (v) => ({ text: formatPercent(v.percent), note: `${v.intervalMs}ms 평균, 논리 코어 ${v.cores}개` })],
    ['memory', '메모리', (v) => ({ text: `사용 ${formatGb(v.usedBytes)} / 전체 ${formatGb(v.totalBytes)} (사용률 ${formatPercent(v.percent)})`, note: '1 GB = 1024³ 바이트' })],
    ['disk', '디스크', (v) => ({ text: `남은 공간 ${formatGb(v.freeBytes)} / 전체 ${formatGb(v.totalBytes)} (사용률 ${formatPercent(v.percent)})`, note: `드라이브 ${v.path}` })],
  ];
  return rows.map(([key, label, show]) => {
    const value = result?.[key];
    const at = formatLocalTime(value?.measuredAt);
    if (value?.status === 'ok' && value.source === SOURCE_MEASURED) {
      return { key, label, status: 'ok', badge: `실측 · 측정 ${at}`, measuredAt: value.measuredAt, ...show(value) };
    }
    const code = typeof value?.code === 'string' ? value.code : 'NOT_READ';
    return { key, label, status: 'unavailable', badge: `확인 불가 · 시도 ${at}`, measuredAt: value?.measuredAt ?? null, text: '확인 불가', note: `${reasonText(code)} (${code})` };
  });
}

/** 세 가지를 한 번에 읽습니다. 하나가 실패해도 나머지는 그대로 돌려주고 실패한 것만 확인 불가로 남깁니다. */
export async function readHostMetrics(options = {}) {
  const now = options.now ?? Date.now;
  const [cpu, disk] = await Promise.all([readCpu({ ...options.cpu, now }), readDisk({ ...options.disk, now })]);
  return { measuredAt: isoAt(now), cpu, memory: readMemory({ ...options.memory, now }), disk };
}
