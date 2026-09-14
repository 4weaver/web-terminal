// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed.
// Full license text: LICENSE at the repo root.
//
// insertText/IME forwarder check (web/ime-input.js). The dropped-commit bug only
// shows on a phone IME or macOS Chinese punctuation, so it needs a test.

import { attachImeInputForwarding } from '../ime-input.js';

class FakeContainer {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((f) => f !== fn));
  }
  dispatch(type, event) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  totalListeners() {
    let n = 0;
    for (const list of this.listeners.values()) n += list.length;
    return n;
  }
}

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

const setup = () => {
  const container = new FakeContainer();
  const sent = [];
  const detach = attachImeInputForwarding(container, (data) => sent.push(data));
  return { container, sent, detach };
};

const insertText = (data) => ({ inputType: 'insertText', data });

// macOS Chinese-IME punctuation: a single insertText, no composition session.
let { container, sent, detach } = setup();
container.dispatch('beforeinput', insertText('，'));
container.dispatch('beforeinput', insertText('。'));
check('insertText without composition is forwarded', sent.join('') === '，。', JSON.stringify(sent));

// iOS held backspace / Korean jamo arrive as beforeinput deletes, no keydown.
({ container, sent } = setup());
container.dispatch('beforeinput', { inputType: 'deleteContentBackward', data: null });
check('deleteContentBackward -> DEL', sent.length === 1 && sent[0] === '\u007f', JSON.stringify(sent));

({ container, sent } = setup());
container.dispatch('beforeinput', { inputType: 'insertLineBreak', data: null });
check('insertLineBreak -> CR', sent.length === 1 && sent[0] === '\r', JSON.stringify(sent));

// Other input types (e.g. deleteWordBackward) must be ignored, not mis-sent.
({ container, sent } = setup());
container.dispatch('beforeinput', { inputType: 'deleteWordBackward', data: null });
container.dispatch('beforeinput', { inputType: 'insertParagraph', data: null });
check('unhandled inputTypes ignored', sent.length === 0, JSON.stringify(sent));

// Composition path: ghostty's compositionend already sends. A beforeinput with
// the same data right after must not send it a second time.
({ container, sent } = setup());
container.dispatch('compositionend', { data: '你' });
container.dispatch('beforeinput', insertText('你'));
check('composition-end duplicate suppressed', sent.length === 0, JSON.stringify(sent));

({ container, sent } = setup());
container.dispatch('compositionend', { data: '你' });
container.dispatch('beforeinput', insertText('好'));
check('different insertText after composition still sent', sent.length === 1 && sent[0] === '好', JSON.stringify(sent));

// During an active composition, beforeinput is ignored (ghostty sends at end).
({ container, sent } = setup());
container.dispatch('compositionstart', {});
container.dispatch('beforeinput', insertText('ni'));
check('beforeinput ignored mid-composition', sent.length === 0, JSON.stringify(sent));
container.dispatch('compositionend', { data: '你' });
check('  then composition data is the commit', sent.length === 0, 'compositionend is sent by ghostty, not here');

// Empty insertText / null data are no-ops.
({ container, sent } = setup());
container.dispatch('beforeinput', insertText(''));
container.dispatch('beforeinput', { inputType: 'insertText', data: null });
check('empty insertText ignored', sent.length === 0, JSON.stringify(sent));

// detach removes every listener it added.
({ container, sent, detach } = setup());
detach();
check('detach removes all listeners', container.totalListeners() === 0, String(container.totalListeners()));

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
