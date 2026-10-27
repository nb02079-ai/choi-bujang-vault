// 이 PC 상태 관제 화면입니다(학생 영역). 서버(src/host-status-server.mjs)가 돌려준 값만 글자로 그립니다.
// - 모든 값은 createElement와 textContent로만 넣습니다. 문자열을 HTML로 해석하지 않습니다.
// - 「실측」은 이 PC에서 방금 읽은 값, 「확인 불가」는 읽지 못해 값을 보이지 않는 항목입니다. 이 화면이 값을 만들거나 예시 값으로 채우지 않습니다.
// - 조회에 실패하면 이전 값이나 예시 값을 남기지 않고, 실패한 항목과 다음에 할 일만 보입니다.
// - 「보호 현황」 탭이 선택됐을 때만 보입니다. 처음 보일 때 한 번 조회하고 그 뒤에는 「다시 조회」를 눌렀을 때만 조회합니다.
export const ENDPOINT = '/api/host-status';
export const TITLE = '이 PC 상태 관제';
const PANEL_ID = 'host-dashboard';
const TAB_ID = 'tab-protection';
const SEOUL_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const timeText = (iso) => (Number.isFinite(Date.parse(iso)) ? SEOUL_TIME.format(new Date(iso)) : '시각 없음');
const START_HINT = '이 앱을 tools\\start-host-status.ps1 또는 node src/host-status-server.mjs 로 실행했는지 확인하세요. 기존 시작 스크립트로 실행하면 이 기능이 없습니다.';

// ---- 응답 확인 ----
const isText = (value) => typeof value === 'string';
const isList = (value) => Array.isArray(value);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 서버 응답이 화면이 기대하는 모양인지 확인합니다. 하나라도 틀리면 사용하지 않습니다. */
export function isValidStatus(data) {
  if (!isObject(data) || !isList(data.cards) || data.cards.length !== 4 || !isObject(data.trend) || !isList(data.trend.rows) || !isText(data.trend.period)) return false;
  if (!isList(data.records) || !isObject(data.sdp) || !isText(data.sdp.label) || !isText(data.sdp.note) || !isText(data.notice)) return false;
  const cardOk = (card) => isObject(card) && ['cpu', 'memory', 'disk', 'firewall'].includes(card.key) && ['ok', 'unavailable'].includes(card.status)
    && isText(card.label) && isText(card.badge) && isText(card.value) && isText(card.detail) && (card.status !== 'unavailable' || isText(card.nextStep));
  const recordOk = (row) => isObject(row) && isText(row.key) && isText(row.label) && isText(row.status) && isText(row.badge) && isList(row.lines) && isText(row.note);
  return data.cards.every(cardOk) && new Set(data.cards.map((card) => card.key)).size === 4 && data.records.every(recordOk)
    && data.trend.rows.every((row) => isObject(row) && isText(row.label) && isText(row.text));
}

/** 조회 실패를 화면에 보일 내용으로 바꿉니다. 값은 없고 실패한 항목, 이유, 다음에 할 일만 있습니다. */
export function describeFailure({ status = null, body = null, error = null } = {}) {
  const item = 'PC 상태 전체(카드 4개, 추이, 기록)';
  if (error) return { code: 'NETWORK_ERROR', failedItem: item, message: 'PC 상태 서버에 연결하지 못했습니다.', nextStep: `${START_HINT} 서버가 꺼져 있다면 다시 실행한 뒤 「다시 조회」를 눌러 주세요.` };
  if (status === 404) return { code: 'HOST_STATUS_NOT_AVAILABLE', failedItem: item, message: '이 실행에는 PC 상태 조회 기능이 없습니다.', nextStep: START_HINT };
  if (isObject(body) && isObject(body.error) && isText(body.error.code)) {
    return { code: body.error.code, failedItem: item, message: isText(body.error.message) ? body.error.message : 'PC 상태를 읽지 못했습니다.', nextStep: isText(body.error.nextStep) ? body.error.nextStep : '「다시 조회」를 눌러 주세요.' };
  }
  if (status !== null && status !== 200) return { code: `HTTP_${status}`, failedItem: item, message: `서버가 오류로 답했습니다 (HTTP ${status}).`, nextStep: '「다시 조회」를 눌러 주세요. 계속되면 서버를 다시 실행하세요.' };
  return { code: 'RESPONSE_INVALID', failedItem: item, message: '서버 응답의 형식이 올바르지 않아 사용하지 않았습니다.', nextStep: '「다시 조회」를 눌러 보세요. 계속되면 서버를 다시 실행하세요.' };
}

