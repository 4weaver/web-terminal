// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. Full license text: LICENSE at
// the repo root.
//
// connection.js session persistence: a page reload must resume the same
// server-side session (via the id stashed in sessionStorage), not ask for a
// new one — otherwise every reload leaks another session, and with a
// multiplexer command, another client on the shared render loop.

class FakeWebSocket {
  static OPEN = 1;
  static last = null;
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    FakeWebSocket.last = this;
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }
  hello() {
    return JSON.parse(this.sent.find((m) => typeof m === 'string' && m.includes('"hello"')));
  }
  control(msg) {
    this.onmessage({ data: JSON.stringify(msg) });
  }
}

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { protocol: 'http:', host: 'example.test' };
globalThis.WebSocket = FakeWebSocket;

const { TerminalConnection } = await import('../connection.js');

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

const conn = () => new TerminalConnection({ onState: () => {}, onSession: () => {}, onExit: () => {} });

// --- first load: no stored id, so a fresh session is requested ---------------
store.clear();
let c1 = conn();
c1.connect(80, 24);
let ws1 = FakeWebSocket.last;
ws1.onopen();
check('first load sends hello without a session id', ws1.hello().sessionId === undefined, JSON.stringify(ws1.hello()));

ws1.control({ t: 'welcome', sessionId: 'sess-1', offset: 0 });
check('welcome stores the session id', store.get('web-terminal.sessionId') === 'sess-1', String(store.get('web-terminal.sessionId')));

// --- reload: the stored id is resumed, not replaced -------------------------
let c2 = conn();
c2.connect(80, 24);
let ws2 = FakeWebSocket.last;
ws2.onopen();
const hello2 = ws2.hello();
check('reload resumes the stored session', hello2.sessionId === 'sess-1', JSON.stringify(hello2));
check('  and resumes from offset 0', hello2.lastOffset === 0, String(hello2.lastOffset));

// --- an explicit id wins over storage ---------------------------------------
let c3 = conn();
c3.connect(80, 24, 'sess-explicit');
let ws3 = FakeWebSocket.last;
ws3.onopen();
check('explicit session id overrides storage', ws3.hello().sessionId === 'sess-explicit', JSON.stringify(ws3.hello()));

// --- exit clears the stored id so the next load starts fresh -----------------
ws2.control({ t: 'exit', code: 0 });
check('exit clears the stored session id', store.get('web-terminal.sessionId') === undefined, String(store.get('web-terminal.sessionId')));

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
