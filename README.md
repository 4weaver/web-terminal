# web-terminal-go

A **Go** fork of [web-terminal](https://github.com/code-yeongyu/web-terminal) by
[YeonGyu Kim](https://github.com/code-yeongyu) — a mobile-first, self-hosted web
terminal built on [Ghostty](https://ghostty.org)'s VT engine compiled to WebAssembly.

This fork replaces the original **Bun/TypeScript server** with a **Go server**.
The browser side keeps the original architecture and the same
[`ghostty-web`](https://github.com/coder/ghostty-web) engine. **No JavaScript
runtime is involved on the server.**

## Credit

This is a fork, not an independent project. Nearly all of the design is the
original author's work:

- **YeonGyu Kim** ([@code-yeongyu](https://github.com/code-yeongyu)) — the original
  [web-terminal](https://github.com/code-yeongyu/web-terminal): the entire
  frontend, the mobile-first UX (touch key toolbar, safe-area handling, IME
  composition), the disconnect-survival *architecture* (server-owned PTYs, replay
  buffer, cumulative byte offsets), the binary WebSocket protocol, the
  `DESIGN.md` design system, and the design rationale for choosing `ghostty-web`.
  The commit history of this fork is entirely his work.
- **Coder** — [`ghostty-web`](https://github.com/coder/ghostty-web), the
  xterm.js-compatible WASM terminal engine used in the browser.
- **Ghostty** — the VT parser compiled into that WASM module.

The Go backend in this fork is a reimplementation of the original
`src/server/*` logic. Files that derive from the original TypeScript carry both
copyright notices; see the header of each file.

Licensed **MIT** — see [LICENSE](./LICENSE), which retains the original
`Copyright (c) 2026 YeonGyu Kim`.

## Why fork

The original requires **Bun ≥ 1.4 canary** for `Bun.Terminal`, and is written in
TypeScript with a runtime dependency tree. For a long-lived self-hosted service
that is a lot of moving parts. Go gives a single static binary, a tiny dependency
surface, and packaging that fits nixpkgs directly.

Measured differences:

| | original | this fork |
|---|---|---|
| Runtime | Bun ≥ 1.4 (canary for `Bun.Terminal`) | single static Go binary |
| Server deps | npm tree (`ghostty-web`, `zod`) + `node_modules` layout assumption | 2 Go modules, **0 transitive** |
| Build | `bun install` at runtime | `go build` (~1 s warm), CGO-free |
| Binary | — | ~9 MB static |
| herdr | required by default; its absence crashed the process | absent; `WT_SHELL` selects the session command |

## Quick start

Requires Go ≥ 1.24.

```bash
go build -o web-terminal-go .
WT_PORT=20008 WT_HOST=127.0.0.1 WT_SHELL=/bin/bash ./web-terminal-go
# open http://127.0.0.1:20008
```

### Configuration

The `WT_*` variable names match the original where the meaning is the same.

| Env | Default | Meaning |
|---|---|---|
| `WT_PORT` | `7777` | Listen port |
| `WT_HOST` | `127.0.0.1` | Bind address |
| `WT_SHELL` | `$SHELL` | Session command (run with `-l`) |
| `WT_STATIC_DIR` | `web` | Directory serving the frontend |
| `WT_FILES_ROOT` | `$HOME` | File API jail root |
| `WT_NO_CACHE` | unset | Set to disable static-asset caching — for dev/test instances |
| `WT_IDLE_TIMEOUT` | `1800` | Seconds a session with no attached client survives before it is reaped (`0` disables) |
| `WT_CLOSE_TIMEOUT` | `10` | Seconds after a deliberate client close before that session is reaped (falls back to `WT_IDLE_TIMEOUT` when `0`) |
| `WT_THEME` | `catppuccin-mocha` | Terminal palette: `catppuccin-mocha`, `tokyo-night`, `gruvbox-dark` |
| `WT_FONT` | `lilex` | Canvas face: `lilex`, `jetbrains-mono`, `iosevka` (Iosevka Term Nerd Font Mono) |
| `WT_FONT_SIZE` | `14` | Default cell size in px. This browser may offset it (see below). |
| `WT_ALPHA` | unset (off) | `1` / `true` / `on` enables a transparent 2D canvas. Default is opaque. |

Unknown theme/font names fall back to the defaults. The client reads these from
`GET /api/config`.

**Font size in the session** (no on-screen control): Ctrl/Cmd `+` or `=` grows,
`-` shrinks, `0` resets to `WT_FONT_SIZE`. On the phone, latch **ctrl** on the
key row then type `-` / `=` / `0`. Range 10–22. The offset is stored in
`localStorage` as a delta, so changing `WT_FONT_SIZE` moves every device.

`WT_PASSWORD` / `WT_PASSWORD_HASH` are **not implemented yet** — see Status.

## Status

Working and verified:

- PTY sessions via `creack/pty`; output pumped into a bounded 4 MB replay buffer.
- **Disconnect-surviving sessions** — the server owns the PTY. A reconnecting
  client sends its last byte offset and receives exactly the bytes it missed.
  Verified end to end (`cmd/wstest`). A reload resumes the same session (the id
  is kept in `sessionStorage`), and a session with no attached client is reaped
  after `WT_IDLE_TIMEOUT` — otherwise every reload would leak a session, and
  with a multiplexer command, another client on the shared render loop.
- Binary WebSocket protocol, byte-compatible with the original: output frames
  `[0x01][uint64 offset][payload]`, input frames `[0x02][payload]`, JSON control
  messages (`hello` / `welcome` / `reset` / `resize` / `ping` / `pong` / `exit` / `error`).
- Reconnect tail snapped to a safe repaint boundary (last newline, else start).
- Frontend: `ghostty-web` + a minimal client with a mobile Esc/Ctrl/arrow key row.
- Appearance: env-selected terminal palette and Nerd Font Mono face; runtime
  font size via Ctrl/Cmd `+`/`-` (localStorage delta on `WT_FONT_SIZE`).

**Not implemented** (the original has these; this fork does not yet):

- Authentication. No `WT_PASSWORD`, no argon2, no Authelia integration. **Do not
  expose this beyond a trusted network.**
- File explorer API (`/api/files`), session picker UI, herdr sidebar, and the
  full `DESIGN.md` visual system.
- The original's Playwright/QA suite.

## Checks

```bash
go test ./...                                       # replay buffer + boundary snap + appearance env
node web/test/appearance.test.mjs                   # theme/font catalog + size delta/hotkeys
node web/test/ime-keys.test.mjs                     # IME key fold (web/index.html)
node web/test/ime-input.test.mjs                    # non-composing IME insertText (web/ime-input.js)
node web/test/mouse-encode.test.mjs                 # SGR 1006 mouse reports (web/mouse-encode.js)
node web/test/mouse-input.test.mjs                  # touch tap / swipe / long-press drag (web/mouse-input.js)
node web/test/connection.test.mjs                   # reload resumes the stored session (web/connection.js)
go run ./cmd/wstest ws://127.0.0.1:20008/ws         # protocol + resume, live server
```

## Layout

```
main.go                     entrypoint
internal/protocol/          wire format (Go port of src/shared/protocol.ts)
internal/pty/               PTY spawn/resize via creack/pty
internal/session/           session store + replay buffer (ports of src/server/*)
internal/web/               HTTP + WebSocket (ports of src/server/*)
web/                        frontend: index.html, connection.js, vendored ghostty-web
cmd/wstest/                 protocol/conformance test client
```
