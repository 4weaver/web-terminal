// Copyright (c) 2026 YeonGyu Kim
// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. This module is a JavaScript
// port of the original src/client/connection.ts (same protocol, backoff and
// keepalive design); the original copyright notice is retained.
// Full license text: LICENSE at the repo root.

// Port of web-terminal's connection.ts: same wire protocol, same offset-resume
// semantics, so a reconnect continues the stream instead of repainting it.
const MAX_BACKOFF_MS = 15_000;
const INITIAL_BACKOFF_MS = 300;
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 45_000;

const OP_OUTPUT = 0x01;
const OP_INPUT = 0x02;

export function encodeInput(bytes) {
  const frame = new Uint8Array(1 + bytes.length);
  frame[0] = OP_INPUT;
  frame.set(bytes, 1);
  return frame;
}

export function decodeOutput(data) {
  if (data.length < 1 || data[0] !== OP_OUTPUT) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offset = Number(view.getBigUint64(1));
  return { offset, payload: data.subarray(9) };
}

export class TerminalConnection {
  #ws;
  #sessionId;
  #offset = 0;
  #attempts = 0;
  #closed = false;
  #pingTimer;
  #pingSentAt = 0;
  #lastPongAt = 0;
  #cols = 80;
  #rows = 24;
  #events;

  constructor(events) {
    this.#events = events;
  }

  connect(cols, rows, sessionId) {
    this.#cols = cols;
    this.#rows = rows;
    if (sessionId !== undefined) this.#sessionId = sessionId;
    this.#open();
  }

  sendInput(data) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(encodeInput(new TextEncoder().encode(data)));
    }
  }

  sendResize(cols, rows) {
    this.#cols = cols;
    this.#rows = rows;
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify({ t: 'resize', cols, rows }));
    }
  }

  close() {
    this.#closed = true;
    this.#stopPing();
    this.#ws?.close();
    this.#events.onState('closed');
  }

  #open() {
    this.#events.onState(this.#attempts === 0 ? 'connecting' : 'reconnecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.#ws = ws;

    ws.onopen = () => {
      const hello = { t: 'hello', cols: this.#cols, rows: this.#rows };
      if (this.#sessionId !== undefined) {
        hello.sessionId = this.#sessionId;
        hello.lastOffset = this.#offset;
      }
      ws.send(JSON.stringify(hello));
      this.#startPing();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') this.#handleControl(JSON.parse(event.data));
      else this.#handleBinary(new Uint8Array(event.data));
    };

    ws.onclose = () => {
      this.#stopPing();
      if (this.#closed) return;
      const backoff = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** this.#attempts)
        * (0.7 + Math.random() * 0.6);
      this.#attempts += 1;
      this.#events.onState('reconnecting');
      setTimeout(() => { if (!this.#closed) this.#open(); }, backoff);
    };
  }

  #handleControl(msg) {
    switch (msg.t) {
      case 'welcome':
        this.#sessionId = msg.sessionId;
        this.#offset = msg.offset;
        this.#attempts = 0;
        this.#events.onSession(msg.sessionId);
        this.#events.onState('connected');
        return;
      case 'reset':
        this.#offset = msg.offset;
        this.#events.onReset();
        return;
      case 'pong':
        this.#lastPongAt = Date.now();
        this.#events.onLatency(this.#lastPongAt - this.#pingSentAt);
        return;
      case 'exit':
        this.#events.onExit(msg.code);
        return;
      case 'error':
        console.error('server protocol error:', msg.message);
        return;
    }
  }

  #handleBinary(data) {
    const frame = decodeOutput(data);
    if (!frame) return;
    // Frames older than what we have already shown are dropped; the remainder of
    // the overlap is skipped so a replay never duplicates output.
    if (frame.offset > this.#offset) return;
    const skip = this.#offset - frame.offset;
    if (skip >= frame.payload.length) return;
    const fresh = frame.payload.subarray(skip);
    this.#offset += fresh.length;
    this.#events.onOutput(fresh);
  }

  #startPing() {
    this.#stopPing();
    this.#lastPongAt = Date.now();
    this.#pingTimer = setInterval(() => {
      const ws = this.#ws;
      if (ws?.readyState !== WebSocket.OPEN) return;
      // A blackholed socket never fires onclose, so force it closed when pongs stop.
      if (Date.now() - this.#lastPongAt > PONG_TIMEOUT_MS) { ws.close(); return; }
      this.#pingSentAt = Date.now();
      ws.send(JSON.stringify({ t: 'ping' }));
    }, PING_INTERVAL_MS);
  }

  #stopPing() {
    if (this.#pingTimer !== undefined) clearInterval(this.#pingTimer);
    this.#pingTimer = undefined;
  }
}
