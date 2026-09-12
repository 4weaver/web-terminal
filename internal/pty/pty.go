// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. The Go backend, protocol design
// and frontend architecture in this fork derive from that project; this file is
// new work. Full license text: LICENSE at the repo root.

// Package pty spawns a command attached to a pseudo-terminal.
// This replaces web-terminal's Bun.spawn(..., {terminal: {...}}): with creack/pty
// the allocation is explicit and platform-independent, and there is no canary
// requirement — any Linux/BSD/macOS host works.
package pty

import (
	"errors"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

// Options describes the command to run and the initial window size.
type Options struct {
	Command []string
	Cols    uint16
	Rows    uint16
	Cwd     string
	Env     []string
}

// Handle is a running PTY-backed process.
type Handle struct {
	PID    int
	closeF func() error
	killF  func() error

	mu     sync.Mutex
	closed bool
}

// Start spawns the command with a PTY as its stdin/stdout/stderr.
func Start(opts Options) (*Handle, *os.File, error) {
	if len(opts.Command) == 0 {
		return nil, nil, errors.New("pty: empty command")
	}
	cmd := exec.Command(opts.Command[0], opts.Command[1:]...)
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	if opts.Env != nil {
		cmd.Env = opts.Env
	}
	sz := &pty.Winsize{Cols: opts.Cols, Rows: opts.Rows}
	f, err := pty.StartWithSize(cmd, sz)
	if err != nil {
		return nil, nil, err
	}
	h := &Handle{PID: cmd.Process.Pid, closeF: f.Close, killF: cmd.Process.Kill}
	go func() { _ = cmd.Wait() }()
	return h, f, nil
}

// Resize changes the terminal window size.
func Resize(f *os.File, cols, rows uint16) error {
	return pty.Setsize(f, &pty.Winsize{Cols: cols, Rows: rows})
}

// Close releases the PTY file descriptor.
func (h *Handle) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	return h.closeF()
}

// Kill terminates the process.
func (h *Handle) Kill() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	_ = h.closeF()
	return h.killF()
}
