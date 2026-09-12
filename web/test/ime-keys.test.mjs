// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed.
// Full license text: LICENSE at the repo root.
//
// Self-check for the IME key fold in web/index.html. The handler and key table
// are copied verbatim from that file; `node web/test/ime-keys.test.mjs` must
// pass. This exists because the bugs it guards are invisible on a desktop
// keyboard: they only appear on IMEs such as Trime that deliver keys with an
// empty event.code, which ghostty-web's code-keyed encoder silently drops.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

// --- copies of the source under test ---------------------------------------
const NAMED_KEYS = {
  33: '\x1b[5~', 34: '\x1b[6~', 35: '\x1b[F', 36: '\x1b[H',
  37: '\x1b[D', 38: '\x1b[A', 39: '\x1b[C', 40: '\x1b[B',
  45: '\x1b[2~', 46: '\x1b[3~',
  9: '\t', 13: '\r', 27: '\x1b', 8: '\x7f',
};

let sent = [];
let ctrlLatched = false;
const setLatch = (on) => { ctrlLatched = on; };
const send = (b) => sent.push(b);

function handler(event) {
  if (event.type !== 'keydown') return false;
  if (event.code === '') {
    const named = NAMED_KEYS[event.keyCode];
    if (named !== undefined) { send(named); setLatch(false); return true; }
    if (event.ctrlKey && !event.metaKey) {
      if (event.keyCode >= 65 && event.keyCode <= 90) {
        send(String.fromCharCode(event.keyCode & 0x1f)); setLatch(false); return true;
      }
      if (event.keyCode === 219) { send('\x1b'); setLatch(false); return true; }
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
      send('\x1b' + event.key); setLatch(false); return true;
    }
  }
  if (!ctrlLatched) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  const ch = event.key;
  if (ch.length !== 1) return false;
  send(String.fromCharCode(ch.toUpperCase().charCodeAt(0) & 0x1f));
  setLatch(false);
  return true;
}

// --- drift guard ------------------------------------------------------------
// Collapse all whitespace so line breaks and indentation cannot cause a false
// drift report; the guard cares about control flow, not layout. Comments are
// stripped, including trailing ones.
const norm = (s) => s.split('\n')
  .map((l) => l.trim().replace(/\s*\/\/.*$/, '').trim())
  .filter((l) => l && !l.startsWith('//'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();
const srcHandler = html.match(/term\.attachCustomKeyEventHandler\(\(event\) => \{([\s\S]*?)\n\}\);\n/);
const srcTable = html.match(/const NAMED_KEYS = \{([\s\S]*?)\n\};\n/);
if (!srcHandler || !srcTable) {
  console.log('FAIL  could not locate the handler or key table in web/index.html');
  process.exit(1);
}

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

// Parse the source table's entries and compare *values*, not source text: escape
// sequences never survive a text comparison, so a string diff here would always
// disagree even when the two are identical.
const parseTable = (body) => {
  const out = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(\d+):\s*'((?:[^'\\]|\\.)*)'/);
    if (!m) continue;
    // eslint-disable-next-line no-eval
    out[m[1]] = eval(`'${m[2]}'`);
  }
  return out;
};
const srcKeys = parseTable(srcTable[1]);
const testKeys = Object.fromEntries(Object.entries(NAMED_KEYS).map(([k, v]) => [String(k), v]));
const same = JSON.stringify(Object.entries(srcKeys).sort()) === JSON.stringify(Object.entries(testKeys).sort());
if (!same) {
  console.log('FAIL  NAMED_KEYS in web/index.html has drifted from this test');
  console.log('--- index.html ---'); console.log(srcKeys);
  console.log('--- test copy ---'); console.log(testKeys);
  fails++;
} else {
  check('key table matches web/index.html', Object.keys(srcKeys).length + ' entries');
}

const testHandler = norm(handler.toString()
  .replace(/^function handler\(event\) \{/, '')
  .replace(/\}$/, ''));
if (norm(srcHandler[1]) !== testHandler) {
  console.log('FAIL  handler in web/index.html has drifted from this test');
  console.log('--- index.html ---\n' + norm(srcHandler[1]));
  console.log('--- test copy ---\n' + testHandler);
  fails++;
} else {
  check('handler matches web/index.html', true);
}

// --- behaviour: recorded device events --------------------------------------
// Mobile ArrowUp, exactly as captured on the device: code="", keyCode=38.
const imeKey = (o) => ({ type: 'keydown', key: '', code: '', keyCode: 0,
  ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...o });

const press = (ev) => { sent = []; ctrlLatched = false; const h = handler(ev); return { h, out: sent[0] }; };

