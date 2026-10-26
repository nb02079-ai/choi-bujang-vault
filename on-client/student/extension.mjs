// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.

// ---------- 13단계: 로그인 사용자·기기·세션 ----------

// 응답 형식 불일치는 연결 실패가 아니라 확인 불가로 읽는다.
const UNVERIFIED_CODES = ['CONTRACT_MISMATCH', 'ENGINE_RESULT_UNVERIFIED'];

// level: ok=정상, warn=정상 아님(주의), unknown=확인 불가. 색상과 함께 글자로도 구분한다.
const DEVICE_STATUS = {
  compliant: { text: '보안 기준 충족', level: 'ok' },
  noncompliant: { text: '보안 기준 미충족', level: 'warn' },
  unknown: { text: '확인 불가', level: 'unknown' },
};
const SESSION_STATUS = {
  active: { text: '활성', level: 'ok' },
  expired: { text: '만료', level: 'warn' },
  revoked: { text: '철회됨', level: 'warn' },
  unknown: { text: '확인 불가', level: 'unknown' },
};
const LEVEL_COLORS = { ok: 'var(--allow)', warn: 'var(--deny)', unknown: 'var(--unknown)' };

// 전달받은 mode만 안내한다. connected와 mode 없음(null, 아직 응답 전)에는 안내를 붙이지 않는다.
const MODE_NOTICE = {
  demo: { text: '예제 자료: 실제 회사 시스템의 값이 아닙니다 (demo)', className: 'tag tag-demo' },
  disconnected: { text: '연결 없음: 실제 회사 시스템에 연결되지 않았습니다 (disconnected)', className: 'tag' },
  unknown: { text: '확인 불가: 자료의 연결 상태를 확인할 수 없습니다 (unknown)', className: 'tag' },
};

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function field(list, name, value) {
  const dd = document.createElement('dd');
  if (value instanceof Element) dd.append(value);
  else dd.textContent = value == null || value === '' ? '정보 없음' : String(value);
  list.append(node('dt', name), dd);
}

// 원래 코드값을 괄호 안에 함께 적는다. 목록에 없는 값은 확인 불가로 둔다.
function statusText(labels, code) {
  const known = typeof code === 'string' && Object.hasOwn(labels, code) ? labels[code] : null;
  const level = known ? known.level : 'unknown';
  const text = known ? known.text : '확인 불가';
  const prefix = level === 'warn' ? '주의: ' : '';
  const span = node('span', `${prefix}${text} (${code == null ? '값 없음' : code})`);
  span.dataset.level = level;
  span.style.color = LEVEL_COLORS[level];
  if (level === 'warn') span.style.fontWeight = '600';
  return span;
}

// 자료 하나(me·devices·sessions)의 loading / ok / error를 글자로 구분한다.
// 이전 호출의 값을 보관하지 않으므로 오류 화면에 옛 사용자 값이 남지 않는다.
function resourceBlock(resource, renderOk) {
  const block = document.createElement('div');
  const status = resource && resource.status;
  const mode = resource && resource.mode;
  if (typeof mode === 'string' && Object.hasOwn(MODE_NOTICE, mode)) {
    block.append(node('p', MODE_NOTICE[mode].text, MODE_NOTICE[mode].className));
  }
  if (status === 'loading') {
    block.append(node('p', '불러오는 중', 'state state-loading'));
  } else if (status === 'error') {
    const error = resource.error || {};
    const head = UNVERIFIED_CODES.includes(error.code) ? '확인 불가' : '연결 실패';
    const message = error.message || '서버 메시지 없음';
    block.append(node('p', `${head}: ${message}${error.code ? ` (${error.code})` : ''}`, 'state state-error'));
  } else if (status === 'ok') {
    block.append(renderOk(resource.data));
  } else {
    block.append(node('p', `확인 불가: 알 수 없는 상태값 (${status == null ? '없음' : status})`, 'state state-empty'));
  }
  return block;
}

function identitySection(title, ...children) {
  const section = document.createElement('section');
  section.setAttribute('aria-label', title);
  section.append(node('h3', title), ...children);
  return section;
}

function renderIdentityView({ me, devices, sessions } = {}) {
  const root = node('div', null, 'student-identity');

  const account = resourceBlock(me, (data) => {
    const list = node('dl', null, 'kv');
    field(list, '사용자 이름', data.user.label);
    field(list, '사용자 ID', data.user.id);
    return list;
  });

  const currentDevice = resourceBlock(me, (data) => {
    const list = node('dl', null, 'kv');
    field(list, '기기 이름', data.device.label);
    field(list, '기기 ID', data.device.id);
    field(list, '보안 상태', statusText(DEVICE_STATUS, data.device.status));
    return list;
  });

  const deviceList = resourceBlock(devices, (data) => {
    if (data.length === 0) return node('p', '등록된 본인 기기가 없습니다.', 'state state-empty');
    const list = node('ul', null, 'plain-list');
    for (const device of data) {
      const item = document.createElement('li');
      item.append(node('span', `${device.label || '이름 정보 없음'} (${device.id})`, 'item-title'), statusText(DEVICE_STATUS, device.status));
      list.append(item);
    }
    return list;
  });

  const currentSession = resourceBlock(me, (data) => {
    const list = node('dl', null, 'kv');
    field(list, '세션 ID', data.session.id);
    field(list, '세션 상태', statusText(SESSION_STATUS, data.session.status));
    return list;
  });

  const sessionList = resourceBlock(sessions, (data) => {
    if (data.length === 0) return node('p', '표시할 본인 세션이 없습니다.', 'state state-empty');
    const list = node('ul', null, 'plain-list');
    for (const session of data) {
      const item = document.createElement('li');
      item.append(node('span', session.id, 'item-title'), statusText(SESSION_STATUS, session.status));
      list.append(item);
    }
    return list;
  });

  root.append(
    identitySection('계정', account),
    identitySection('현재 기기', currentDevice, node('h4', '내 기기 목록'), deviceList),
    identitySection('로그인 세션', currentSession, node('h4', '내 세션 목록'), sessionList),
  );
  return root;
}

// ---------- 14단계: 업무 앱 접근 판정 ----------

// 판정마다 한국어 뜻·원래 코드값·안내를 함께 보인다. 색상은 보조이고 글자로 구분한다.
const DECISIONS = {
  allow: { text: '접근 허용', color: 'var(--allow)', note: '정책상 접근 허용 판정입니다. 실제 앱 접속 성공을 보장하지 않습니다.' },
  deny: { text: '접근 거부', color: 'var(--deny)', note: '정책이 이 업무 앱 접근을 거부했습니다.' },
  challenge: { text: '추가 인증 또는 확인 필요', color: 'var(--challenge)', note: '추가 인증 또는 확인이 끝나기 전에는 접근이 허용되지 않습니다. 이 앱은 추가 인증을 대신 수행하지 않습니다.' },
  unknown: { text: '판정 확인 불가', color: 'var(--unknown)', note: '판정을 확인할 수 없어 접근이 허용되지 않음으로 취급합니다.' },
};

// 네 값이 아니면 unknown과 같은 확인 불가로 처리하고, 받은 원래 값을 따로 적는다.
function decisionText(code) {
  const known = typeof code === 'string' && Object.hasOwn(DECISIONS, code);
  const info = DECISIONS[known ? code : 'unknown'];
  const line = node('p', `${info.text} (${known ? code : 'unknown'})`, 'decision');
  line.dataset.decision = known ? code : 'unknown';
  line.style.color = info.color;
  line.style.fontWeight = '600';
  const parts = [line, node('p', info.note)];
  if (!known) parts.push(node('p', `목록에 없는 판정 값을 받았습니다: ${code == null ? '값 없음' : String(code)}`, 'muted'));
  return parts;
}

