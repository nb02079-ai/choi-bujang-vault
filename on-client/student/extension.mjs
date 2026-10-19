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

export function createStudentView() {
  return {
    renderIdentity(input) { return renderIdentityView(input); },
    renderDecision() { return '학생 구현 대기: 서버의 판정과 이유를 연결하세요.'; },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
