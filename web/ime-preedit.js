// Copyright (c) 2026 YeonGyu Kim
// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. This module is a JavaScript port
// of the original src/client/ime-preedit.ts; the original copyright notice is
// retained. Full license text: LICENSE at the repo root.

// ghostty ignores compositionupdate and pins its 1x1 textarea at the container
// origin, so the OS candidate window lands in the corner. Draw the preedit at
// the cursor and move the textarea with it (the UA anchors the window to the
// focused element). Never sends input — ghostty's compositionend stays the sender.

function readCursor(terminal) {
  const cursor = terminal.wasmTerm?.getCursor();
  if (cursor === undefined) return undefined;
  const { viewportX, viewportY } = cursor;
  if (!Number.isFinite(viewportX) || !Number.isFinite(viewportY)) return undefined;
  return { viewportX, viewportY };
}

function cursorCell(terminal) {
  const metrics = terminal.renderer?.getMetrics();
  const cursor = readCursor(terminal);
  if (metrics === undefined || cursor === undefined) return undefined;
  if (cursor.viewportY < 0 || cursor.viewportY >= terminal.rows) return undefined;
  return {
    x: cursor.viewportX * metrics.width,
    y: cursor.viewportY * metrics.height,
    width: metrics.width,
    height: metrics.height,
  };
}

export function attachImePreedit(container, terminal) {
  const overlay = document.createElement("span");
  overlay.className = "term-preedit";
  overlay.hidden = true;
  container.appendChild(overlay);

  let composing = false;
  let trackers = [];

  const hide = () => {
    overlay.hidden = true;
    overlay.textContent = "";
  };

  const place = () => {
    const cell = cursorCell(terminal);
    if (cell === undefined || overlay.textContent === "") {
      overlay.hidden = true;
      return;
    }
    overlay.style.transform = `translate(${cell.x}px, ${cell.y}px)`;
    overlay.style.fontSize = `${terminal.options.fontSize}px`;
    overlay.style.lineHeight = `${cell.height}px`;
    overlay.hidden = false;
    const textarea = terminal.textarea;
    if (textarea === undefined) return;
    // clamp: iOS scrolls an off-screen focused input into view
    const maxX = Math.max(0, container.clientWidth - 1);
    const maxY = Math.max(0, container.clientHeight - 1);
    textarea.style.left = `${Math.min(Math.max(0, cell.x), maxX)}px`;
    textarea.style.top = `${Math.min(Math.max(0, cell.y), maxY)}px`;
  };

  const startTracking = () => {
    if (trackers.length > 0) return;
    trackers = [terminal.onCursorMove(place).dispose, terminal.onScroll(place).dispose];
  };

  const stopTracking = () => {
    for (const dispose of trackers) dispose();
    trackers = [];
  };

  const onCompositionStart = () => {
    composing = true;
    startTracking();
    place();
  };

  const onCompositionUpdate = (event) => {
    if (!composing) return;
    overlay.textContent = event.data;
    place();
  };

  const onCompositionEnd = () => {
    composing = false;
    stopTracking();
    // hide before ghostty sends the commit, or the syllable shows twice
    hide();
    const textarea = terminal.textarea;
    if (textarea === undefined) return;
    // ghostty never clears it; a growing value drifts the caret rect
    queueMicrotask(() => {
      textarea.value = "";
    });
  };

  container.addEventListener("compositionstart", onCompositionStart, { capture: true });
  container.addEventListener("compositionupdate", onCompositionUpdate, { capture: true });
  container.addEventListener("compositionend", onCompositionEnd, { capture: true });

  return () => {
    container.removeEventListener("compositionstart", onCompositionStart, { capture: true });
    container.removeEventListener("compositionupdate", onCompositionUpdate, { capture: true });
    container.removeEventListener("compositionend", onCompositionEnd, { capture: true });
    stopTracking();
    overlay.remove();
  };
}