// 요청 전(idle) / 요청 중(loading) / 판정 수신(ok) / 요청 실패(error)를 먼저 나눈다.
// 호출마다 새 DOM을 만들므로 다시 불러오기(idle) 뒤 이전 판정이 남지 않는다.
function renderDecisionView({ status, data, error, appId } = {}) {
  const root = node('div', null, 'student-decision');
  if (status === 'idle') {
    root.append(node('p', '앱을 골라 접근을 요청하세요. 아직 요청한 업무 앱이 없습니다.', 'state state-empty'));
  } else if (status === 'loading') {
    root.append(node('p', `판정 확인 중 (${appId || '앱 ID 없음'})`, 'state state-loading'));
  } else if (status === 'ok') {
    const result = data || {};
    root.append(...decisionText(result.decision));
    const list = node('dl', null, 'kv');
    field(list, '업무 앱 ID', result.appId || appId);
    field(list, '판정 이유', result.reason);
    field(list, '판정 시각', result.checkedAt);
    root.append(list);
  } else if (status === 'error') {
    const message = (error && error.message) || '서버 메시지 없음';
    const code = error && error.code ? ` (${error.code})` : '';
    root.append(
      node('p', `요청 실패: ${message}${code}`, 'state state-error'),
      node('p', `업무 앱 ID: ${appId || '앱 ID 없음'}`, 'muted'),
      node('p', '서버의 판정을 받지 못했습니다. 접근 거부 판정이 아니며, 접근이 허용된 것도 아닙니다. 필요하면 직접 다시 요청하세요.'),
    );
  } else {
    root.append(node('p', `판정 확인 불가: 알 수 없는 상태값 (${status == null ? '없음' : status})`, 'state state-empty'));
  }
  return root;
}

// ---------- 15단계: 접속 기록·XDR 경보 목록과 상세 ----------

const EVENT_KINDS = { access: '접속 기록', xdr: 'XDR 경보' };
const ACCESS_STATUS = {
  allowed: { text: '접근 허용됨', level: 'ok' },
  denied: { text: '접근 거부됨', level: 'warn' },
  unknown: { text: '확인 불가', level: 'unknown' },
};

// 필터 하나: label로 접근 가능한 이름을 붙이고, 값은 all 또는 받은 원래 값이다.
function filterSelect(id, name, options, current, onPick) {
  const wrap = document.createElement('div');
  const label = node('label', name);
  label.htmlFor = id;
  const select = document.createElement('select');
  select.id = id;
  for (const [value, text] of [['all', '전체 (all)'], ...options]) {
    const option = node('option', text);
    option.value = value;
    select.append(option);
  }
  select.value = current;
  select.addEventListener('change', () => onPick(select.value));
  wrap.append(label, select);
  return wrap;
}

function kindText(kind) {
  return `${Object.hasOwn(EVENT_KINDS, kind) ? EVENT_KINDS[kind] : '종류 확인 불가'} (${kind == null ? '값 없음' : kind})`;
}

function appText(appId) {
  return appId ? appId : '앱 확인 불가 (appId 없음)';
}

// at 원래 값과 한국 시각(UTC+9)을 함께 적는다.
function timeText(at) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return `시각 확인 불가 (${at == null ? '값 없음' : at})`;
  const kst = new Date(t + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  return `${at} (한국 시각 ${kst})`;
}

// 받은 배열을 복사해 at 기준 최신순으로 정렬한다. 원본 배열은 바꾸지 않는다.
function sortEvents(list) {
  const time = (event) => { const t = Date.parse(event && event.at); return Number.isFinite(t) ? t : -Infinity; };
  return [...list].sort((a, b) => time(b) - time(a));
}

// 제공 UI가 새 자료로 부를 때마다 목록·상세를 새로 만든다. 필터 선택값만 filters에 남는다.
function renderEventsView({ status, data, error } = {}, filters) {
  const root = node('div', null, 'student-events');
  if (status === 'loading') {
    root.append(node('p', '기록을 불러오는 중', 'state state-loading'));
  } else if (status === 'error') {
    const message = (error && error.message) || '서버 메시지 없음';
    const code = error && error.code ? ` (${error.code})` : '';
    const head = error && UNVERIFIED_CODES.includes(error.code) ? '확인 불가: 기록 응답 형식을 확인할 수 없습니다' : '기록을 불러오지 못했습니다';
    root.append(node('p', `${head}: ${message}${code}`, 'state state-error'));
  } else if (status === 'ok' && Array.isArray(data) && data.length === 0) {
    root.append(node('p', '표시할 기록이 없습니다. 조회는 성공했고, 최근 기록 범위에 해당하는 내 기록이 0건입니다.', 'state state-empty'));
  } else if (status === 'ok' && Array.isArray(data)) {
    const events = sortEvents(data);
    const appIds = [...new Set(events.map((event) => event.appId).filter(Boolean))].sort();
    // 새 자료에 없는 앱을 고른 상태였다면 전체로 되돌린다.
    if (filters.app !== 'all' && !appIds.includes(filters.app)) filters.app = 'all';
    const count = node('p', null, 'muted');
    const listBox = document.createElement('div');
    const filterBar = node('div', null, 'row');
    filterBar.append(
      filterSelect('student-filter-kind', '기록 종류', Object.keys(EVENT_KINDS).map((k) => [k, kindText(k)]), filters.kind,
        (value) => { filters.kind = value; paint(); }),
      filterSelect('student-filter-app', '업무 앱', appIds.map((a) => [a, a]), filters.app,
        (value) => { filters.app = value; paint(); }),
      filterSelect('student-filter-access', '접속 상태', Object.entries(ACCESS_STATUS).map(([k, v]) => [k, `${v.text} (${k})`]), filters.access,
        (value) => { filters.access = value; paint(); }),
    );
    const detailBox = document.createElement('div');
    root.append(filterBar, count, listBox, detailBox);
    // 상세 선택은 이 호출 안에만 둔다. 다시 불러오면 새 호출이 되므로 이전 선택이 초기화된다.
    let selectedId = null;
    let shown = [];
    function paintDetail() {
      const event = shown.find((item) => item.id === selectedId);
      if (!event) selectedId = null;
      detailBox.replaceChildren(event
        ? renderEventDetail(event)
        : node('p', '기록의 「상세」 버튼을 누르면 근거·규칙·상태가 여기에 표시됩니다.', 'muted'));
    }
    // 받은 배열 안에서만 거른다. 서버에 다시 요청하지 않는다.
    function paint() {
      shown = events.filter((event) => (filters.kind === 'all' || event.kind === filters.kind)
        && (filters.app === 'all' || event.appId === filters.app)
        && (filters.access === 'all' || (event.state && event.state.access) === filters.access));
      count.textContent = `표시 ${shown.length}건 / 받은 기록 ${events.length}건`;
      listBox.replaceChildren(shown.length === 0
        ? node('p', '선택한 필터에 맞는 기록이 없습니다. 필터를 전체(all)로 바꾸면 받은 기록을 모두 볼 수 있습니다.', 'state state-empty')
        : renderRows(shown, (id) => { selectedId = id; paintDetail(); }));
      paintDetail();
    }
    paint();
  } else {
    root.append(node('p', `확인 불가: 알 수 없는 상태값 (${status == null ? '없음' : status})`, 'state state-empty'));
  }
  return root;
}

