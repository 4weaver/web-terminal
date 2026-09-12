import { SESSION_ID_PREVIEW_LENGTH } from "../shared/protocol.ts"
import { checkAuthed } from "./api.ts"
import { createHerdrStore, type HerdrState } from "./herdr-store.ts"
import { createTerminalApp, type TerminalApp } from "./terminal.ts"
import { openConfirm } from "./ui/confirm.ts"
import { dot, el } from "./ui/dom.ts"
import { openEditor } from "./ui/editor.ts"
import { createFilesPanel } from "./ui/files-panel.ts"
import { createHerdrPanel } from "./ui/herdr-panel.ts"
import { renderLogin } from "./ui/login.ts"
import { openSessionPicker } from "./ui/sessions.ts"
import { createSidebar } from "./ui/sidebar.ts"
import { isMobile, terminalFontSize, terminalTheme } from "./ui/theme.ts"
import { createToaster } from "./ui/toast.ts"
import { applyLatches, createToolbar } from "./ui/toolbar.ts"
import { createTopBar } from "./ui/topbar.ts"

const appRoot = document.getElementById("app")
if (appRoot === null) throw new TypeError("missing #app root")
const app: HTMLElement = appRoot

async function renderApp(): Promise<void> {
  const toaster = createToaster()
  const terminalRegion = el("main", { class: "terminal", "aria-label": "Terminal" })
  let terminalApp: TerminalApp | undefined

  const topBar = createTopBar({
    onToggleSidebar: () => {
      sidebar.toggle()
      shellBody.dataset["docked"] =
        isMobile() || sidebar.element.childElementCount > 0 ? "true" : "false"
    },
    onOpenSessions: () =>
      openSessionPicker({
        background: shell,
        currentSessionId: () => terminalApp?.connection.sessionId,
        onAttach: (id) => terminalApp?.switchSession(id),
        onConfirm: (message, onConfirm) => openConfirm({ message, background: shell, onConfirm }),
        onToast: toaster.show,
      }),
  })

  const filesPanel = createFilesPanel({
    onToast: toaster.show,
    onEdit: (path, name) => {
      const launch = (): void => {
        void openEditor(path, name, {
          background: shell,
          onToast: toaster.show,
          onClosed: () => terminalApp?.fit(),
        })
      }
      if (sidebar.isDrawerOpen()) sidebar.closeDrawer(launch)
      else launch()
    },
    onConfirm: (message, onYes) => openConfirm({ message, background: shell, onConfirm: onYes }),
  })
  const herdrStore = createHerdrStore()
  const herdrPanel = createHerdrPanel(herdrStore)
  const herdrIndicator = dot("idle", "herdr status")
  herdrStore.subscribe((state: HerdrState) => {
    const label = state.status === "connected" ? "herdr connected" : `herdr ${state.status}`
    herdrIndicator.dataset["state"] =
      state.status === "connected"
        ? "connected"
        : state.status === "connecting"
          ? "reconnecting"
          : "offline"
    herdrIndicator.setAttribute("aria-label", label)
  })

  const toolbar = createToolbar({
    sendKeys: (data) => terminalApp?.sendKeys(data),
    paste: (text) => terminalApp?.paste(text),
    hideKeyboard: () => {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
    },
    // The textarea, never terminal.focus(): ghostty focuses its contenteditable
    // container, whose prevented beforeinput silently drops IME text.
    focusTerminal: () => terminalApp?.terminal.textarea?.focus(),
    onError: (message) => toaster.show(message, "error"),
    onLatchChange: () => undefined,
  })

  const sidebar = createSidebar({
    files: filesPanel,
    herdr: herdrPanel,
    herdrIndicator,
    background: terminalRegion,
    onDrawerChange: (open) => {
      topBar.setSidebarExpanded(open)
      if (open) toolbar.resetModifiers()
    },
  })

  const shellBody = el("div", { class: "shell__body" }, [terminalRegion, sidebar.element])
  const shell = el("div", { class: "shell" }, [topBar.element, shellBody])
  if (isMobile()) shell.appendChild(toolbar.element)

  app.replaceChildren(shell, toaster.element)

  const created = await createTerminalApp(terminalRegion, terminalTheme, {
    onState: (state) => {
      topBar.setState(state)
      if (state === "reconnecting") toaster.show("Reconnecting…", "warning")
      if (state === "connected") topBar.setSessionLabel(labelFor(terminalApp))
    },
    onLatency: topBar.setLatency,
    onTitle: (title) => {
      document.title = title === "" ? "web-terminal" : title
      topBar.setSessionLabel(title === "" ? labelFor(terminalApp) : title)
    },
    onSession: () => topBar.setSessionLabel(labelFor(terminalApp)),
    onExit: (code) =>
      toaster.show(
        code === 0
          ? "Session ended. Press Enter for a new one."
          : `Session exited (${code}). Press Enter for a new one.`,
        code === 0 ? "info" : "warning",
      ),
  })
  terminalApp = created
  created.terminal.textarea?.addEventListener("compositionstart", toolbar.resetModifiers)

  // QA hook consumed by script/qa/e2e-scenarios.mjs. Object.assign avoids an `as` cast.
  Object.assign(globalThis, { __wt: created })

  // DESIGN.md 3.2: the terminal cell drops to 13px below --bp-md. Set once here
  // (the type scale is owned by the UI layer, not terminal.ts). ghostty recomputes
  // its own cell metrics on this assignment; the ResizeObserver below re-fits.
  const cellSize = terminalFontSize()
  if (created.terminal.options.fontSize !== cellSize) {
    created.terminal.options.fontSize = cellSize
    // FitAddon is still completing its initial resize in this task. Re-fit from
    // the next task so it uses the updated mobile font metrics.
    setTimeout(() => created.fit(), 0)
  }

  // Ctrl/Alt latch: intercept the next real key press before ghostty encodes it.
  // Returning true suppresses the engine's own send, so exactly one byte goes out.
  created.terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return false
    // IME-delivered keys (Trime and others) arrive with an empty event.code: the
    // IME injects an Android KeyEvent with no hardware scan code for the browser
    // to map. ghostty-web's encoder is keyed on event.code — mapKeyCode() is a
    // plain lookup returning null for "" — so every such key is discarded: arrows,
    // Insert, Delete, Esc, Tab, and Ctrl combinations (whose
    // isPrintableCharacter() is also false when ctrlKey is set). Measured on the
    // device: Ctrl sends code="", keyCode=67; ArrowUp sends code="", keyCode=38. A
    // desktop keyboard populates code and is unaffected, so an empty code is
    // exactly the condition meaning "the encoder cannot cope". Everything below
    // is keyed on keyCode, never event.code.
    if (event.code === "") {
      const named = IME_NAMED_KEYS[event.keyCode]
      if (named !== undefined) {
        created.sendKeys(named)
        return true
      }
      if (event.ctrlKey && !event.metaKey) {
        if (event.keyCode >= 65 && event.keyCode <= 90) {
          created.sendKeys(String.fromCharCode(event.keyCode & 0x1f))
          return true
        }
        if (event.keyCode === 219) {
          created.sendKeys("\u001b") // Ctrl+[
          return true
        }
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
        // Alt/Meta is an ESC prefix, the standard convention.
        created.sendKeys(`\u001b${event.key}`)
        return true
      }
    }
    // macOS-style shortcuts ghostty-web passes to the WASM encoder, which emits
    // nothing for SUPER-modified keys. Map them to the control bytes users expect.
    if (event.metaKey) {
      // Prefer event.code, but fall back to keyCode for IMEs that leave code
      // empty — the same gap the fold above handles.
      const byte = META_KEY_BYTES[event.code] ?? META_KEY_BYTES_BY_KEYCODE[event.keyCode]
      if (byte !== undefined) {
        created.sendKeys(byte)
        return true
      }
      return false
    }
    const mods = toolbar.modifiers()
    if (!mods.ctrl && !mods.alt) return false
    if (event.key.length !== 1) return false
    created.sendKeys(applyLatches(event.key, mods))
    toolbar.consumeLatches()
    return true
  })

  applyResponsiveLayout(shell, shellBody, toolbar.element, sidebar, created, terminalRegion)
}

