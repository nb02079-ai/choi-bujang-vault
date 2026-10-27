// SDP(기존 접속·XDR 서버) 연결 상태를 PC에서 잰 값과 따로 보이기 위한 문구입니다.
// PC 조회가 성공했다는 것과 SDP에 연결됐다는 것은 서로 다른 사실이므로 이 모듈의 결과를 PC 값과 섞지 않습니다.
// 제공 엔진(src/engine.mjs)의 evidenceMode를 읽기만 하며, 이 화면이 SDP 연결 성공을 확인했다고 말하지 않습니다.

const STATES = Object.freeze({
  disconnected: { status: 'not_connected', label: 'SDP 미연결', note: '이 앱은 SDP 서버에 연결되어 있지 않습니다. 연결 어댑터가 설정되지 않았습니다.' },
  demo: { status: 'example', label: '예제 자료 (SDP 아님)', note: '예제 실행입니다. 화면에 보이는 SDP 쪽 값은 설명용이며 실제 조회 결과가 아닙니다.' },
  connected: { status: 'adapter_configured', label: 'SDP 어댑터 설정됨', note: '연결 어댑터가 설정되어 있습니다. 이 화면이 SDP 연결 성공을 확인한 것은 아닙니다.' },
});
const SEPARATE = 'PC에서 잰 값의 성공·실패와 별개입니다.';

/** evidenceMode 문자열에서 SDP 상태를 만듭니다. 알 수 없는 값은 연결된 것으로 보지 않고 확인 불가로 둡니다. */
export function describeSdpState(mode) {
  const known = typeof mode === 'string' && Object.hasOwn(STATES, mode) ? STATES[mode] : null;
  const state = known ?? { status: 'unknown', label: 'SDP 상태 확인 불가', note: '연결 모드를 알 수 없습니다.' };
  return { ...state, mode: known ? mode : null, separateFromPc: true, note: `${state.note} ${SEPARATE}` };
}

/** 제공 엔진 객체에서 모드를 읽습니다. 엔진을 호출하거나 바꾸지 않습니다. */
export const readSdpState = (engine) => describeSdpState(engine?.evidenceMode);