function renderRows(events, onDetail) {
  const list = node('ul', null, 'plain-list');
  for (const event of events) {
    const row = document.createElement('li');
    row.dataset.studentEventId = event.id;
    const info = node('dl', null, 'kv');
    field(info, '사건 ID', event.id);
    field(info, '시각', timeText(event.at));
    field(info, '종류', kindText(event.kind));
    field(info, '앱', appText(event.appId));
    field(info, '요약', event.summary);
    // 버튼 글자가 곧 접근 가능한 이름이다: "<event.id> 상세"
    const button = node('button', `${event.id} 상세`, 'btn');
    button.type = 'button';
    button.addEventListener('click', () => onDetail(event.id));
    row.append(info, button);
    list.append(row);
  }
  return list;
}

function textRows(title, rows, emptyText) {
  const section = document.createElement('div');
  section.append(node('h5', title));
  if (!Array.isArray(rows) || rows.length === 0) {
    section.append(node('p', emptyText, 'muted'));
    return section;
  }
  const list = node('ul', null, 'plain-list');
  for (const row of rows) list.append(node('li', `${row.id}: ${row.text}`));
  section.append(list);
  return section;
}

// 16단계: supportedActions에 값이 있을 때만 「<action> 미지원」 비활성 버튼과 준비 중 안내를 둔다.
// 클릭 처리기를 두지 않으므로 어떤 요청도 보내지 않는다. 빈 배열이면 아무것도 만들지 않는다.
function unsupportedActionsBlock(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const block = document.createElement('div');
  block.append(node('h5', '조치 (supportedActions)'),
    node('p', '아직 지원하지 않는 조치입니다. 조치 실행 연결은 준비 중이며, 이 화면은 조치 요청을 보내지 않고 실행하지도 않습니다.', 'state state-empty'));
  for (const action of actions) {
    const button = node('button', `${action} 미지원`, 'btn');
    button.type = 'button';
    button.disabled = true;
    block.append(button);
  }
  return block;
}

// 근거·규칙·세 상태를 구분해 보인다. 실행 가능한 조치 버튼은 만들지 않는다.
function renderEventDetail(event) {
  const detail = node('section', null, 'student-event-detail');
  detail.dataset.studentEventDetail = event.id;
  detail.setAttribute('aria-label', `${event.id} 상세`);
  const state = event.state || {};
  const info = node('dl', null, 'kv');
  field(info, '사건 ID', event.id);
  field(info, '업무 앱 ID', appText(event.appId));
  const states = node('dl', null, 'kv');
  field(states, '접속 상태', statusText(ACCESS_STATUS, state.access));
  field(states, '세션 상태', statusText(SESSION_STATUS, state.session));
  field(states, '기기 상태', statusText(DEVICE_STATUS, state.device));
  detail.append(
    node('h4', `${event.id} 상세`),
    info,
    textRows('근거 (evidence)', event.evidence, '근거 항목이 없습니다.'),
    textRows('규칙 (rules)', event.rules, '규칙 항목이 없습니다.'),
    node('h5', '상태 (state)'),
    states,
  );
  const unsupported = unsupportedActionsBlock(event.supportedActions);
  if (unsupported) detail.append(unsupported);
  return detail;
}

// ---------- 16단계: 알림·빈 상태·오류·진단 정보 ----------

const RETRY_GUIDE = '다시 시도는 위쪽 「다시 불러오기」 버튼을 직접 누르세요. 자동으로 다시 요청하지 않습니다.';
const DIAG_RETRY_GUIDE = '다시 시도는 제공 칸의 「도움정보 불러오기」 버튼을 직접 누르세요. 자동으로 다시 요청하지 않습니다.';

const isTimeout = (error) => typeof (error && error.code) === 'string' && error.code.includes('TIMEOUT');

// 실패 안내: 무엇을 불러오지 못했는지, 시간 초과인지, message·code, 사용자가 직접 누르는 다시 시도.
// 호출마다 새로 그리므로 다시 불러와 성공하면 이전 실패 안내가 남지 않는다.
function failureBlock(name, error, guide) {
  const block = document.createElement('div');
  const message = (error && error.message) || '서버 메시지 없음';
  const code = error && error.code ? ` (${error.code})` : '';
  const head = isTimeout(error)
    ? `시간 초과: ${name} 요청이 제한 시간 안에 끝나지 않았습니다. ${message}${code}`
    : `${name}를 불러오지 못했습니다: ${message}${code}`;
  block.append(node('p', head, 'state state-error'), node('p', guide, 'muted'));
  return block;
}

// 자료 하나의 불러오는 중 / 결과 / 빈 목록 / 실패를 서로 다른 문장으로 보인다.
function statusBlock(name, resource, { empty, renderItem }) {
  const status = resource && resource.status;
  if (status === 'loading') return node('p', `${name}를 불러오는 중`, 'state state-loading');
  if (status === 'error') return failureBlock(name, resource.error, RETRY_GUIDE);
  if (status === 'ok' && Array.isArray(resource.data)) {
    if (resource.data.length === 0) return node('p', empty, 'state state-empty');
    const list = node('ul', null, 'plain-list');
    for (const item of resource.data) list.append(renderItem(item));
    return list;
  }
  return node('p', `확인 불가: ${name}의 상태값을 알 수 없습니다 (${status == null ? '없음' : status})`, 'state state-empty');
}

function diagnosticsBlock(resource) {
  const status = resource && resource.status;
  if (status === 'idle') return node('p', '진단 정보를 아직 불러오지 않았습니다. 위쪽 제공 칸의 「도움정보 불러오기」를 직접 누르세요.', 'state state-empty');
  if (status === 'loading') return node('p', '진단 정보를 불러오는 중', 'state state-loading');
  if (status === 'error') return failureBlock('진단 정보', resource.error, DIAG_RETRY_GUIDE);
  if (status === 'ok') {
    const data = resource.data || {};
    const engine = data.engine || {};
    const list = node('dl', null, 'kv');
    field(list, 'requestId', data.requestId);
    field(list, 'component', data.component);
    field(list, 'version', data.version);
    field(list, 'checkedAt', data.checkedAt);
    field(list, 'engine.mode', engine.mode);
    field(list, 'engine.code', engine.code);
    return list;
  }
  return node('p', `확인 불가: 진단 정보의 상태값을 알 수 없습니다 (${status == null ? '없음' : status})`, 'state state-empty');
}

const RESOURCE_NAMES = {
  me: '로그인 정보', apps: '업무 앱', events: '보안 기록', devices: '기기', sessions: '세션',
  access: '접속 판정', diagnostics: '도움정보', vulnerabilities: '설치 패키지 조회',
};

// 상태값 알림(기기·세션 상태, 기록 종류)은 확인할 곳을, 그 밖의 code는 조회 실패로 보고 할 일을 안내한다.
function notificationGuide(resource, code) {
  const statusCode = [DEVICE_STATUS, SESSION_STATUS, EVENT_KINDS].some((labels) => Object.hasOwn(labels, code));
  if (statusCode && resource === 'devices') return '확인 필요: 이 기기의 보안 상태를 점검하세요.';
  if (statusCode && resource === 'sessions') return '확인 필요: 이 세션은 활성 상태가 아닙니다. 다시 로그인이 필요한지 확인하세요.';
  if (statusCode && resource === 'events') return '확인 필요: 「보안 기록」에서 이 기록의 상세를 확인하세요.';
  if (resource === 'diagnostics') return `조회 실패: 연결 상태를 확인한 뒤 ${DIAG_RETRY_GUIDE}`;
  return `조회 실패: 연결 상태를 확인한 뒤 ${RETRY_GUIDE}`;
}

