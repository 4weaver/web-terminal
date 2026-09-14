// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed.
// Full license text: LICENSE at the repo root.

import { strict as assert } from "node:assert";
import {
  DEFAULT_ALPHA,
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME,
  DELTA_KEY,
  FONTS,
  THEMES,
  clampSize,
  fontStack,
  nextSize,
  readDelta,
  resolveAppearance,
  sizeHotkey,
  writeDelta,
} from "../appearance.js";

const mem = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
};

assert.equal(resolveAppearance({}).theme, DEFAULT_THEME);
assert.equal(resolveAppearance({}).font, DEFAULT_FONT);
assert.equal(resolveAppearance({}).fontSize, DEFAULT_FONT_SIZE);
assert.equal(resolveAppearance({}).alpha, DEFAULT_ALPHA);
assert.equal(resolveAppearance({ theme: "solarized", font: "comic", fontSize: "x" }).theme, DEFAULT_THEME);
assert.equal(resolveAppearance({ theme: "gruvbox-dark", font: "iosevka", fontSize: 16 }).font, "iosevka");
assert.equal(resolveAppearance({ theme: "gruvbox-dark", font: "iosevka", fontSize: 16 }).fontSize, 16);
assert.equal(resolveAppearance({ alpha: true }).alpha, true);
assert.equal(resolveAppearance({ alpha: "true" }).alpha, false);
assert.equal(resolveAppearance({ alpha: 1 }).alpha, false);

assert.equal(clampSize(14, 0), 14);
assert.equal(clampSize(14, 20), 22);
assert.equal(clampSize(14, -20), 10);

{
  const s = mem();
  assert.equal(readDelta(s), 0);
  assert.equal(nextSize("inc", 14, s), 15);
  assert.equal(s.getItem(DELTA_KEY), "1");
  assert.equal(nextSize("dec", 14, s), 14);
  assert.equal(s.getItem(DELTA_KEY), null);
  writeDelta(8, s);
  assert.equal(nextSize("inc", 14, s), 22);
  assert.equal(s.getItem(DELTA_KEY), "8");
  assert.equal(nextSize("reset", 14, s), 14);
  assert.equal(s.getItem(DELTA_KEY), null);
}

const key = (partial) => ({ type: "keydown", altKey: false, ctrlKey: false, metaKey: false, key: "", ...partial });
assert.equal(sizeHotkey(key({ ctrlKey: true, key: "=" })), "inc");
assert.equal(sizeHotkey(key({ metaKey: true, key: "+" })), "inc");
assert.equal(sizeHotkey(key({ ctrlKey: true, key: "-" })), "dec");
assert.equal(sizeHotkey(key({ ctrlKey: true, key: "0" })), "reset");
assert.equal(sizeHotkey(key({ key: "-" }), { ctrlLatched: true }), "dec");
assert.equal(sizeHotkey(key({ key: "=" }), { ctrlLatched: true }), "inc");
assert.equal(sizeHotkey(key({ ctrlKey: true, altKey: true, key: "=" })), null);
assert.equal(sizeHotkey(key({ key: "c" }), { ctrlLatched: true }), null);
assert.equal(sizeHotkey(key({ key: "-" })), null);

assert.ok(THEMES[DEFAULT_THEME].background);
assert.ok(FONTS[DEFAULT_FONT].file.endsWith(".woff2"));
assert.equal(fontStack("Lilex Nerd Font Mono"), `"Lilex Nerd Font Mono", ui-monospace, monospace`);

for (const theme of Object.values(THEMES)) {
  for (const k of [
    "background", "foreground", "cursor", "cursorAccent",
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow",
    "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
  ]) {
    assert.equal(typeof theme[k], "string", k);
    assert.match(theme[k], /^#[0-9a-fA-F]{6}$/, k);
  }
}

console.log("ok");
