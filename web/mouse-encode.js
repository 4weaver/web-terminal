// Copyright (c) 2026 YeonGyu Kim
// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. This module is a JavaScript port
// of the original src/client/mouse-encode.ts; the original copyright notice is
// retained. Full license text: LICENSE at the repo root.

// SGR 1006: ESC [ < Cb ; Cx ; Cy M (press) / m (release), cells 1-based.

const BUTTON_CODE = {
  left: 0,
  middle: 1,
  right: 2,
  "wheel-up": 64,
  "wheel-down": 65,
};

function modifierBits(mods) {
  return (
    (mods.shift === true ? 4 : 0) | (mods.alt === true ? 8 : 0) | (mods.ctrl === true ? 16 : 0)
  );
}

export function encodeMouseClick(button, action, col, row, mods = {}) {
  const cb = BUTTON_CODE[button] + modifierBits(mods);
  return `\u001b[<${cb};${col + 1};${row + 1}${action === "press" ? "M" : "m"}`;
}

export function encodeMouseMotion(button, col, row, mods = {}) {
  const base = button === "none" ? 3 : BUTTON_CODE[button];
  return `\u001b[<${base + 32 + modifierBits(mods)};${col + 1};${row + 1}M`;
}