let r = press(imeKey({ key: 'ArrowUp', keyCode: 38 }));
check('mobile ArrowUp -> ESC [ A', r.h && r.out === '\x1b[A', JSON.stringify(r.out));
r = press(imeKey({ key: 'ArrowDown', keyCode: 40 }));
check('mobile ArrowDown -> ESC [ B', r.h && r.out === '\x1b[B', JSON.stringify(r.out));
r = press(imeKey({ key: 'ArrowRight', keyCode: 39 }));
check('mobile ArrowRight -> ESC [ C', r.h && r.out === '\x1b[C', JSON.stringify(r.out));
r = press(imeKey({ key: 'ArrowLeft', keyCode: 37 }));
check('mobile ArrowLeft -> ESC [ D', r.h && r.out === '\x1b[D', JSON.stringify(r.out));
r = press(imeKey({ key: 'Insert', keyCode: 45 }));
check('mobile Insert -> ESC [ 2 ~', r.h && r.out === '\x1b[2~', JSON.stringify(r.out));
r = press(imeKey({ key: 'Delete', keyCode: 46 }));
check('mobile Delete -> ESC [ 3 ~', r.h && r.out === '\x1b[3~', JSON.stringify(r.out));
r = press(imeKey({ key: 'Escape', keyCode: 27 }));
check('mobile Escape -> ESC', r.h && r.out === '\x1b', JSON.stringify(r.out));
r = press(imeKey({ key: 'Tab', keyCode: 9 }));
check('mobile Tab -> \\t', r.h && r.out === '\t', JSON.stringify(r.out));
r = press(imeKey({ key: 'Enter', keyCode: 13 }));
check('mobile Enter -> \\r', r.h && r.out === '\r', JSON.stringify(r.out));
r = press(imeKey({ key: 'Backspace', keyCode: 8 }));
check('mobile Backspace -> DEL', r.h && r.out === '\x7f', JSON.stringify(r.out));
r = press(imeKey({ key: 'Home', keyCode: 36 }));
check('mobile Home -> ESC [ H', r.h && r.out === '\x1b[H', JSON.stringify(r.out));

// Recorded Ctrl: code="", key="c", keyCode=67, ctrlKey=true
r = press(imeKey({ key: 'c', keyCode: 67, ctrlKey: true }));
check('mobile Ctrl+c -> 0x03', r.h && r.out === '\x03', JSON.stringify(r.out));
r = press(imeKey({ key: '[', keyCode: 219, ctrlKey: true }));
check('mobile Ctrl+[ -> ESC', r.h && r.out === '\x1b', JSON.stringify(r.out));
r = press(imeKey({ key: 'c', keyCode: 67, ctrlKey: true, shiftKey: true }));
check('mobile Ctrl+Shift+c -> 0x03', r.h && r.out === '\x03', JSON.stringify(r.out));
// Ctrl+Alt must not emit a bare letter (the old bug).
r = press(imeKey({ key: 'c', keyCode: 67, ctrlKey: true, altKey: true }));
check('mobile Ctrl+Alt+c -> 0x03, not "c"', r.h && r.out === '\x03', JSON.stringify(r.out));

// Alt/<char> is an ESC prefix.
r = press(imeKey({ key: 'b', keyCode: 66, altKey: true }));
check('mobile Alt+b -> ESC b', r.h && r.out === '\x1bb', JSON.stringify(r.out));

// --- regression: real keyboards must NOT be intercepted ---------------------
// PC: code="ArrowRight", keyCode=39 — the encoder handles this correctly.
r = press({ type: 'keydown', key: 'ArrowRight', code: 'ArrowRight', keyCode: 39,
  ctrlKey: false, altKey: false, metaKey: false, shiftKey: false });
check('PC ArrowRight passes through (code populated)', r.h === false && sent.length === 0);

r = press({ type: 'keydown', key: 'c', code: 'KeyC', keyCode: 67,
  ctrlKey: false, altKey: false, metaKey: false, shiftKey: false });
check('PC plain c passes through', r.h === false && sent.length === 0);

r = press({ type: 'keydown', key: 'c', code: 'KeyC', keyCode: 67,
  ctrlKey: true, altKey: false, metaKey: false, shiftKey: false });
check('PC Ctrl+c left to encoder', r.h === false && sent.length === 0);

// --- latch still works ------------------------------------------------------
sent = []; ctrlLatched = true;
let h = handler({ type: 'keydown', key: 'c', code: 'KeyC', keyCode: 67,
  ctrlKey: false, altKey: false, metaKey: false, shiftKey: false });
check('latched Ctrl+c -> 0x03', h === true && sent[0] === '\x03', JSON.stringify(sent[0]));
check('  latch consumed', ctrlLatched === false);

// --- misc -------------------------------------------------------------------
r = press({ type: 'keyup', key: 'ArrowUp', code: '', keyCode: 38,
  ctrlKey: false, altKey: false, metaKey: false, shiftKey: false });
check('keyup ignored', r.h === false && sent.length === 0);

r = press(imeKey({ key: 'c', keyCode: 67, metaKey: true }));
check('Meta+c not swallowed', r.h === false && sent.length === 0);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
