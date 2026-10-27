// 앱이 켜져 있는 동안 잰 값을 메모리에만 모아 직전 값과 비교하고 구간 평균·최대를 계산합니다.
// - 디스크에 아무것도 쓰지 않습니다. 앱을 끄면 사라집니다.
// - 읽지 못한 값(확인 불가)은 계산에서 빼고 몇 개를 뺐는지 밝힙니다. 예시 값으로 빈 곳을 채우지 않습니다.
// - 비교할 값이 두 개 미만이면 변화량을 만들지 않고 이유를 돌려줍니다.
import { formatPercent, formatGb, formatLocalTime } from './host-metrics.mjs';

export const DEFAULT_CAPACITY = 60;
export const MIN_CAPACITY = 2;
export const MAX_CAPACITY = 600;
export const TREND_NEEDS_TWO_SAMPLES = 'TREND_NEEDS_TWO_SAMPLES';
export const TREND_NO_USABLE_SAMPLE = 'TREND_NO_USABLE_SAMPLE';

// 추이로 보는 값. kind가 percent면 %p로, bytes면 GB로 변화량을 씁니다.
const SERIES = Object.freeze([
  { key: 'cpu', field: 'percent', label: 'CPU 사용률', kind: 'percent' },
  { key: 'memory', field: 'percent', label: '메모리 사용률', kind: 'percent' },
  { key: 'memory', field: 'usedBytes', label: '메모리 사용량', kind: 'bytes' },
  { key: 'disk', field: 'percent', label: '디스크 사용률', kind: 'percent' },
  { key: 'disk', field: 'freeBytes', label: '디스크 남은 공간', kind: 'bytes' },
]);
const seriesId = (item) => `${item.key}.${item.field}`;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function toSample(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Number.isFinite(Date.parse(snapshot.measuredAt))) return null;
  const values = {};
  for (const item of SERIES) {
    const metric = snapshot[item.key];
    values[seriesId(item)] = metric?.status === 'ok' && metric.source === 'measured' && isNumber(metric[item.field]) ? metric[item.field] : null;
  }
  return { measuredAt: snapshot.measuredAt, values };
}

function summarizeSeries(item, samples) {
  const id = seriesId(item);
  const usable = samples.filter((sample) => sample.values[id] !== null).map((sample) => ({ at: sample.measuredAt, value: sample.values[id] }));
  const base = { id, label: item.label, kind: item.kind, usableSamples: usable.length, excludedSamples: samples.length - usable.length };
  if (usable.length === 0) return { ...base, status: 'unavailable', code: TREND_NO_USABLE_SAMPLE };
  const latest = usable[usable.length - 1];
  const sum = usable.reduce((total, point) => total + point.value, 0);
  const max = usable.reduce((best, point) => (point.value > best.value ? point : best), usable[0]);
  const result = { ...base, status: 'ok', latest, average: sum / usable.length, max };
  if (usable.length < 2) return { ...result, comparison: null, code: TREND_NEEDS_TWO_SAMPLES };
  const previous = usable[usable.length - 2];
  return { ...result, previous, comparison: { delta: latest.value - previous.value, from: previous.at, to: latest.at } };
}

/** 추이 보관함을 만듭니다. capacity개를 넘으면 가장 오래된 값부터 버립니다. */
export function createTrend({ capacity = DEFAULT_CAPACITY } = {}) {
  if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) throw new RangeError('TREND_CAPACITY_INVALID');
  const samples = [];
  return {
    capacity,
    /** readHostMetrics의 결과를 한 번 넣습니다. 형식이 맞지 않으면 넣지 않고 false를 돌려줍니다. */
    add(snapshot) {
      const sample = toSample(snapshot);
      if (!sample) return false;
      samples.push(sample);
      if (samples.length > capacity) samples.shift();
      return true;
    },
    size: () => samples.length,
    summary() {
      return {
        capacity,
        sampleCount: samples.length,
        from: samples[0]?.measuredAt ?? null,
        to: samples[samples.length - 1]?.measuredAt ?? null,
        series: SERIES.map((item) => summarizeSeries(item, samples)),
      };
    },
  };
}

const show = (kind, value) => (kind === 'bytes' ? formatGb(value) : formatPercent(value));
// 화면에 보이는 자리(소수 1자리)에서 0으로 읽히는 변화는 부호 없이 ±0.0으로 보입니다. 「-0.0」은 쓰지 않습니다.
const showDelta = (kind, delta) => {
  const size = Math.abs(delta);
  const text = kind === 'bytes' ? formatGb(size) : `${size.toFixed(1)} %p`;
  if (/^0\.0\b/u.test(text)) return `±${text}`;
  return `${delta > 0 ? '+' : '-'}${text}`;
};

/** 화면과 설명에 쓸 줄을 만듭니다. 값마다 단위와 잰 시각을 붙입니다. */
export function describeTrend(summary) {
  const period = summary.sampleCount > 0
    ? `${formatLocalTime(summary.from)} ~ ${formatLocalTime(summary.to)} (샘플 ${summary.sampleCount}개, 이 앱이 켜진 뒤 잰 값만)`
    : '아직 잰 값이 없습니다';
  const rows = summary.series.map((item) => {
    if (item.status === 'unavailable') return { id: item.id, label: item.label, status: 'unavailable', text: '확인 불가', note: `구간 안에 읽은 값이 없습니다 (${item.code}, 제외 ${item.excludedSamples}개)` };
    const parts = [`최근 ${show(item.kind, item.latest.value)} (${formatLocalTime(item.latest.at)})`];
    if (item.comparison) parts.push(`직전 대비 ${showDelta(item.kind, item.comparison.delta)}`);
    parts.push(`평균 ${show(item.kind, item.average)}`, `최대 ${show(item.kind, item.max.value)} (${formatLocalTime(item.max.at)})`);
    const notes = [];
    if (!item.comparison) notes.push(`비교할 값이 부족합니다 (${TREND_NEEDS_TWO_SAMPLES}, 읽은 값 ${item.usableSamples}개)`);
    if (item.excludedSamples > 0) notes.push(`읽지 못해 제외한 샘플 ${item.excludedSamples}개`);
    return { id: item.id, label: item.label, status: 'ok', text: parts.join(' · '), note: notes.join(' · ') };
  });
  return { period, rows };
}
