// Copyright (c) 2026 YeonGyu Kim
// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. This module is a JavaScript port
// of the original src/client/mouse-input.ts; the original copyright notice is
// retained. Full license text: LICENSE at the repo root.

// SGR 1006 reports for pointer + touch, gated on the TUI asking for the mouse.
// ghostty parses the DECSET modes but emits no reports itself, so without this a
// TUI (zellij, nvim) sees no mouse. Tracking off leaves native behavior alone.

import { encodeMouseClick, encodeMouseMotion } from "./mouse-encode.js";

const MOTION_THROTTLE_MS = 40;
const LONG_PRESS_MS = 350;
const TOUCH_SLOP_PX = 12;

function trackingActive(terminal) {
  try {
    return terminal.hasMouseTracking();
  } catch {
    return false; // hasMouseTracking() throws when the terminal is not open
  }
}

function cellAt(terminal, container, clientX, clientY) {
  const canvas = container.querySelector("canvas");
  const rect = (canvas ?? container).getBoundingClientRect();
  const col = Math.floor(((clientX - rect.left) / rect.width) * terminal.cols);
  const row = Math.floor(((clientY - rect.top) / rect.height) * terminal.rows);
  return {
    col: Math.max(0, Math.min(terminal.cols - 1, col)),
    row: Math.max(0, Math.min(terminal.rows - 1, row)),
  };
}

function domButton(event) {
  return event.button === 1 ? "middle" : event.button === 2 ? "right" : "left";
}

function modsOf(event) {
  return { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey };
}

