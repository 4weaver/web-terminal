// Copyright (c) 2026 YeonGyu Kim
// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. This module is a JavaScript port
// of the original src/client/ime-input.ts; the original copyright notice is
// retained. Full license text: LICENSE at the repo root.

// ghostty prevents beforeinput and only forwards composed text, so an IME commit
// with no composition session (phone keyboards, macOS Chinese punctuation) is lost.

const COMPOSITION_DEDUP_MS = 100;

export function attachImeInputForwarding(container, sendInput) {
  let composing = false;
  let lastComposition;

  const onCompositionStart = () => {
    composing = true;
    lastComposition = undefined;
  };
  const onCompositionEnd = (event) => {
    composing = false;
    lastComposition = event.data === "" ? undefined : { data: event.data, endedAt: Date.now() };
  };
  const onBeforeInput = (event) => {
    if (composing) return;
    // Held backspace on iOS arrives as beforeinput only, with no keydown.
    if (event.inputType === "deleteContentBackward") {
      lastComposition = undefined;
      sendInput("\u007f");
      return;
    }
    if (event.inputType === "insertLineBreak") {
      lastComposition = undefined;
      sendInput("\r");
      return;
    }
    if (event.inputType !== "insertText" || event.data === null || event.data === "") return;
    // Skip the echo of text ghostty's compositionend just sent.
    const duplicate =
      lastComposition !== undefined &&
      event.data === lastComposition.data &&
      Date.now() - lastComposition.endedAt < COMPOSITION_DEDUP_MS;
    lastComposition = undefined;
    if (!duplicate) sendInput(event.data);
  };

  // capture: ghostty preventDefaults beforeinput in the bubble phase.
  container.addEventListener("compositionstart", onCompositionStart, { capture: true });
  container.addEventListener("compositionend", onCompositionEnd, { capture: true });
  container.addEventListener("beforeinput", onBeforeInput, { capture: true });
  return () => {
    container.removeEventListener("compositionstart", onCompositionStart, { capture: true });
    container.removeEventListener("compositionend", onCompositionEnd, { capture: true });
    container.removeEventListener("beforeinput", onBeforeInput, { capture: true });
  };
}