/** 서버에서 한 번 읽어 옵니다. 성공하면 확인된 값만, 실패하면 실패 내용만 돌려줍니다. */
export async function loadHostStatus(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(ENDPOINT, { method: 'GET', cache: 'no-store', headers: { accept: 'application/json' } });
  } catch (error) {
    return { ok: false, failure: describeFailure({ error: error ?? new Error('fetch') }) };
  }
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.status === 200 && body?.ok === true && isValidStatus(body.data)) return { ok: true, data: body.data };
  return { ok: false, failure: describeFailure({ status: response.status, body }) };
}

// ---- 그리기 ----
function makeEl(document) {
  return (tag, { className, text, attrs } = {}) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, String(value));
    return node;
  };
}

function cardNode(el, card) {
  const node = el('li', { className: 'hp-card', attrs: { 'data-key': card.key, 'data-status': card.status } });
  node.append(el('h3', { className: 'hp-card-title', text: card.label }), el('p', { className: 'hp-badge', text: card.badge }), el('p', { className: 'hp-value', text: card.value }));
  if (card.status === 'ok' && Number.isFinite(card.percent)) {
    node.append(el('meter', { className: 'hp-meter', text: `${card.percent} %`, attrs: { min: 0, max: 100, value: card.percent, 'aria-label': `${card.label} 사용률 ${card.percent} %` } }));
  }
  node.append(el('p', { className: 'hp-detail', text: card.detail }));
  if (card.status === 'unavailable') node.append(el('p', { className: 'hp-next', text: `다음에 할 일: ${card.nextStep}` }));
  return node;
}

function recordNode(el, row) {
  const node = el('li', { className: 'hp-record', attrs: { 'data-key': row.key, 'data-status': row.status } });
  node.append(el('h4', { className: 'hp-record-title', text: row.label }), el('p', { className: 'hp-badge', text: row.badge }));
  const lines = el('ul', { className: 'hp-lines' });
  for (const line of row.lines) lines.append(el('li', { text: line }));
  node.append(lines, el('p', { className: 'hp-detail', text: row.note }));
  if (row.status === 'unavailable' && isText(row.nextStep)) node.append(el('p', { className: 'hp-next', text: `다음에 할 일: ${row.nextStep}` }));
  return node;
}

function successNodes(el, data) {
  const cards = el('ul', { className: 'hp-cards', attrs: { 'aria-label': '이 PC 상태 카드 4개' } });
  for (const card of data.cards) cards.append(cardNode(el, card));
  const trend = el('section', { className: 'hp-section', attrs: { 'aria-label': '추이' } });
  trend.append(el('h3', { text: '추이' }), el('p', { className: 'hp-detail', text: data.trend.period }));
  const trendList = el('ul', { className: 'hp-lines' });
  for (const row of data.trend.rows) trendList.append(el('li', { text: `${row.label}: ${row.text}${isText(row.note) && row.note ? ` (${row.note})` : ''}` }));
  trend.append(trendList);
  const records = el('section', { className: 'hp-section', attrs: { 'aria-label': '기록' } });
  records.append(el('h3', { text: '기록' }), el('p', { className: 'hp-notice', text: data.notice }));
  const recordList = el('ul', { className: 'hp-records' });
  for (const row of data.records) recordList.append(recordNode(el, row));
  records.append(recordList);
  // SDP 연결 상태는 PC에서 잰 값과 별개이므로 따로 둡니다.
  const sdp = el('section', { className: 'hp-section hp-sdp', attrs: { 'aria-label': 'SDP 연결 상태' } });
  sdp.append(el('h3', { text: 'SDP 연결 상태 (PC에서 잰 값과 별개)' }), el('p', { className: 'hp-badge', text: data.sdp.label }), el('p', { className: 'hp-detail', text: data.sdp.note }));
  return [cards, trend, records, sdp];
}

function failureNode(el, failure, lastSuccessAt) {
  const node = el('div', { className: 'hp-failure', attrs: { role: 'alert' } });
  node.append(
    el('h3', { text: '조회에 실패했습니다' }),
    el('p', { className: 'hp-detail', text: `실패한 항목: ${failure.failedItem}` }),
    el('p', { className: 'hp-detail', text: `이유: ${failure.message} (${failure.code})` }),
    el('p', { className: 'hp-next', text: `다음에 할 일: ${failure.nextStep}` }),
    el('p', { className: 'hp-detail', text: `이전 값이나 예시 값은 보이지 않습니다. ${lastSuccessAt ? `마지막으로 조회에 성공한 시각: ${lastSuccessAt}` : '아직 조회에 성공한 적이 없습니다.'}` }),
  );
  return node;
}