function notificationsBlock(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return node('p', '주의할 알림이 없습니다.', 'state state-empty');
  }
  const list = node('ul', null, 'plain-list');
  for (const item of notifications) {
    const resource = item && item.resource;
    const name = Object.hasOwn(RESOURCE_NAMES, resource) ? RESOURCE_NAMES[resource] : '자료 확인 불가';
    const row = document.createElement('li');
    const text = document.createElement('div');
    text.append(
      node('span', `${name} (${resource == null ? '값 없음' : resource}) · ${item && item.code != null ? item.code : 'code 없음'}`, 'item-title'),
      node('p', (item && item.message) || '메시지 없음'),
      node('p', notificationGuide(resource, item && item.code), 'muted'),
    );
    row.append(text);
    list.append(row);
  }
  return list;
}

// 도움 요청용 안전한 값 6개만 고른다. ai 항목 같은 나머지 값은 넣지 않는다.
function safeDiagnostics(resource) {
  if (!resource || resource.status !== 'ok') return null;
  const data = resource.data || {};
  const engine = data.engine || {};
  return {
    requestId: data.requestId ?? null, component: data.component ?? null, version: data.version ?? null,
    checkedAt: data.checkedAt ?? null, engine: { mode: engine.mode ?? null, code: engine.code ?? null },
  };
}

// 「도움정보 복사」: 사용자가 누를 때만 위의 안전한 값을 클립보드에 복사한다. 어디에도 전송하지 않는다.
function copyHelpBlock(diagnostics) {
  const block = document.createElement('div');
  const safe = safeDiagnostics(diagnostics);
  const button = node('button', '도움정보 복사', 'btn');
  button.type = 'button';
  const result = node('p', null, 'muted');
  result.setAttribute('role', 'status');
  if (!safe) {
    button.disabled = true;
    result.textContent = '복사할 진단 정보가 없습니다. 먼저 제공 칸의 「도움정보 불러오기」로 진단 정보를 받으세요.';
  }
  button.addEventListener('click', async () => {
    if (!safe) return;
    const text = JSON.stringify(safe, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      result.textContent = '진단 정보 6개 값을 클립보드에 복사했습니다. 붙여 넣기 전에 내용을 직접 확인하세요.';
    } catch {
      result.textContent = '자동 복사를 사용할 수 없습니다. 위에 표시된 6개 값을 직접 선택해 복사하세요.';
    }
  });
  block.append(
    node('p', '이 버튼은 도움 요청에 쓸 진단 정보(requestId·component·version·checkedAt·engine.mode·engine.code)만 복사합니다. 누를 때만 복사하며, 비밀번호·토큰·API 키는 포함하지 않습니다.'),
    button,
    result,
  );
  return block;
}

function renderStatusView({ devices, sessions, notifications, diagnostics } = {}) {
  const root = node('div', null, 'student-status');
  const deviceBlock = statusBlock('기기 정보', devices, {
    empty: '등록된 기기가 없습니다. 조회는 성공했고 내 이름으로 등록된 기기가 0개입니다.',
    renderItem: (device) => {
      const item = document.createElement('li');
      item.append(node('span', `${device.label || '이름 정보 없음'} (${device.id})`, 'item-title'), statusText(DEVICE_STATUS, device.status));
      return item;
    },
  });
  const sessionBlock = statusBlock('세션 정보', sessions, {
    empty: '현재 연결된 세션이 없습니다. 조회는 성공했고 현재 검증된 연결이 0개입니다.',
    renderItem: (session) => {
      const item = document.createElement('li');
      item.append(node('span', session.id, 'item-title'), statusText(SESSION_STATUS, session.status));
      return item;
    },
  });
  root.append(
    identitySection('알림', notificationsBlock(notifications)),
    identitySection('등록 기기', deviceBlock),
    identitySection('현재 세션', node('p', '세션은 현재 검증된 연결 1개만 표시합니다. 지난 세션 전체 목록이 아닙니다.', 'muted'), sessionBlock),
    identitySection('진단 정보', diagnosticsBlock(diagnostics), copyHelpBlock(diagnostics)),
  );
  return root;
}

// ---------- 17단계: 앱 내부 AI 연결 상태 ----------

// 「AI 연결 점검」(항상 보임)과 「현재 API 연결 점검」(연결 완료 뒤 보임)은 같은 점검을 실행한다.
const AI_RECHECK_GUIDE = '다시 점검은 「AI 연결 점검」 또는 연결 완료 뒤 보이는 「현재 API 연결 점검」 버튼을 직접 누르세요. 자동으로 다시 점검하지 않습니다.';

// test는 시험 연결, verified는 그 시각 기준 앱 권한 확인과 모델 응답이다.
const AUDIENCE_LABELS = {
  test: '시험 연결 점검(test): 앱 권한 확인 전의 시험 연결입니다.',
  verified: '앱 권한 확인 후 점검(verified): 점검 시각 기준으로 앱 권한과 모델 응답을 확인했습니다.',
};

// 제공 UI가 넘기는 안전한 code를 원인별로 나눈다. 원문 오류·열쇠는 받지도 쓰지도 않는다.
const AI_ERROR_GROUPS = [
  { title: '권한 준비 중·확인 불가', guide: '학생 잘못이 아닐 수 있습니다. 담당자에게 계정 연결과 앱 권한 확인을 요청하세요.',
    codes: ['ON_AI_PROVISIONING_PENDING', 'ON_AI_AUTHORIZATION_CHANGED', 'SUBJECT_SCOPE_UNVERIFIED', 'AI_REQUEST_UNVERIFIED', 'ON_AI_INVALID_INPUT', 'ON_AI_INVALID_OUTPUT'] },
  { title: '인증 실패', guide: '계정 연결을 다시 확인하고, 계속되면 담당자에게 확인하세요. 열쇠를 복사해 붙이지 마세요.', codes: ['WB_CLCO_AUTH_REQUIRED'] },
  { title: '접근 제한', guide: '계정 연결을 다시 확인하고, 담당자에게 앱 이용 권한을 확인하세요.', codes: ['WB_CLCO_ACCESS_BLOCKED'] },
  { title: '반 사용량·이용 한도', guide: '담당자에게 사용량과 이용 한도를 확인하세요.', codes: ['WB_CLCO_COHORT_BUDGET_EXHAUSTED', 'WB_CLCO_LIMIT_REACHED'] },
  { title: '이용 시간 아님', guide: 'AI 이용 시간을 확인하세요.', codes: ['WB_CLCO_SESSION_CLOSED'] },
  { title: '요청 제한·시간 초과·네트워크', guide: '잠시 뒤 직접 다시 점검하세요.',
    codes: ['WB_CLCO_RATE_LIMITED', 'WB_CLCO_TIMEOUT', 'REQUEST_TIMEOUT', 'ENGINE_TIMEOUT', 'TIMEOUT', 'NETWORK_ERROR'] },
  { title: '취소됨', guide: '점검을 취소했습니다. 이전 결과는 현재 결과가 아닙니다.', codes: ['WB_CLCO_CANCELLED', 'CANCELLED', 'REQUEST_CANCELLED'] },
  { title: '쓸 수 있는 모델 없음', guide: '담당자에게 모델 허용 설정 확인을 요청하세요.', codes: ['ON_AI_MODEL_LIST_EMPTY', 'MODEL_NOT_CONFIGURED'] },
];
const AI_ERROR_UNKNOWN = { title: '확인 불가', guide: '원인을 확인할 수 없습니다. 담당자에게 계정 연결과 앱 권한 확인을 요청하세요.' };
const AI_SAFE_ERROR_CODES = new Set([...AI_ERROR_GROUPS.flatMap((group) => group.codes), 'AI_REQUEST_UNVERIFIED']);
// 개인키 머리글 모양은 저장소 파일에 글자 그대로 두지 않고 실행 중에 조립한다.
const AI_SECRET_TEXT = new RegExp([
  'Bearer\\s+\\S+',
  'sk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{8,}',
  `${'-'.repeat(5)}BEGIN [A-Z ]*PRIVATE KEY${'-'.repeat(5)}`,
  '(?:api[_ -]?key|authorization|password|비밀번호|토큰)\\s*[:=]\\s*\\S+',
  'https?:\\/\\/\\S+',
].join('|'), 'i');
const AI_MODE_NOTICES = {
  connected: '앱 서버 연결 모드: connected',
  demo: '예제 응답(demo)입니다. 실제 수업용 AI 연결 결과가 아닙니다.',
  disconnected: '앱 서버 연결 모드가 disconnected입니다. 실제 연결 결과로 간주하지 않습니다.',
  unknown: '앱 서버 연결 상태를 확인할 수 없습니다 (unknown).',
};