/** macOS Meta-shortcuts that must reach the PTY as control bytes (research: SUPER-modified keys emit nothing by default). */
const META_KEY_BYTES: Readonly<Record<string, string>> = {
  Backspace: "\u0015", // Cmd+Delete -> Ctrl+U (kill to start of line)
  ArrowLeft: "\u0001", // Cmd+Left -> Ctrl+A (start of line)
  ArrowRight: "\u0005", // Cmd+Right -> Ctrl+E (end of line)
}

/** Same Meta-shortcuts keyed by keyCode, for IMEs that send an empty event.code. */
const META_KEY_BYTES_BY_KEYCODE: Readonly<Record<number, string>> = {
  8: "\u0015", // Backspace -> Ctrl+U
  37: "\u0001", // ArrowLeft -> Ctrl+A
  39: "\u0005", // ArrowRight -> Ctrl+E
}

/**
 * Keys sent by IMEs with an empty event.code, mapped from keyCode to the byte
 * sequence a terminal expects. Keyed on keyCode because the IME leaves code
 * empty, which is what makes ghostty-web's code-keyed encoder drop them.
 */
const IME_NAMED_KEYS: Readonly<Record<number, string>> = {
  33: "\u001b[5~", // PageUp
  34: "\u001b[6~", // PageDown
  35: "\u001b[F", // End
  36: "\u001b[H", // Home
  37: "\u001b[D", // Left
  38: "\u001b[A", // Up
  39: "\u001b[C", // Right
  40: "\u001b[B", // Down
  45: "\u001b[2~", // Insert
  46: "\u001b[3~", // Delete
  9: "\t", // Tab
  13: "\r", // Enter
  27: "\u001b", // Escape
  8: "\u007f", // Backspace — xterm sends DEL, not BS
}