export function attachMouseInput(container, terminal, sendInput) {
  let lastMotionAt = 0;
  let heldButton = "none";

  const onMouseDown = (event) => {
    if (!trackingActive(terminal)) return;
    const button = domButton(event);
    const { col, row } = cellAt(terminal, container, event.clientX, event.clientY);
    heldButton = button;
    sendInput(encodeMouseClick(button, "press", col, row, modsOf(event)));
    // else ghostty's selection manager also paints a selection under the click
    event.preventDefault();
    event.stopPropagation();
  };

  const onMouseUp = (event) => {
    if (!trackingActive(terminal)) return;
    const button = domButton(event);
    const { col, row } = cellAt(terminal, container, event.clientX, event.clientY);
    heldButton = "none";
    sendInput(encodeMouseClick(button, "release", col, row, modsOf(event)));
    event.preventDefault();
    event.stopPropagation();
  };

  const onMouseMove = (event) => {
    if (!trackingActive(terminal)) return;
    const now = Date.now();
    if (now - lastMotionAt < MOTION_THROTTLE_MS) return;
    const anyMotion = terminal.getMode(1003);
    const buttonMotion = terminal.getMode(1002);
    if (!anyMotion && !(buttonMotion && heldButton !== "none")) return;
    lastMotionAt = now;
    const { col, row } = cellAt(terminal, container, event.clientX, event.clientY);
    sendInput(encodeMouseMotion(anyMotion ? "none" : heldButton, col, row, modsOf(event)));
    event.preventDefault();
  };

  container.addEventListener("mousedown", onMouseDown, { capture: true });
  container.addEventListener("mouseup", onMouseUp, { capture: true });
  container.addEventListener("mousemove", onMouseMove, { capture: true });

  // wheel -> buttons 64/65 while tracking, else native scrollback
  const detachWheel = (() => {
    const handler = (event) => {
      if (!trackingActive(terminal)) return false;
      const { col, row } = cellAt(terminal, container, event.clientX, event.clientY);
      const button = event.deltaY < 0 ? "wheel-up" : "wheel-down";
      sendInput(encodeMouseClick(button, "press", col, row, modsOf(event)));
      return true;
    };
    terminal.attachCustomWheelEventHandler(handler);
    return () => terminal.attachCustomWheelEventHandler(() => false);
  })();

  // One finger, two jobs: quick swipe scrolls, hold-then-move is a held-button
  // drag (zellij only starts a border resize on a press it saw before motion).
  let touchStartX;
  let touchStartY;
  let touchStartCell;
  let touchLastCell;
  let touchMoved = false;
  let touchDragging = false;
  let longPressTimer;

  const clearLongPress = () => {
    if (longPressTimer !== undefined) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  };
  const resetTouch = () => {
    clearLongPress();
    touchStartX = undefined;
    touchStartY = undefined;
    touchStartCell = undefined;
    touchLastCell = undefined;
    touchMoved = false;
    touchDragging = false;
  };

  const onTouchStart = (event) => {
    const touch = event.touches[0];
    if (touch === undefined) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchMoved = false;
    touchDragging = false;
    if (!trackingActive(terminal)) return;
    // native selection/magnifier arms on touchstart; too late to suppress later
    event.preventDefault();
    touchStartCell = cellAt(terminal, container, touch.clientX, touch.clientY);
    touchLastCell = touchStartCell;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined;
      touchDragging = true;
      sendInput(encodeMouseClick("left", "press", touchStartCell.col, touchStartCell.row));
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (event) => {
    const touch = event.touches[0];
    if (touch === undefined) return;

    if (touchDragging) {
      const now = Date.now();
      if (now - lastMotionAt >= MOTION_THROTTLE_MS) {
        lastMotionAt = now;
        touchLastCell = cellAt(terminal, container, touch.clientX, touch.clientY);
        sendInput(encodeMouseMotion("left", touchLastCell.col, touchLastCell.row));
      }
      event.preventDefault();
      return;
    }

    if (touchStartX === undefined || touchStartY === undefined) return;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    // under the slop it could still become a drag, so keep the timer armed
    if (!touchMoved && Math.abs(dx) < TOUCH_SLOP_PX && Math.abs(dy) < TOUCH_SLOP_PX) return;
    clearLongPress();
    if (!trackingActive(terminal)) return;
    const now = Date.now();
    if (now - lastMotionAt < MOTION_THROTTLE_MS) return;
    const deltaY = touchStartY - touch.clientY;
    if (Math.abs(deltaY) < TOUCH_SLOP_PX) return;
    touchMoved = true;
    lastMotionAt = now;
    touchStartY = touch.clientY;
    const { col, row } = cellAt(terminal, container, touch.clientX, touch.clientY);
    sendInput(encodeMouseClick(deltaY < 0 ? "wheel-down" : "wheel-up", "press", col, row));
    event.preventDefault();
  };

  const onTouchEnd = (event) => {
    const touch = event.changedTouches[0];
    const dragging = touchDragging;
    const releaseCell = touchLastCell ?? touchStartCell; // resetTouch clears these
    const startCell = touchStartCell;
    const moved = touchMoved;
    resetTouch();
    if (touch === undefined) return;
    if (dragging) {
      if (releaseCell !== undefined) {
        sendInput(encodeMouseClick("left", "release", releaseCell.col, releaseCell.row));
      }
      event.preventDefault();
      return;
    }
    if (moved || startCell === undefined || !trackingActive(terminal)) return;
    const { col, row } = cellAt(terminal, container, touch.clientX, touch.clientY);
    sendInput(encodeMouseClick("left", "press", col, row));
    sendInput(encodeMouseClick("left", "release", col, row));
    event.preventDefault();
  };

  // a cancelled touch must not leave the button held
  const onTouchCancel = (event) => {
    const dragging = touchDragging;
    const releaseCell = touchLastCell ?? touchStartCell;
    resetTouch();
    if (dragging && releaseCell !== undefined) {
      sendInput(encodeMouseClick("left", "release", releaseCell.col, releaseCell.row));
    }
    event.preventDefault();
  };

  container.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
  container.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  container.addEventListener("touchend", onTouchEnd, { capture: true });
  container.addEventListener("touchcancel", onTouchCancel, { capture: true });

  return () => {
    container.removeEventListener("mousedown", onMouseDown, { capture: true });
    container.removeEventListener("mouseup", onMouseUp, { capture: true });
    container.removeEventListener("mousemove", onMouseMove, { capture: true });
    container.removeEventListener("touchstart", onTouchStart, { capture: true });
    container.removeEventListener("touchmove", onTouchMove, { capture: true });
    container.removeEventListener("touchend", onTouchEnd, { capture: true });
    container.removeEventListener("touchcancel", onTouchCancel, { capture: true });
    clearLongPress();
    detachWheel();
  };
}