function aiErrorGroup(code) {
  return AI_ERROR_GROUPS.find((group) => group.codes.includes(code)) || AI_ERROR_UNKNOWN;
}

// 코드와 메시지는 고정된 안전 조건을 통과한 값만 표시한다. 원문 오류·열쇠·URL은 화면에 쓰지 않는다.
function safeAiError(error) {
  const code = error && AI_SAFE_ERROR_CODES.has(error.code) ? error.code : 'AI_REQUEST_UNVERIFIED';
  const rawMessage = error && error.message;
  const message = typeof rawMessage === 'string' && rawMessage.trim().length > 0 && rawMessage.length <= 500
    && !AI_SECRET_TEXT.test(rawMessage) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(rawMessage)
    ? rawMessage.trim()
    : '안전한 오류 메시지를 표시할 수 없습니다.';
  return { code, message, group: aiErrorGroup(code) };
}

// 호출마다 새로 그린다. 다시 점검해 성공하거나 idle로 돌아오면 이전 결과·오류 안내가 남지 않는다.
function renderAiConnectionView({ status, mode, data, error, checkedAt, explanationAccepted = false } = {}) {
  // explanationAccepted는 모델 점검이 사건 설명 실행을 뜻하지 않도록 별도 상태로 취급하지 않는다.
  void explanationAccepted;
  const root = node('div', null, 'student-ai-connection');
  if (status === 'idle') {
    root.append(node('p', 'AI 연결 점검 전: 아직 AI 연결 점검을 실행하지 않았습니다.', 'state state-empty'));
  } else if (status === 'loading') {
    root.append(node('p', 'AI 연결 점검 중: 모델 응답을 확인하고 있습니다. 끝나기 전에는 결과가 아닙니다.', 'state state-loading'));
  } else if (status === 'ok') {
    const result = data || {};
    const kind = Object.hasOwn(AUDIENCE_LABELS, result.audienceAuthorization)
      ? AUDIENCE_LABELS[result.audienceAuthorization]
      : '확인 불가: audienceAuthorization 값이 계약과 다릅니다.';
    const list = node('dl', null, 'kv');
    field(list, '점검 종류', kind);
    field(list, '모델 수', Number.isInteger(result.modelCount) ? `${result.modelCount}개 (modelCount)` : '확인 불가');
    field(list, '점검 시각', checkedAt);
    root.append(node('p', mode === 'demo'
      ? '예제 응답(demo)을 받았습니다. 실제 수업용 AI API 연결 결과로 간주하지 않습니다.'
      : 'AI 연결 점검 결과: 앱 서버를 통해 모델 목록 응답을 받았습니다.'));
    // append(null)은 "null" 글자를 넣으므로 모드 안내가 있을 때만 붙인다.
    if (typeof mode === 'string' && Object.hasOwn(AI_MODE_NOTICES, mode)) root.append(node('p', AI_MODE_NOTICES[mode], 'muted'));
    root.append(
      list,
      node('p', '연결만 점검했습니다. 사건 설명은 아직 실행하지 않았습니다. 사건 설명은 「보안 기록」에서 따로 요청하고 확인합니다.', 'state state-empty'),
    );
  } else if (status === 'error') {
    // 오류 화면에는 모델 수나 이전 점검 결과를 쓰지 않는다.
    const safe = safeAiError(error);
    root.append(
      node('p', `AI 연결 점검 실패 · ${safe.group.title}: ${safe.message} (${safe.code})`, 'state state-error'),
      node('p', safe.group.guide),
    );
  } else {
    root.append(node('p', 'AI 연결 점검 상태를 확인할 수 없습니다.', 'state state-empty'));
  }
  if (status !== 'loading') root.append(node('p', AI_RECHECK_GUIDE, 'muted'));
  return root;
}

// ---------- 18단계: 근거에 연결된 AI 보안 이벤트 설명 ----------

const STATE_NAMES = { access: '접속', session: '세션', device: '기기' };