function labelFor(app: TerminalApp | undefined): string {
  const id = app?.connection.sessionId
  return id === undefined ? "Session" : id.slice(0, SESSION_ID_PREVIEW_LENGTH)
}

type SidebarHandle = ReturnType<typeof createSidebar>

function applyResponsiveLayout(
  shell: HTMLElement,
  shellBody: HTMLElement,
  toolbarEl: HTMLElement,
  sidebar: SidebarHandle,
  terminalApp: TerminalApp,
  terminalRegion: HTMLElement,
): void {
  const sync = (): void => {
    const mobile = isMobile()
    shellBody.dataset["docked"] = mobile ? "false" : "true"
    if (mobile && toolbarEl.parentElement === null) shell.appendChild(toolbarEl)
    if (!mobile && toolbarEl.parentElement !== null) toolbarEl.remove()
    if (!mobile && sidebar.isDrawerOpen()) sidebar.closeDrawer()
    sidebar.relayout()
  }
  sync()
  window.addEventListener("resize", sync)
  // Re-fit on every later box change (drawer, dock, keyboard, font metrics).
  new ResizeObserver(() => terminalApp.fit()).observe(terminalRegion)
  // The observer has no initial change to report: the region is sized in the
  // same layout pass it is attached in. Fit once after that pass commits, or the
  // canvas keeps the pre-layout box it was opened with.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => terminalApp.fit())
  })
  // Root viewport variables size both the shell and body-level overlays without
  // transforming an ancestor of the IME textarea/preedit coordinate chain.
  const viewport = window.visualViewport
  if (viewport !== null && viewport !== undefined) {
    const rideKeyboard = (): void => {
      const keyboardUp = viewport.height < window.innerHeight - 1
      if (keyboardUp) {
        document.documentElement.style.setProperty(
          "--visual-viewport-height",
          `${viewport.height}px`,
        )
        document.documentElement.style.setProperty(
          "--visual-viewport-offset-top",
          `${viewport.offsetTop}px`,
        )
        window.scrollTo(0, 0)
      } else {
        document.documentElement.style.removeProperty("--visual-viewport-height")
        document.documentElement.style.removeProperty("--visual-viewport-offset-top")
      }
      terminalApp.fit()
    }
    viewport.addEventListener("resize", rideKeyboard)
    viewport.addEventListener("scroll", rideKeyboard)
  }
}

async function boot(): Promise<void> {
  if (await checkAuthed()) {
    await renderApp()
  } else {
    renderLogin(app, () => void renderApp())
  }
}

void boot()
