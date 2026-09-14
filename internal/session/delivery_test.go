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

// TestDeliveryCoalescesContiguousChunks: chunks arriving while a write is in
// flight merge into one later write, at the first chunk's offset.
func TestDeliveryCoalescesContiguousChunks(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	var startOnce, doneOnce sync.Once

	var mu sync.Mutex
	var offsets []int64
	var batches [][]byte

	write := func(offset int64, payload []byte) error {
		startOnce.Do(func() { close(started) })
		<-release
		mu.Lock()
		offsets = append(offsets, offset)
		batches = append(batches, append([]byte(nil), payload...))
		if len(batches) == 2 {
			doneOnce.Do(func() { close(done) })
		}
		mu.Unlock()
		return nil
	}

	d := newOutputDelivery(write, 1<<20, func() {})
	go d.run()

	d.enqueue(0, []byte("abc"))
	<-started // the writer holds "abc" and is blocked inside write
	d.enqueue(3, []byte("de"))
	d.enqueue(5, []byte("f"))
	close(release)

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the coalesced write")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(batches) != 2 {
		t.Fatalf("writes = %d, want 2 (first chunk, then de+f coalesced)", len(batches))
	}
	if offsets[0] != 0 || string(batches[0]) != "abc" {
		t.Fatalf("write[0] = (%d, %q), want (0, %q)", offsets[0], batches[0], "abc")
	}
	if offsets[1] != 3 || string(batches[1]) != "def" {
		t.Fatalf("write[1] = (%d, %q), want (3, %q)", offsets[1], batches[1], "def")
	}
}

// TestDeliveryOverflowReportsError: past maxBytes the delivery reports instead of
// buffering without limit or blocking the enqueuer.
func TestDeliveryOverflowReportsError(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	errored := make(chan struct{})
	var startOnce, errOnce sync.Once

	write := func(offset int64, payload []byte) error {
		startOnce.Do(func() { close(started) })
		<-release
		return nil
	}
	d := newOutputDelivery(write, 8, func() { errOnce.Do(func() { close(errored) }) })
	go d.run()

	d.enqueue(0, make([]byte, 4))
	<-started
	d.enqueue(4, make([]byte, 8))  // pending = 8, at the bound but not over
	d.enqueue(12, make([]byte, 4)) // pending = 12 > 8 -> overflow
	close(release)

	select {
	case <-errored:
	case <-time.After(2 * time.Second):
		t.Fatal("overflow did not report an error")
	}
}

// TestDeliveryReportsWriteError: a write failure is surfaced so the caller can
// drop the connection.
func TestDeliveryReportsWriteError(t *testing.T) {
	errored := make(chan struct{})
	var once sync.Once
	d := newOutputDelivery(
		func(offset int64, payload []byte) error { return errors.New("write failed") },
		1<<20,
		func() { once.Do(func() { close(errored) }) },
	)
	go d.run()

	d.enqueue(0, []byte("x"))

	select {
	case <-errored:
	case <-time.After(2 * time.Second):
		t.Fatal("write error did not report an error")
	}
}

// TestDeliveryStopsAfterDetach: stop() halts delivery; a later enqueue is a no-op.
func TestDeliveryStopsAfterDetach(t *testing.T) {
	delivered := make(chan struct{}, 4)
	d := newOutputDelivery(
		func(offset int64, payload []byte) error { delivered <- struct{}{}; return nil },
		1<<20,
		func() {},
	)
	go d.run()

	d.enqueue(0, []byte("x"))
	select {
	case <-delivered:
	case <-time.After(2 * time.Second):
		t.Fatal("first chunk was not delivered")
	}
	d.stop()
	d.enqueue(1, []byte("y"))

	select {
	case <-delivered:
		t.Fatal("a stopped delivery still wrote a batch")
	case <-time.After(50 * time.Millisecond):
	}
}
