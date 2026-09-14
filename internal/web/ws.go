// Copyright (c) 2026 YeonGyu Kim
// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. This Go file is a
// reimplementation derived from the original TypeScript source; the original
// copyright notice is retained. Full license text: LICENSE at the repo root.

package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/4weaver/web-terminal-go/internal/protocol"
	"github.com/4weaver/web-terminal-go/internal/session"
	"github.com/coder/websocket"
)

// reconnectSnapWindowBytes bounds how far back the safe-boundary search begins.
const reconnectSnapWindowBytes = 8 * 1024

// wsConn serializes writes; coder/websocket allows only one concurrent writer.
type wsConn struct {
	ws *websocket.Conn
	mu sync.Mutex
}

func (c *wsConn) writeJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return c.ws.Write(ctx, websocket.MessageText, data)
}

func (c *wsConn) writeBinary(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return c.ws.Write(ctx, websocket.MessageBinary, data)
}

func (c *wsConn) sendControl(m protocol.ServerControl) {
	if err := c.writeJSON(m); err != nil {
		log.Printf("ws: control write: %v", err)
	}
}

// ServeWS runs one WebSocket connection until it closes.
func ServeWS(ctx context.Context, conn *websocket.Conn, store *session.Store) {
	conn.SetReadLimit(1 << 20)
	c := &wsConn{ws: conn}
	defer conn.Close(websocket.StatusNormalClosure, "")

	var (
		detach    func()
		curSess   *session.Session
		sessMu    sync.Mutex
		closeOnce sync.Once
	)
	cleanup := func() {
		closeOnce.Do(func() {
			sessMu.Lock()
			defer sessMu.Unlock()
			if detach != nil {
				detach()
				detach = nil
			}
			curSess = nil
		})
	}
	defer cleanup()

	attach := func(sess *session.Session) {
		sessMu.Lock()
		old := detach
		curSess = sess
		sessMu.Unlock()
		if old != nil {
			old()
		}
		d := sess.Attach(session.AttachOptions{
			OnOutput: func(offset int64, payload []byte) error {
				return c.writeBinary(protocol.EncodeOutput(offset, payload))
			},
			OnExit: func(code int) {
				c.sendControl(protocol.ServerControl{T: "exit", Code: &code})
			},
			OnError: func() {
				// Delivery stopped — a write failed or the client fell too far
				// behind. Drop the connection so it reconnects and resumes.
				cleanup()
				_ = conn.Close(websocket.StatusTryAgainLater, "output backpressure")
			},
		})
		sessMu.Lock()
		// Attach may race with a concurrent detach; prefer the newer detach.
		if curSess == sess {
			detach = d
		} else {
			d()
		}
		sessMu.Unlock()
	}

	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		switch typ {
		case websocket.MessageText:
			control, perr := protocol.ParseClientControl(data)
			if perr != nil {
				c.sendControl(protocol.ServerControl{T: "error", Message: perr.Error()})
				conn.Close(websocket.StatusPolicyViolation, "protocol error")
				return
			}
			switch control.T {
			case "hello":
				handleHello(c, store, control, attach)
			case "resize":
				sessMu.Lock()
				s := curSess
				sessMu.Unlock()
				if s != nil {
					s.Resize(uint16(control.Cols), uint16(control.Rows))
				}
			case "ping":
				c.sendControl(protocol.ServerControl{T: "pong"})
			}
		case websocket.MessageBinary:
			payload, perr := protocol.DecodeInput(data)
			if perr != nil {
				c.sendControl(protocol.ServerControl{T: "error", Message: perr.Error()})
				conn.Close(websocket.StatusPolicyViolation, "protocol error")
				return
			}
			sessMu.Lock()
			s := curSess
			sessMu.Unlock()
			if s != nil {
				s.Write(payload)
			}
		}
	}
}

// handleHello attaches to an existing session or creates one, then replays.
func handleHello(
	c *wsConn,
	store *session.Store,
	hello protocol.ClientControl,
	attach func(*session.Session),
) {
	store.Reap()

	var existing *session.Session
	if hello.SessionID != "" {
		if s, ok := store.GetLive(hello.SessionID); ok {
			existing = s
		}
	}

	sess := existing
	if sess == nil {
		cmd := store.DefaultCommand
		if len(cmd) == 0 {
			cmd = session.DefaultSessionCommand()
		}
		created, err := store.StartSession(cmd, uint16(hello.Cols), uint16(hello.Rows), cmd[0])
		if err != nil {
			log.Printf("ws: start session: %v", err)
			msg := fmt.Sprintf("failed to start session: %v", err)
			c.sendControl(protocol.ServerControl{T: "error", Message: msg})
			return
		}
		sess = created
	}

	attach(sess)
	sess.Resize(uint16(hello.Cols), uint16(hello.Rows))

	// Resume path: the client tells us how far it got, so it receives only the
	// bytes it missed. This is what makes a reconnect seamless.
	if existing != nil && hello.LastOffset != nil {
		offset := *hello.LastOffset
		if resume := sess.Buffer().SliceFrom(offset); resume != nil {
			c.sendControl(protocol.ServerControl{T: "welcome", SessionID: sess.ID, Offset: &offset})
			if len(resume) > 0 {
				_ = c.writeBinary(protocol.EncodeOutput(offset, resume))
			}
			return
		}
	}

	// Fresh attach (or resume offset out of retained range): replay a bounded tail,
	// snapped to a boundary that is safe to repaint from.
	offset, raw := sess.Buffer().Tail(session.ReconnectTailBytes)
	snapped, skipped := session.SnapTailToSafeBoundary(raw, reconnectSnapWindowBytes)
	tailOffset := offset + int64(skipped)
	c.sendControl(protocol.ServerControl{T: "welcome", SessionID: sess.ID, Offset: &tailOffset})
	c.sendControl(protocol.ServerControl{T: "reset", Offset: &tailOffset})
	if len(snapped) > 0 {
		_ = c.writeBinary(protocol.EncodeOutput(tailOffset, snapped))
	}
}

// ErrNoSession is returned when a session id is unknown.
var ErrNoSession = errors.New("no such session")