/** 관제 화면을 만듭니다. root 안에 한 번만 그리고, 이후에는 본문만 바꿔 키보드 위치(「다시 조회」)가 유지됩니다. */
export function createHostPanel({ document, root, fetchImpl, legend } = {}) {
  const el = makeEl(document);
  const button = el('button', { className: 'btn', text: '다시 조회', attrs: { type: 'button', id: 'host-refresh' } });
  const status = el('p', { className: 'hp-status', text: '아직 조회하지 않았습니다.', attrs: { role: 'status', 'aria-live': 'polite', id: 'host-status-text' } });
  const body = el('div', { className: 'hp-body', attrs: { id: 'host-status-body' } });
  const heading = el('h2', { className: 'hp-title' });
  heading.append(el('span', { text: TITLE }), el('span', { className: 'tag tag-student', text: 'student/host-panel.mjs' }));
  const head = el('div', { className: 'hp-head' });
  head.append(heading, button);
  const help = el('p', { className: 'hp-detail', text: legend ?? '실측 = 이 PC에서 방금 읽은 값 · 예시 = 설명용 값(PC 값에는 쓰지 않습니다) · 확인 불가 = 읽지 못해 값을 보이지 않습니다. 자동으로 다시 조회하지 않으며 「다시 조회」를 눌렀을 때만 새로 읽습니다.' });
  root.replaceChildren(head, status, help, body);
  root.setAttribute('aria-busy', 'false');
  const state = { phase: 'idle', lastSuccessAt: null, running: null };
  button.setAttribute('aria-describedby', 'host-status-text');

  function setPhase(phase, text) {
    state.phase = phase;
    status.textContent = text;
    root.setAttribute('aria-busy', String(phase === 'loading'));
    button.setAttribute('aria-disabled', String(phase === 'loading'));
    root.setAttribute('data-phase', phase);
  }

  async function refresh() {
    if (state.running) return state.running;
    // 읽는 동안에는 이전 값을 실측처럼 남기지 않고 대기 표시만 보입니다. 숫자는 없습니다.
    setPhase('loading', '조회 중입니다. 이 PC의 값을 새로 읽고 있습니다 (약 2초 걸립니다).');
    body.replaceChildren(el('p', { className: 'hp-wait', text: '조회 중… 값이 도착하기 전에는 아무 값도 보이지 않습니다.' }));
    state.running = (async () => {
      const result = await loadHostStatus(fetchImpl);
      if (result.ok) {
        state.lastSuccessAt = timeText(result.data.generatedAt);
        body.replaceChildren(...successNodes(el, result.data));
        const unreadable = result.data.cards.filter((card) => card.status === 'unavailable').length;
        setPhase('ok', `조회 완료 (${state.lastSuccessAt}). 카드 4개 중 ${4 - unreadable}개를 읽었고 ${unreadable}개는 확인 불가입니다.`);
      } else {
        body.replaceChildren(failureNode(el, result.failure, state.lastSuccessAt));
        setPhase('error', `조회 실패: ${result.failure.message} (${result.failure.code})`);
      }
    })().finally(() => { state.running = null; });
    return state.running;
  }

  button.addEventListener('click', () => { if (state.phase !== 'loading') refresh(); });
  return { refresh, state, button, status, body, root };
}

/** 「보호 현황」 탭이 선택됐을 때만 관제 화면을 보입니다. 탭을 찾지 못하면 숨기지 않고 보입니다. */
export function watchProtectionTab({ document, root, onShow, MutationObserverImpl = globalThis.MutationObserver } = {}) {
  const tab = document.getElementById(TAB_ID);
  let shown = false;
  const sync = () => {
    const visible = tab ? tab.getAttribute('aria-selected') === 'true' : true;
    root.hidden = !visible;
    root.setAttribute('data-tab-guard', tab ? 'protection-only' : 'tab-not-found');
    if (visible && !shown) { shown = true; onShow?.(); }
  };
  sync();
  if (tab && typeof MutationObserverImpl === 'function') new MutationObserverImpl(sync).observe(tab, { attributes: true, attributeFilter: ['aria-selected'] });
  return { sync };
}

/** 서버가 끼워 넣은 자리(#host-dashboard)에 관제 화면을 붙입니다. 자리가 없으면 아무것도 하지 않습니다. */
export function mountHostPanel({ document, fetchImpl = globalThis.fetch?.bind(globalThis), MutationObserverImpl } = {}) {
  const root = document?.getElementById(PANEL_ID);
  if (!root) return null;
  const panel = createHostPanel({ document, root, fetchImpl: fetchImpl ?? (async () => { throw new Error('fetch 없음'); }) });
  watchProtectionTab({ document, root, onShow: () => { panel.refresh(); }, MutationObserverImpl });
  return panel;
}

if (typeof document !== 'undefined') mountHostPanel({ document });
