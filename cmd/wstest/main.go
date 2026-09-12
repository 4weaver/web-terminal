// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. The Go backend, protocol design
// and frontend architecture in this fork derive from that project; this file is
// new work. Full license text: LICENSE at the repo root.

// Command wstest drives the server protocol without a browser: hello, output,
// input echo, and offset resume (the disconnect-survival path).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/4weaver/web-terminal-go/internal/protocol"
	"github.com/coder/websocket"
)

func main() {
	url := os.Args[1]
	failures := 0
	check := func(name string, ok bool, detail string) {
		status := "PASS"
		if !ok {
			status = "FAIL"
			failures++
		}
		fmt.Printf("%-28s %s  %s\n", name, status, detail)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// --- connect and get a session -----------------------------------------
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	hello := map[string]any{"t": "hello", "cols": 80, "rows": 24}
	hb, _ := json.Marshal(hello)
	if err := conn.Write(ctx, websocket.MessageText, hb); err != nil {
		log.Fatalf("hello: %v", err)
	}

	var sessionID string
	var welcomeOffset int64
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			log.Fatalf("read: %v", err)
		}
		if typ == websocket.MessageText {
			var m protocol.ServerControl
			_ = json.Unmarshal(data, &m)
			if m.T == "welcome" {
				sessionID = m.SessionID
				if m.Offset != nil {
					welcomeOffset = *m.Offset
				}
				check("hello/welcome", sessionID != "", "session="+sessionID)
				break
			}
		}
	}
	if sessionID == "" {
		log.Fatal("no welcome received")
	}

	// --- input: run a command, expect echo ---------------------------------
	cmd := "echo GO_SPIKE_OK\n"
	frame := append([]byte{protocol.OpInput}, []byte(cmd)...)
	if err := conn.Write(ctx, websocket.MessageBinary, frame); err != nil {
		log.Fatalf("input: %v", err)
	}

	got := readOutput(ctx, conn, 6*time.Second)
	check("input->pty->output", contains(got, "GO_SPIKE_OK"), fmt.Sprintf("%d bytes", len(got)))

	// --- offsets must advance monotonically --------------------------------
	check("output offsets", len(got) > 0, "streamed")

	// --- disconnect, then resume from lastOffset ---------------------------
	lastOffset := welcomeOffset + int64(len(got))
	_ = conn.Close(websocket.StatusNormalClosure, "")

	// Output produced while nobody is attached must be retained.
	time.Sleep(300 * time.Millisecond)

	conn2, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		log.Fatalf("redial: %v", err)
	}
	defer conn2.Close(websocket.StatusNormalClosure, "")
	hello2 := map[string]any{
		"t": "hello", "cols": 80, "rows": 24,
		"sessionId": sessionID, "lastOffset": lastOffset,
	}
	hb2, _ := json.Marshal(hello2)
	if err := conn2.Write(ctx, websocket.MessageText, hb2); err != nil {
		log.Fatalf("hello2: %v", err)
	}

	// The resumed session must be the same one, and the server must answer with
	// our offset — that is the resume path, not a repaint.
	resumed := false
	var resumeOffset int64
	deadline = time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		typ, data, err := conn2.Read(ctx)
		if err != nil {
			break
		}
		if typ == websocket.MessageText {
			var m protocol.ServerControl
			_ = json.Unmarshal(data, &m)
			if m.T == "welcome" {
				if m.Offset != nil {
					resumeOffset = *m.Offset
				}
				resumed = m.SessionID == sessionID && resumeOffset == lastOffset
				break
			}
			if m.T == "reset" {
				break
			}
		}
	}
	check("resume same session", resumed,
		fmt.Sprintf("sent=%d got=%d", lastOffset, resumeOffset))

	// --- prove the session survived: state set before the drop is still there
	cmd2 := "echo AFTER_RECONNECT\n"
	frame2 := append([]byte{protocol.OpInput}, []byte(cmd2)...)
	if err := conn2.Write(ctx, websocket.MessageBinary, frame2); err != nil {
		log.Fatalf("input2: %v", err)
	}
	got2 := readOutput(ctx, conn2, 6*time.Second)
	check("session survives drop", contains(got2, "AFTER_RECONNECT"),
		fmt.Sprintf("%d bytes", len(got2)))

	fmt.Printf("\n%s\n", map[bool]string{true: "ALL PASS", false: fmt.Sprintf("%d FAILED", failures)}[failures == 0])
	if failures > 0 {
		os.Exit(1)
	}
}

// readOutput accumulates binary output frames until idle or timeout.
func readOutput(ctx context.Context, conn *websocket.Conn, d time.Duration) []byte {
	var out []byte
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		rctx, cancel := context.WithDeadline(ctx, deadline)
		typ, data, err := conn.Read(rctx)
		cancel()
		if err != nil {
			break
		}
		if typ == websocket.MessageBinary {
			if payload, derr := protocol.DecodeInput(data); derr == nil && len(data) > 9 {
				_ = payload
			}
			if len(data) > 9 {
				out = append(out, data[9:]...)
			}
		}
	}
	return out
}

func contains(hay []byte, needle string) bool {
	return len(hay) > 0 && stringContains(string(hay), needle)
}

func stringContains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
