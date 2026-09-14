// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. The Go backend, protocol design
// and frontend architecture in this fork derive from that project; this file is
// new work. Full license text: LICENSE at the repo root.

package session

import (
	"errors"
	"sync"
	"testing"
	"time"
)

// newTestSession builds a Session with no PTY, so fanout can be driven directly.
func newTestSession() *Session {
	return &Session{
		alive:     true,
		listeners: map[*listener]struct{}{},
		buffer:    NewReplayBuffer(1024),
	}
}

// collector accumulates a listener's delivered bytes.
type collector struct {
	mu     sync.Mutex
	offset int64
	data   []byte
}

func (c *collector) write(offset int64, payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.data) == 0 {
		c.offset = offset
	}
	c.data = append(c.data, payload...)
	return nil
}

func (c *collector) snapshot() (int64, []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.offset, append([]byte(nil), c.data...)
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// TestFanoutStartsListenerAtFirstChunkOffset: coalesced delivery still reports
// the offset of its first byte.
func TestFanoutStartsListenerAtFirstChunkOffset(t *testing.T) {
	s := newTestSession()
	c := &collector{}
	detach := s.Attach(AttachOptions{OnOutput: c.write})
	defer detach()

	s.fanout(100, []byte("hello "))
	s.fanout(106, []byte("world"))

	waitFor(t, "all bytes", func() bool { _, d := c.snapshot(); return len(d) == 11 })
	offset, data := c.snapshot()
	if offset != 100 || string(data) != "hello world" {
		t.Fatalf("delivered (%d, %q), want (100, %q)", offset, data, "hello world")
	}
}

// TestFanoutDoesNotBlockOnSlowListener is the regression test for the reported
// bug: a client that stops draining must not stall the pump or a sibling.
func TestFanoutDoesNotBlockOnSlowListener(t *testing.T) {
	s := newTestSession()

	release := make(chan struct{})
	defer close(release)
	slow := s.Attach(AttachOptions{
		OnOutput: func(offset int64, payload []byte) error {
			<-release
			return nil
		},
	})
	defer slow()

	fast := &collector{}
	fastDetach := s.Attach(AttachOptions{OnOutput: fast.write})
	defer fastDetach()

	const n = 200
	done := make(chan struct{})
	go func() {
		for i := 0; i < n; i++ {
			s.fanout(int64(i), []byte{byte(i)})
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("fanout blocked on a slow listener")
	}

	waitFor(t, "healthy listener to receive every byte", func() bool {
		_, d := fast.snapshot()
		return len(d) == n
	})
	offset, data := fast.snapshot()
	if offset != 0 {
		t.Fatalf("fast listener offset = %d, want 0", offset)
	}
	for i, b := range data {
		if b != byte(i) {
			t.Fatalf("fast listener byte %d = %d, want %d", i, b, byte(i))
		}
	}
}

// TestSlowListenerOverflowDetachesAndReports: past the queue bound the listener
// is reported and detached, not buffered without limit.
func TestSlowListenerOverflowDetachesAndReports(t *testing.T) {
	s := newTestSession()

	started := make(chan struct{})
	release := make(chan struct{})
	errored := make(chan struct{})
	var startOnce, errOnce sync.Once

	slow := s.Attach(AttachOptions{
		OnOutput: func(offset int64, payload []byte) error {
			startOnce.Do(func() { close(started) })
			<-release
			return nil
		},
		OnError: func() { errOnce.Do(func() { close(errored) }) },
	})
	defer slow()

	// The writer holds the first chunk while blocked; the rest accumulate past
	// the bound.
	const chunk = 1 << 20
	s.fanout(0, make([]byte, chunk))
	<-started
	offset := int64(chunk)
	for sent := 0; sent <= defaultOutputQueueBytes/chunk; sent++ {
		s.fanout(offset, make([]byte, chunk))
		offset += chunk
	}
	close(release)

	select {
	case <-errored:
	case <-time.After(2 * time.Second):
		t.Fatal("overflow did not report an error")
	}

	// The listener is detached: further fanout must be a harmless no-op that
	// neither blocks nor reaches the (now stopped) delivery.
	s.fanout(offset, make([]byte, 4))
}

// TestWriteErrorReportsAndStops: a socket write error stops delivery and reports.
func TestWriteErrorReportsAndStops(t *testing.T) {
	s := newTestSession()
	errored := make(chan struct{})
	var once sync.Once

	s.Attach(AttachOptions{
		OnOutput: func(offset int64, payload []byte) error { return errors.New("write failed") },
		OnError:  func() { once.Do(func() { close(errored) }) },
	})

	s.fanout(0, []byte("x"))

	select {
	case <-errored:
	case <-time.After(2 * time.Second):
		t.Fatal("write error did not report an error")
	}
}

// TestDetachStopsDelivery: a detached listener receives nothing more.
func TestDetachStopsDelivery(t *testing.T) {
	s := newTestSession()
	c := &collector{}
	detach := s.Attach(AttachOptions{OnOutput: c.write})

	s.fanout(0, []byte("a"))
	waitFor(t, "first byte", func() bool { _, d := c.snapshot(); return len(d) == 1 })

	detach()
	s.fanout(1, []byte("b"))

	time.Sleep(50 * time.Millisecond)
	if _, d := c.snapshot(); string(d) != "a" {
		t.Fatalf("delivered %q after detach, want %q", d, "a")
	}
}

// idleSession builds a session with no PTY, for reaping logic.
func idleSession(id string, idleSince time.Time) *Session {
	return &Session{
		ID:        id,
		alive:     true,
		listeners: map[*listener]struct{}{},
		buffer:    NewReplayBuffer(1024),
		idleSince: idleSince,
	}
}

// TestDetachMarksSessionIdle: the idle clock starts when the last client leaves.
func TestDetachMarksSessionIdle(t *testing.T) {
	s := newTestSession()
	detach := s.Attach(AttachOptions{OnOutput: func(int64, []byte) error { return nil }})
	if s.OrphanedFor(time.Hour) {
		t.Fatal("attached session reported orphaned")
	}
	detach()
	if !s.OrphanedFor(0) {
		t.Fatal("detached session not reported orphaned")
	}
}

// TestReapKillsOnlyOrphanedSessions: exited and long-idle sessions go; attached
// and freshly-idled ones stay.
func TestReapKillsOnlyOrphanedSessions(t *testing.T) {
	st := NewStore(nil, "")
	st.IdleGrace = time.Minute
	now := time.Now()
	st.sessions["old"] = idleSession("old", now.Add(-2*time.Minute))
	st.sessions["fresh"] = idleSession("fresh", now)
	st.sessions["attached"] = idleSession("attached", time.Time{})
	exited := idleSession("exited", now.Add(-2*time.Minute))
	exited.alive = false
	st.sessions["exited"] = exited

	st.Reap()

	for _, id := range []string{"old", "exited"} {
		if _, ok := st.sessions[id]; ok {
			t.Errorf("%q was not reaped", id)
		}
	}
	for _, id := range []string{"fresh", "attached"} {
		if _, ok := st.sessions[id]; !ok {
			t.Errorf("%q was reaped but should not have been", id)
		}
	}
}

// TestReapKeepsOrphansWhenDisabled: IdleGrace 0 leaves orphans alone.
func TestReapKeepsOrphansWhenDisabled(t *testing.T) {
	st := NewStore(nil, "")
	st.sessions["old"] = idleSession("old", time.Now().Add(-time.Hour))
	st.Reap()
	if _, ok := st.sessions["old"]; !ok {
		t.Fatal("session reaped with IdleGrace disabled")
	}
}
