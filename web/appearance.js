// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. Full license text: LICENSE at
// the repo root.

export const DEFAULT_THEME = "catppuccin-mocha";
export const DEFAULT_FONT = "lilex";
export const DEFAULT_FONT_SIZE = 14;
export const DEFAULT_ALPHA = false;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 22;
export const DELTA_KEY = "wt.fontSizeDelta";

export const FONTS = {
  lilex: {
    family: "Lilex Nerd Font Mono",
    file: "LilexNerdFontMono-Regular.woff2",
  },
  "jetbrains-mono": {
    family: "JetBrainsMono Nerd Font Mono",
    file: "JetBrainsMonoNerdFontMono-Regular.woff2",
  },
  iosevka: {
    family: "IosevkaTerm Nerd Font Mono",
    file: "IosevkaTermNerdFontMono-Regular.woff2",
  },
};

// Palettes from official Ghostty / iTerm2-Color-Schemes ports. Do not hand-tune.
export const THEMES = {
  "catppuccin-mocha": {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#11111b",
    selectionBackground: "#353749",
    selectionForeground: "#cdd6f4",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#a6adc8",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#bac2de",
  },
  "tokyo-night": {
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#283457",
    selectionForeground: "#c0caf5",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
  "gruvbox-dark": {
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    cursorAccent: "#282828",
    selectionBackground: "#665c54",
    selectionForeground: "#ebdbb2",
    black: "#282828",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2",
  },
};

export function resolveAppearance(raw) {
  const theme = THEMES[raw?.theme] ? raw.theme : DEFAULT_THEME;
  const font = FONTS[raw?.font] ? raw.font : DEFAULT_FONT;
  const n = Number(raw?.fontSize);
  const fontSize = Number.isFinite(n) ? n : DEFAULT_FONT_SIZE;
  const alpha = raw?.alpha === true;
  return { theme, font, fontSize, alpha };
}

/** ghostty-web always asks for `{ alpha: true }`; override for this open(). */
export function withCanvasAlpha(enabled, fn) {
  const proto = HTMLCanvasElement.prototype;
  const orig = proto.getContext;
  proto.getContext = function getContextAlpha(type, attrs) {
    if (type === "2d") attrs = { ...attrs, alpha: enabled };
    return orig.call(this, type, attrs);
  };
  try {
    return fn();
  } finally {
    proto.getContext = orig;
  }
}

export function readDelta(storage) {
  const n = Number(storage.getItem(DELTA_KEY));
  return Number.isFinite(n) ? n : 0;
}

export function writeDelta(delta, storage) {
  if (delta === 0) storage.removeItem(DELTA_KEY);
  else storage.setItem(DELTA_KEY, String(delta));
}

export function clampSize(envSize, delta) {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, envSize + delta));
}

/** Apply inc/dec/reset; store the effective (clamped) delta. */
export function nextSize(kind, envSize, storage) {
  let delta = readDelta(storage);
  if (kind === "inc") delta += 1;
  else if (kind === "dec") delta -= 1;
  else delta = 0;
  const size = clampSize(envSize, delta);
  writeDelta(size - envSize, storage);
  return size;
}

/**
 * Ctrl/Cmd + =/+  increment, - decrement, 0 reset.
 * Also matches the mobile Ctrl-latch path (ctrlLatched, no modifier on the event).
 */
export function sizeHotkey(event, { ctrlLatched = false } = {}) {
  if (event.type !== "keydown") return null;
  if (event.altKey) return null;
  const chord = event.ctrlKey || event.metaKey || ctrlLatched;
  if (!chord) return null;
  if (event.key === "=" || event.key === "+") return "inc";
  if (event.key === "-") return "dec";
  if (event.key === "0") return "reset";
  return null;
}

export function fontStack(family) {
  return `"${family}", ui-monospace, monospace`;
}

export async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return resolveAppearance({});
    return resolveAppearance(await res.json());
  } catch {
    return resolveAppearance({});
  }
}

export async function loadFont(font) {
  const spec = FONTS[font];
  if (spec === undefined) return;
  const face = new FontFace(spec.family, `url(./fonts/${spec.file})`);
  face.display = "swap";
  document.fonts.add(face);
  try {
    await face.load();
  } catch (err) {
    console.warn("appearance: font load failed", err);
  }
}