// 설명 실패 코드별 이유. 그 밖의 코드는 17단계 오류 묶음의 안내를 쓴다.
const EXPLANATION_FAILURE_REASONS = {
  ON_AI_INVALID_OUTPUT: '응답 형식이나 근거 ID가 이 기록과 맞지 않습니다. 근거가 맞지 않아 설명을 쓸 수 없습니다.',
  ON_AI_INVALID_INPUT: '이 기록은 AI 설명 요청에 쓸 수 있는 형식이 아닙니다. 근거가 부족해 설명을 요청하지 못했습니다.',
  WB_CLCO_CANCELLED: '설명 요청을 취소했습니다. 이전 설명은 현재 결과가 아닙니다.',
  CANCELLED: '설명 요청을 취소했습니다. 이전 설명은 현재 결과가 아닙니다.',
  REQUEST_CANCELLED: '설명 요청을 취소했습니다. 이전 설명은 현재 결과가 아닙니다.',
  WB_CLCO_RATE_LIMITED: '요청이 제한되었습니다. 잠시 뒤 설명을 직접 다시 요청하세요.',
  WB_CLCO_TIMEOUT: '응답 시간이 초과되었습니다. 잠시 뒤 설명을 직접 다시 요청하세요.',
  REQUEST_TIMEOUT: '응답 시간이 초과되었습니다. 잠시 뒤 설명을 직접 다시 요청하세요.',
  ENGINE_TIMEOUT: '응답 시간이 초과되었습니다. 잠시 뒤 설명을 직접 다시 요청하세요.',
  TIMEOUT: '응답 시간이 초과되었습니다. 잠시 뒤 설명을 직접 다시 요청하세요.',
  NETWORK_ERROR: '네트워크 문제로 응답을 받지 못했습니다. 잠시 뒤 설명을 직접 다시 요청하세요.',
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// 설명을 이 기록에 붙여도 되는지 검사한다. 없는 근거 ID를 만들어 맞추지 않고, 맞지 않으면 이유만 돌려준다.
function explanationProblems(event, data) {
  if (!isPlainObject(data)) return ['설명 본문(data)이 없습니다.'];
  const problems = [];
  const known = new Set(Array.isArray(event.evidence) ? event.evidence.map((item) => item && item.id) : []);
  const refsFit = (ids) => Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length && ids.every((id) => known.has(id));
  if (typeof data.summary !== 'string' || data.summary.trim() === '') problems.push('AI 요약이 없습니다.');
  if (!Array.isArray(data.evidenceIds) || data.evidenceIds.length === 0) {
    problems.push('인용한 근거 ID가 없어 근거가 부족합니다.');
  } else if (!refsFit(data.evidenceIds)) {
    problems.push('인용한 근거 ID가 이 기록의 근거와 맞지 않습니다(없는 ID 또는 중복).');
  }
  if (!Array.isArray(data.proposals)) {
    problems.push('제안 목록(proposals) 형식이 맞지 않습니다.');
  } else if (!data.proposals.every((item) => isPlainObject(item) && typeof item.action === 'string' && item.action !== ''
    && typeof item.reason === 'string' && item.reason !== '' && refsFit(item.evidenceIds))) {
    problems.push('제안의 형식이나 근거 ID가 이 기록과 맞지 않습니다.');
  }
  if (data.requiresHumanConfirmation !== true) problems.push('사람 확인이 필요하다는 표시(requiresHumanConfirmation)가 true가 아닙니다.');
  if (data.executed === true) problems.push('AI가 이미 실행했다고 답한 설명은 쓸 수 없습니다.');
  else if (data.executed !== false) problems.push('실행 여부(executed)가 false가 아닙니다.');
  return problems;
}

function textList(title, rows, emptyText) {
  const section = document.createElement('div');
  section.append(node('h5', title));
  if (rows.length === 0) section.append(node('p', emptyText, 'muted'));
  else {
    const list = node('ul', null, 'plain-list');
    for (const row of rows) list.append(node('li', row));
    section.append(list);
  }
  return section;
}

// 호출마다 새로 그린다. 다른 기록을 고르거나 다시 불러오면 이전 설명과 성공 속성이 남지 않는다.
// data-student-explanation-event는 근거 검사까지 통과한 성공 화면에만 붙인다.
function renderExplanationView({ event, explanation, checkedAt } = {}) {
  void checkedAt;
  const root = node('div', null, 'student-explanation');
  const status = explanation && explanation.status;
  const hasEvent = isPlainObject(event) && typeof event.id === 'string' && event.id !== '';
  const kept = (hasEvent ? `사건 ${event.id}의 ` : '');
  if (status === 'error') {
    // 기록 없이 실패만 온 경우에도 실패 이유를 먼저 보인다.
    const safe = safeAiError(explanation.error || {});
    root.append(
      node('p', `AI 설명 실패 · ${safe.code}: ${safe.message}`, 'state state-error'),
      node('p', `실패 이유: ${EXPLANATION_FAILURE_REASONS[safe.code] || safe.group.guide}`),
      node('p', `${kept}기록은 그대로입니다. 업무 앱 판정과 보안 기록은 계속 쓸 수 있고, 설명 실패는 과제 실패가 아닙니다.`, 'muted'),
    );
    if (!hasEvent) root.append(node('p', '보안 기록에서 기록을 먼저 고르세요.', 'muted'));
  } else if (!hasEvent) {
    root.append(node('p', '보안 기록에서 기록을 먼저 고르세요.', 'state state-empty'));
  } else if (status === 'loading') {
    root.append(node('p', `AI 설명 요청 중 (${event.id}): 끝나기 전에는 결과가 아닙니다.`, 'state state-loading'));
  } else if (status === 'ok') {
    const problems = explanationProblems(event, explanation.data);
    if (problems.length > 0) {
      // 근거가 맞지 않는 설명은 내용을 보이지 않고 이유만 보인다. 성공 속성도 붙이지 않는다.
      root.append(
        node('p', `AI 설명을 쓸 수 없습니다 (${event.id}): 근거가 맞지 않거나 형식이 맞지 않습니다.`, 'state state-error'),
        textList('쓸 수 없는 이유', problems, '없음'),
        node('p', `${kept}기록은 그대로입니다. 설명 내용은 표시하지 않았습니다.`, 'muted'),
      );
      return root;
    }
    const data = explanation.data;
    const evidenceText = new Map(event.evidence.map((item) => [item.id, item.text]));
    const rules = Array.isArray(event.rules) ? event.rules : [];
    const state = isPlainObject(event.state) ? event.state : {};
    const unknownStates = Object.keys(STATE_NAMES).filter((key) => state[key] === 'unknown');
    const supported = Array.isArray(event.supportedActions) ? event.supportedActions : [];
    root.dataset.studentExplanationEvent = event.id;
    const head = node('dl', null, 'kv');
    field(head, '사건 ID', event.id);
    field(head, 'AI 요약', data.summary);
    root.append(node('h4', 'AI 설명(참고용)'));
    if (explanation.mode === 'demo') root.append(node('p', '예제 응답(demo): 실제 수업용 AI의 설명이 아닙니다.', 'tag tag-demo'));
    root.append(
      head,
      node('p', 'AI 설명은 해석입니다. 사실 판단은 아래 근거 글과 연동 시스템이 알려 준 상태로 합니다.', 'muted'),
      textList('인용한 근거', data.evidenceIds.map((id) => `${id} — ${evidenceText.get(id)}`), '없음'),
      textList('규칙', rules.map((rule) => `${rule.id} — ${rule.text}`), '규칙 항목이 없습니다.'),
      textList('확인 불가 상태', unknownStates.map((key) => `${STATE_NAMES[key]}: 확인 불가(unknown)`), '없음'),
    );
    if (data.proposals.length === 0) {
      root.append(textList('조치 제안', [], supported.length === 0
        ? '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상).'
        : 'AI가 이 기록에 제안한 조치가 없습니다.'));
    } else {
      root.append(
        textList('조치 제안', data.proposals.map((item) => `${item.action} — ${item.reason} (근거 ${item.evidenceIds.join(', ')})`), '없음'),
        node('p', '사람 확인이 필요하며 실행되지 않았습니다.', 'state state-empty'),
      );
    }
    root.append(node('p', 'AI 설명과 제안만으로 보안 조치가 실행되지는 않습니다.', 'muted'));
  } else {
    root.append(node('p', `AI 설명 전 (${event.id}): 아직 이 기록의 설명을 요청하지 않았습니다.`, 'state state-empty'));
  }
  return root;
}

// ---------- 19단계: 보안 조치 요청 상태와 실제 결과 구분 ----------

// 상태마다 뜻이 다른 문장을 원래 값과 함께 쓴다. 전달 중·접수는 끝났거나 성공했다는 인상을 주지 않는다.
const ACTION_STATUS_TEXT = {
  idle: '아직 미실행(idle): 조치 제안은 실행되지 않았습니다.',
  loading: '조치 준비 또는 결과 조회 중(loading): 아직 결과가 없습니다.',
  prepared: '준비됨·미실행(prepared): 사람 확인 전이며 서버에 전달되지 않았습니다.',
  executing: '서버에 전달 중(executing): 결과가 아직 없습니다.',
  pending: '서버 접수·처리 중(pending): 서버가 요청을 받았다는 접수 응답(ACK)이며 조치 효과가 아닙니다. 효과는 아직 확인되지 않았습니다.',
  succeeded: '효과 확인(succeeded): 연동 시스템이 조치 효과를 관측했습니다.',
  denied: '거절(denied): 연동 시스템이 조치를 거절했습니다.',
  failed: '실패(failed): 연동 시스템에서 조치가 실패했습니다.',
  unknown: '결과 불명(unknown): 성공으로도 효과 없음으로도 판단할 수 없습니다.',
  expired: '확인 기한 지남(expired): 이번 준비로는 집행할 수 없습니다. 조치를 다시 준비하세요.',
  error: '요청 처리 안 됨(error): 요청이 처리되지 않았습니다.',
};
const ACTION_STATUS_CLASS = { idle: 'state state-empty', loading: 'state state-loading', executing: 'state state-loading', error: 'state state-error', denied: 'state state-error', failed: 'state state-error' };
// 이 상태에서만 현재 사건·요청에 묶인 속성을 붙인다.
const ACTION_BOUND_STATUSES = ['prepared', 'executing', 'pending', 'succeeded', 'denied', 'failed', 'unknown'];
const ACTION_REQUERY_GUIDE = '제공 화면의 「원천 결과만 재조회」 버튼으로 결과만 다시 조회하세요. 같은 조치를 다시 집행하지 마세요.';

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

// 코드와 메시지는 고정된 안전 조건을 통과한 값만 보인다.
function safeActionError(error, fallbackMessage) {
  const source = isPlainObject(error) ? error : {};
  const code = typeof source.code === 'string' && /^[A-Z][A-Z0-9_]{2,60}$/.test(source.code) ? source.code : null;
  const message = hasText(source.message) && source.message.length <= 500 && !AI_SECRET_TEXT.test(source.message)
    ? source.message.trim()
    : fallbackMessage;
  return { code, message };
}

// 호출마다 새로 그린다. 새 입력이 오면 이전 대상·요청·결과가 남지 않는다.
// 버튼·요청·확인 번호는 만들지 않고, 조치는 제공 화면의 버튼으로만 진행한다.
function renderActionView(input) {
  const { status, event, actionId, target, receipt, observation, message, confirmationExpiresAt, error } = isPlainObject(input) ? input : {};
  const root = node('div', null, 'student-action');
  const known = Object.hasOwn(ACTION_STATUS_TEXT, status);
  // succeeded는 효과 관측(effectApplied === true)이 있을 때만 효과 확인이다. 없으면 결과 불명으로 처리한다.
  const effectConfirmed = status === 'succeeded' && isPlainObject(observation) && observation.effectApplied === true;
  const shown = status === 'succeeded' && !effectConfirmed ? 'unknown' : known ? status : null;
  const uncertain = shown === null || shown === 'unknown';

  if (shown === null) {
    root.append(node('p', `확인 불가: 알 수 없는 조치 상태값입니다 (${status == null ? '값 없음' : status}). 성공이나 효과 없음으로 판단하지 마세요.`, 'state state-error'));
  } else {
    root.append(node('p', ACTION_STATUS_TEXT[shown], ACTION_STATUS_CLASS[shown] || 'state'));
  }
  if (status === 'succeeded' && !effectConfirmed) {
    root.append(node('p', '서버 상태는 succeeded였지만 효과 관측값(observation.effectApplied)이 true가 아니거나 없어 효과 확인으로 보지 않습니다.', 'muted'));
  }
  if (uncertain) root.append(node('p', ACTION_REQUERY_GUIDE));

  const eventId = isPlainObject(event) && hasText(event.id) ? event.id : null;
  const requestId = isPlainObject(receipt) && hasText(receipt.requestId) ? receipt.requestId : null;
  const evidenceIds = isPlainObject(event) && Array.isArray(event.evidence)
    ? event.evidence.map((item) => item && item.id).filter(hasText) : [];
  const rows = node('dl', null, 'kv');
  const add = (name, value) => { if (value !== null && value !== undefined && value !== '') field(rows, name, value); };
  add('사건 ID', eventId);
  if (eventId) add('근거 ID', evidenceIds.length > 0 ? evidenceIds.join(', ') : '없음');
  add('조치(actionId)', hasText(actionId) ? actionId : null);
  if (isPlainObject(target)) {
    add('실제 대상(target.id)', hasText(target.id) ? target.id : null);
    add('대상 세대(generation)', Number.isSafeInteger(target.generation) ? target.generation : null);
  }
  if (isPlainObject(receipt)) {
    add('요청 ID(requestId)', requestId);
    add('영수증 ID(receiptId)', hasText(receipt.receiptId) ? receipt.receiptId : null);
    add('버전(version)', Number.isSafeInteger(receipt.version) ? receipt.version : null);
  }
  if (['prepared', 'expired'].includes(shown) && hasText(confirmationExpiresAt)) add('사람 확인 기한', confirmationExpiresAt);
  if (effectConfirmed && hasText(observation.observedAt)) add('관측 시각(observedAt)', observation.observedAt);
  if (effectConfirmed) add('실제 효과(effectApplied)', 'effectApplied: true');
  if (rows.children.length > 0) root.append(rows);
  if (isPlainObject(receipt) && receipt.superseded === true) {
    root.append(node('p', '이전 조회는 최신 결과를 대신하지 않습니다(superseded).', 'muted'));
  }

  if (['denied', 'failed', 'error'].includes(shown) || (shown === 'unknown' && isPlainObject(error))) {
    const safe = safeActionError(error, hasText(message) && !AI_SECRET_TEXT.test(message) ? message.trim() : '안전한 메시지를 표시할 수 없습니다.');
    root.append(node('p', `${safe.code ? `${safe.code}: ` : ''}${safe.message}`, 'state state-error'));
  } else if (shown === 'idle' && hasText(message) && !AI_SECRET_TEXT.test(message)) {
    root.append(node('p', message.trim(), 'muted'));
  }
  if (shown === 'idle') {
    root.append(node('p', '현재 기록에 연동 시스템이 지원하는 조치(supportedActions)가 없으면 「조치 준비」 버튼이 나오지 않는 것이 정상입니다.', 'muted'));
  }
  root.append(node('p', '이 칸에는 조치 버튼이 없습니다. 조치는 제공 화면의 버튼으로만 진행하며, 「조치 화면 취소」는 이미 서버에 전달된 조치 효과를 되돌리지 않습니다.', 'muted'));

  // 현재 사건과 요청에 묶인 표시에만 속성을 붙인다.
  if (eventId && requestId && ACTION_BOUND_STATUSES.includes(shown)) {
    root.dataset.studentActionEvent = eventId;
    root.dataset.studentActionRequest = requestId;
  }
  return root;
}

// ---------- 20단계: 설치 패키지 버전과 알려진 취약점 조회 결과 ----------

// 전체 조회 상태(data.status)의 원래 값과 뜻. 목록에 없는 값은 확인 불가로 둔다.
const SCAN_STATUS_TEXT = {
  complete: { label: '모두 조회(complete)', note: '승인된 공개 패키지를 모두 조회했습니다. 조회 범위에서 확인한 결과이며 앱 전체의 안전을 보장하지 않습니다.' },
  partial: { label: '일부 조회 실패(partial)', note: '일부 패키지의 조회에 실패했습니다. 실패한 패키지는 취약점이 없는 것이 아니며, 이미 받은 취약점 ID는 그대로 보입니다.' },
  not_checked: { label: '아직 조회 안 함(not_checked)', note: '승인된 공개 패키지가 없어 조회하지 않았습니다. 취약점이 없다는 뜻이 아닙니다.' },
  not_configured: { label: '조회 준비 미완료(not_configured)', note: '조회 대상 프로젝트 설정이 준비되지 않았습니다. 설정은 운영자가 준비하며 취약점이 없다는 뜻이 아닙니다.' },
  unverifiable: { label: 'lock 파일 확인 불가(unverifiable)', note: 'package-lock.json을 확인할 수 없어 조회하지 못했습니다. 취약점이 없다는 뜻이 아닙니다.' },
};
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

// 패키지 한 개의 조회 결과 문장. 일부만 확인된 unverifiable은 받은 ID를 지우지 않는다.
function packageStatusText(item) {
  const found = Array.isArray(item.vulnerabilities) ? item.vulnerabilities.length : 0;
  if (item.status === 'known_vulnerabilities') return '알려진 항목 있음(known_vulnerabilities)';
  if (item.status === 'none_found') return '알려진 항목 없음(none_found): 조회 범위에서 알려진 항목이 없다는 뜻이며 안전을 보장하지 않습니다.';
  if (item.status === 'unverifiable') {
    return found > 0 ? '일부 확인·전체 조회 확인 불가(unverifiable)' : '조회 확인 불가(unverifiable): 취약점이 없다는 뜻이 아닙니다.';
  }
  return `확인 불가: 알 수 없는 조회 결과 값입니다 (${item.status == null ? '값 없음' : item.status})`;
}

function renderPackageRow(item) {
  const row = node('li', null, 'student-package');
  const version = typeof item.version === 'string' ? item.version : null;
  // 설치된 정확한 버전만 속성과 표시에 쓴다. ^1.2.0 같은 범위나 값 없음은 설치 버전으로 표시하지 않는다.
  const exact = version !== null && EXACT_VERSION.test(version);
  if (hasText(item.name)) row.dataset.studentPackageName = item.name;
  if (exact) row.dataset.studentPackageVersion = version;
  const info = node('dl', null, 'kv');
  field(info, '패키지', hasText(item.name) ? item.name : '이름 확인 불가');
  field(info, '설치 버전', exact ? version : `확인 불가: 정확한 설치 버전이 아닙니다 (${version == null ? '값 없음' : version})`);
  field(info, '조회 결과', packageStatusText(item));
  field(info, '출처(source)', item.source);
  field(info, '확인 시각(checkedAt)', item.checkedAt);
  row.append(info);
  const findings = Array.isArray(item.vulnerabilities) ? item.vulnerabilities : [];
  if (findings.length > 0) {
    const list = node('ul', null, 'plain-list');
    for (const finding of findings) {
      const source = isPlainObject(finding) ? finding : {};
      list.append(node('li', `${hasText(source.id) ? source.id : 'ID 확인 불가'} — 수정 시각(modified) ${hasText(source.modified) ? source.modified : '정보 없음'}`));
    }
    row.append(node('h5', '취약점 ID'), list);
  }
  return row;
}

// 호출마다 새로 그린다. 조회 중이거나 오류일 때 이전 표를 현재 결과처럼 남기지 않는다.
function renderVulnerabilitiesView({ status, mode, data, error } = {}) {
  const root = node('div', null, 'student-vulnerabilities');
  if (typeof mode === 'string' && Object.hasOwn(MODE_NOTICE, mode)) {
    root.append(node('p', MODE_NOTICE[mode].text, MODE_NOTICE[mode].className));
  }
  if (status === 'idle') {
    root.append(node('p', '조회 전: 아직 설치 패키지를 조회하지 않았습니다. 조회는 제공 화면의 「설치 패키지 조회」 버튼을 직접 눌러 시작합니다.', 'state state-empty'));
  } else if (status === 'loading') {
    root.append(node('p', '조회 중: 결과가 나오기 전에는 이전 표를 현재 결과로 보지 않습니다.', 'state state-loading'));
  } else if (status === 'error') {
    const safe = safeActionError(error, '안전한 오류 메시지를 표시할 수 없습니다.');
    root.append(
      node('p', `조회 실패: ${safe.message}${safe.code ? ` (${safe.code})` : ''}`, 'state state-error'),
      node('p', '조회 실패와 미조회는 취약점 없음이 아닙니다. 이전 결과는 현재 확인 결과가 아니며, 다시 조회하려면 「설치 패키지 조회」 버튼을 직접 누르세요.', 'muted'),
    );
  } else if (status === 'ok' && isPlainObject(data) && Object.hasOwn(SCAN_STATUS_TEXT, data.status)) {
    const info = SCAN_STATUS_TEXT[data.status];
    const summary = node('dl', null, 'kv');
    field(summary, '전체 조회 상태', info.label);
    if (data.lockfileVersion != null) field(summary, '잠금 파일 버전(lockfileVersion)', data.lockfileVersion);
    if (hasText(data.lockfileHash)) field(summary, '잠금 파일 해시(lockfileHash)', data.lockfileHash);
    if (hasText(data.checkedAt)) field(summary, '확인 시각(checkedAt)', data.checkedAt);
    if (isPlainObject(data.excluded) && Number.isSafeInteger(data.excluded.count) && data.excluded.count >= 0) {
      field(summary, '승인되지 않아 조회하지 않은 패키지(excluded.count)', `${data.excluded.count}개`);
    }
    root.append(
      node('p', `조회 결과: ${info.label}`, ['complete', 'partial'].includes(data.status) ? 'state' : 'state state-empty'),
      node('p', info.note),
      summary,
      node('p', '이 결과는 package-lock.json과 설치된 node_modules의 메타데이터를 대조한 값입니다. OSV는 알려진 취약점 데이터베이스이므로, 항목이 없다는 사실만으로 패키지나 앱 전체가 안전하다고 보장할 수 없습니다.', 'muted'),
    );
    const packages = Array.isArray(data.packages) ? data.packages : [];
    if (packages.length > 0) {
      const list = node('ul', null, 'plain-list');
      for (const item of packages) list.append(renderPackageRow(isPlainObject(item) ? item : {}));
      root.append(node('h5', '패키지별 조회 결과'), list);
    } else if (data.status === 'complete') {
      root.append(node('p', '표시할 패키지 조회 결과가 없습니다.', 'muted'));
    }
  } else if (status === 'ok') {
    root.append(node('p', `확인 불가: 조회 결과 형식을 알 수 없습니다${isPlainObject(data) && data.status != null ? ` (${data.status})` : ''}. 취약점이 없다는 뜻이 아닙니다.`, 'state state-error'));
  } else {
    root.append(node('p', `확인 불가: 알 수 없는 조회 상태값입니다 (${status == null ? '값 없음' : status}).`, 'state state-empty'));
  }
  return root;
}

export function createStudentView() {
  // 15단계 필터 선택값. 같은 화면 안에서만 유지하고 서버에 다시 묻지 않는다.
  const eventFilters = { kind: 'all', app: 'all', access: 'all' };
  return {
    renderIdentity(input) { return renderIdentityView(input); },
    renderDecision(input) { return renderDecisionView(input); },
    renderEvents(input) { return renderEventsView(input, eventFilters); },
    renderStatus(input) { return renderStatusView(input); },
    renderVulnerabilities(input) { return renderVulnerabilitiesView(isPlainObject(input) ? input : {}); },
    renderAiConnection(input) { return renderAiConnectionView(input); },
    renderExplanation(input) { return renderExplanationView(input); },
    renderAction(input) { return renderActionView(input); },
  };
}
