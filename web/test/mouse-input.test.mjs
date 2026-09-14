// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed.
// Full license text: LICENSE at the repo root.
//
// Touch gesture split in web/mouse-input.js: a swipe scrolls, a hold-then-move
// drags. The press must land before any motion or zellij never resizes a border.
// Real timers, so ~0.4s.

import { attachMouseInput } from '../mouse-input.js';

class FakeTarget {
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
}

// 640x480 canvas over an 80x24 grid => cell 8x20px. clientX 10 -> col 1, etc.
const makeTerminal = (modes = {}, tracking = true) => ({
  cols: 80,
  rows: 24,
  hasMouseTracking: () => tracking,
  getMode: (mode) => modes[mode] ?? false,
  attachCustomWheelEventHandler: () => {},
});

const makeContainer = () =>
  Object.assign(new FakeTarget(), {
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) }),
  });

const touchEvent = (x, y) => {
  const touch = { clientX: x, clientY: y };
  return { touches: [touch], changedTouches: [touch], preventDefault: () => {} };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

const setup = (modes, tracking = true) => {
  const container = makeContainer();
  const sent = [];
  const detach = attachMouseInput(container, makeTerminal(modes, tracking), (data) => sent.push(data));
  return { container, sent, detach };
};

// --- long press then drag = held-button drag (pane border resize) -----------
let { container, sent } = setup({ 1002: true });
container.dispatch('touchstart', touchEvent(10, 10));
check('long press sends nothing before the hold elapses', sent.length === 0, JSON.stringify(sent));
await sleep(420);
check('long press commits a press at the down cell', sent[0] === '\u001b[<0;2;1M', JSON.stringify(sent));
container.dispatch('touchmove', touchEvent(40, 10));
check('drag sends button-held motion', sent[1] === '\u001b[<32;6;1M', JSON.stringify(sent));
container.dispatch('touchend', touchEvent(40, 10));
check('drag release reports the last cell', sent[2] === '\u001b[<0;6;1m', JSON.stringify(sent));
check('  and sends no click', sent.length === 3, JSON.stringify(sent));

// --- quick vertical swipe = wheel (scroll), not a drag ----------------------
({ container, sent } = setup({ 1002: true }));
container.dispatch('touchstart', touchEvent(10, 10));
container.dispatch('touchmove', touchEvent(10, 60));
check('quick swipe sends a wheel report', sent.length === 1 && sent[0] === '\u001b[<65;2;4M', JSON.stringify(sent));
container.dispatch('touchend', touchEvent(10, 60));
check('  swipe end sends no click', sent.length === 1, JSON.stringify(sent));
// The pending long-press timer must have been cancelled, or it would fire late.
await sleep(420);
check('  cancelled long press never fires', sent.length === 1, JSON.stringify(sent));

// --- tap = click ------------------------------------------------------------
({ container, sent } = setup({ 1002: true }));
container.dispatch('touchstart', touchEvent(10, 10));
container.dispatch('touchend', touchEvent(10, 10));
check('tap sends press+release', sent.join('|') === '\u001b[<0;2;1M|\u001b[<0;2;1m', JSON.stringify(sent));

// --- a cancelled touch must not leave a button held -------------------------
({ container, sent } = setup({ 1002: true }));
container.dispatch('touchstart', touchEvent(10, 10));
await sleep(420);
check('cancel case: press is held', sent.length === 1, JSON.stringify(sent));
container.dispatch('touchcancel', touchEvent(10, 10));
check('cancel releases the held button', sent[1] === '\u001b[<0;2;1m', JSON.stringify(sent));

// --- tracking off: touch is inert so native scrolling owns the element ------
({ container, sent } = setup(undefined, false));
container.dispatch('touchstart', touchEvent(10, 10));
container.dispatch('touchmove', touchEvent(10, 60));
container.dispatch('touchend', touchEvent(10, 10));
check('no reports while tracking is off', sent.length === 0, JSON.stringify(sent));

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
