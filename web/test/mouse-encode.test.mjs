// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed.
// Full license text: LICENSE at the repo root.
//
// SGR 1006 encoder check (web/mouse-encode.js). Byte layout is asserted: a TUI
// parses these directly, so a wrong Cb silently misclicks.

import { encodeMouseClick, encodeMouseMotion } from '../mouse-encode.js';

let fails = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`}`);
  if (!ok) fails++;
};

const ESC = '\u001b';

// SGR: ESC [ < Cb ; Cx ; Cy M (press) / m (release). Coordinates are 1-based.
check('left press @0,0', encodeMouseClick('left', 'press', 0, 0), `${ESC}[<0;1;1M`);
check('left release @0,0', encodeMouseClick('left', 'release', 0, 0), `${ESC}[<0;1;1m`);
check('middle press @4,7', encodeMouseClick('middle', 'press', 4, 7), `${ESC}[<1;5;8M`);
check('right press @4,7', encodeMouseClick('right', 'press', 4, 7), `${ESC}[<2;5;8M`);
check('wheel-up @1,2', encodeMouseClick('wheel-up', 'press', 1, 2), `${ESC}[<64;2;3M`);
check('wheel-down @1,2', encodeMouseClick('wheel-down', 'press', 1, 2), `${ESC}[<65;2;3M`);

// Modifier bits: shift 4, alt 8, ctrl 16.
check('left+shift', encodeMouseClick('left', 'press', 0, 0, { shift: true }), `${ESC}[<4;1;1M`);
check('left+alt', encodeMouseClick('left', 'press', 0, 0, { alt: true }), `${ESC}[<8;1;1M`);
check('left+ctrl', encodeMouseClick('left', 'press', 0, 0, { ctrl: true }), `${ESC}[<16;1;1M`);
check(
  'left+shift+alt+ctrl',
  encodeMouseClick('left', 'press', 0, 0, { shift: true, alt: true, ctrl: true }),
  `${ESC}[<28;1;1M`,
);

// Motion reports: base 32; button "none" (mode 1003) uses 3, not 0.
check('motion none', encodeMouseMotion('none', 0, 0), `${ESC}[<35;1;1M`);
check('motion left held', encodeMouseMotion('left', 0, 0), `${ESC}[<32;1;1M`);
check('motion right+shift', encodeMouseMotion('right', 3, 9, { shift: true }), `${ESC}[<38;4;10M`);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
