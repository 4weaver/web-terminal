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

`WT_PASSWORD` / `WT_PASSWORD_HASH` are **not implemented yet** — see Status.

## Status

Working and verified:

- PTY sessions via `creack/pty`; output pumped into a bounded 4 MB replay buffer.
- **Disconnect-surviving sessions** — the server owns the PTY. A reconnecting
  client sends its last byte offset and receives exactly the bytes it missed.
  Verified end to end (`cmd/wstest`).
- Binary WebSocket protocol, byte-compatible with the original: output frames
  `[0x01][uint64 offset][payload]`, input frames `[0x02][payload]`, JSON control
  messages (`hello` / `welcome` / `reset` / `resize` / `ping` / `pong` / `exit` / `error`).
- Reconnect tail snapped to a safe repaint boundary (last newline, else start).
- Frontend: `ghostty-web` + a minimal client with a mobile Esc/Ctrl/arrow key row.

**Not implemented** (the original has these; this fork does not yet):

- Authentication. No `WT_PASSWORD`, no argon2, no Authelia integration. **Do not
  expose this beyond a trusted network.**
- File explorer API (`/api/files`), session picker UI, herdr sidebar, theming,
  and the full `DESIGN.md` visual system.
- The original's Playwright/QA suite.

## Checks

```bash
go test ./...                                       # replay buffer + boundary snap
node web/test/ime-keys.test.mjs                     # IME key fold (web/index.html)
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
