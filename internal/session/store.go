// Copyright (c) 2026 YeonGyu Kim
// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. This Go file is a
// reimplementation derived from the original TypeScript source; the original
// copyright notice is retained. Full license text: LICENSE at the repo root.

package session

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/4weaver/web-terminal-go/internal/pty"
)

const (
	// bufferCapacityBytes bounds retained output per session.
	bufferCapacityBytes = 4 * 1024 * 1024
	// ReconnectTailBytes is how much history a fresh attach replays (no resume offset).
	ReconnectTailBytes = 256 * 1024
)

// OutputListener receives output with the cumulative offset it starts at.
type OutputListener func(offset int64, payload []byte)

// ExitListener is called once when the process exits.
type ExitListener func(code int)

// Session is a PTY-backed terminal session that outlives any single WebSocket.
type Session struct {
	ID        string
	Title     string
	CreatedAt time.Time

	mu        sync.Mutex
	handle    *pty.Handle
	ptmx      *os.File
	cols      uint16
	rows      uint16
	alive     bool
	exitCode  int
	listeners map[*listener]struct{}
	// buffer is the replay ring driving disconnect survival.
	buffer *ReplayBuffer
}

type listener struct {
	onOutput OutputListener
	onExit   ExitListener
}

// newID returns a short random session id, matching the client's preview length.
func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// StartSession spawns the command and begins pumping its output into the buffer.
func (s *Store) StartSession(command []string, cols, rows uint16, title string) (*Session, error) {
	env := SessionEnv()
	handle, ptmx, err := pty.Start(pty.Options{
		Command: command,
		Cols:    cols,
		Rows:    rows,
		Env:     env,
	})
	if err != nil {
		return nil, err
	}
	sess := &Session{
		ID:        newID(),
		Title:     title,
		CreatedAt: time.Now(),
		handle:    handle,
		ptmx:      ptmx,
		cols:      cols,
		rows:      rows,
		alive:     true,
		listeners: map[*listener]struct{}{},
		buffer:    NewReplayBuffer(bufferCapacityBytes),
	}
	s.mu.Lock()
	s.sessions[sess.ID] = sess
	s.mu.Unlock()

	go sess.pump()
	return sess, nil
}

// pump reads PTY output forever, feeding the replay buffer and live listeners.
func (s *Session) pump() {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			offset := s.buffer.EndOffset()
			s.buffer.Append(chunk)
			s.fanout(offset, chunk)
		}
		if err != nil {
			break
		}
	}
	s.markExited(0)
}

// fanout delivers output to all attached listeners.
func (s *Session) fanout(offset int64, payload []byte) {
	s.mu.Lock()
	targets := make([]*listener, 0, len(s.listeners))
	for l := range s.listeners {
		targets = append(targets, l)
	}
	s.mu.Unlock()
	for _, l := range targets {
		l.onOutput(offset, payload)
	}
}

func (s *Session) markExited(code int) {
	s.mu.Lock()
	if !s.alive {
		s.mu.Unlock()
		return
	}
	s.alive = false
	s.exitCode = code
	targets := make([]*listener, 0, len(s.listeners))
	for l := range s.listeners {
		targets = append(targets, l)
	}
	s.mu.Unlock()

	_ = s.handle.Close()
	for _, l := range targets {
		l.onExit(code)
	}
}

// Attach registers listeners and returns a detach function.
func (s *Session) Attach(onOutput OutputListener, onExit ExitListener) func() {
	l := &listener{onOutput: onOutput, onExit: onExit}
	s.mu.Lock()
	s.listeners[l] = struct{}{}
	alive := s.alive
	code := s.exitCode
	s.mu.Unlock()

	if !alive {
		onExit(code)
	}
	return func() {
		s.mu.Lock()
		delete(s.listeners, l)
		s.mu.Unlock()
	}
}

// Write sends client input to the PTY.
func (s *Session) Write(data []byte) {
	s.mu.Lock()
	ptmx := s.ptmx
	alive := s.alive
	s.mu.Unlock()
	if !alive || ptmx == nil {
		return
	}
	_, _ = ptmx.Write(data)
}

// Resize updates the PTY window size.
func (s *Session) Resize(cols, rows uint16) {
	s.mu.Lock()
	s.cols, s.rows = cols, rows
	ptmx := s.ptmx
	s.mu.Unlock()
	if ptmx != nil {
		_ = pty.Resize(ptmx, cols, rows)
	}
}

// Buffer exposes the replay ring.
func (s *Session) Buffer() *ReplayBuffer { return s.buffer }

// Alive reports whether the process is still running.
func (s *Session) Alive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.alive
}

// Store holds live sessions and survives client disconnects.
type Store struct {
	mu       sync.Mutex
	sessions map[string]*Session
	// DefaultCommand is the session command when a client does not specify one.
	DefaultCommand []string
	// FilesRoot is the root exposed by the file API.
	FilesRoot string
}

// NewStore creates an empty session store.
func NewStore(defaultCommand []string, filesRoot string) *Store {
	return &Store{
		sessions:       map[string]*Session{},
		DefaultCommand: defaultCommand,
		FilesRoot:      filesRoot,
	}
}

// GetLive returns a live session by id.
func (s *Store) GetLive(id string) (*Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok || !sess.Alive() {
		return nil, false
	}
	return sess, true
}

// Reap removes sessions that have exited, keeping the picker honest.
func (s *Store) Reap() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, sess := range s.sessions {
		if !sess.Alive() {
			delete(s.sessions, id)
		}
	}
}

// List returns the live sessions.
func (s *Store) List() []*Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		out = append(out, sess)
	}
	return out
}

// SessionEnv builds the child environment. HERDR_* markers are stripped so a
// nested session does not inherit this server's own pane identity.
func SessionEnv() []string {
	env := make([]string, 0, len(os.Environ())+2)
	for _, kv := range os.Environ() {
		if len(kv) >= 5 && kv[:5] == "HERDR" {
			continue
		}
		env = append(env, kv)
	}
	env = append(env, "TERM=xterm-256color", "COLORTERM=truecolor")
	return env
}

// DefaultSessionCommand resolves the command a session should run.
//
// WT_SHELL forces a specific shell (this is also the herdr escape hatch); the
// upstream default of a herdr attach is deliberately NOT reproduced — herdr is
// not installed here and its absence used to crash the whole process.
//
// Candidates are resolved through PATH rather than hardcoded as /bin/*: on NixOS
// there is no /bin/bash, so an absolute-path list silently fails to find any
// shell and session creation dies at fork/exec.
func DefaultSessionCommand() []string {
	if sh := os.Getenv("WT_SHELL"); sh != "" {
		return []string{sh, "-l"}
	}
	if sh := os.Getenv("SHELL"); sh != "" {
		if p, err := exec.LookPath(sh); err == nil {
			return []string{p, "-l"}
		}
		return []string{sh, "-l"}
	}
	for _, candidate := range []string{"zsh", "bash", "sh"} {
		if p, err := exec.LookPath(candidate); err == nil {
			return []string{p, "-l"}
		}
	}
	return []string{"/bin/sh", "-l"}
}
