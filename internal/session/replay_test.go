// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. The Go backend, protocol design
// and frontend architecture in this fork derive from that project; this file is
// new work. Full license text: LICENSE at the repo root.

package session

import (
	"bytes"
	"testing"
)

func TestReplayBufferOffsetsAndResume(t *testing.T) {
	b := NewReplayBuffer(10)
	b.Append([]byte("hello"))
	if got := b.EndOffset(); got != 5 {
		t.Fatalf("EndOffset = %d, want 5", got)
	}
	// Resume from offset 2 must return exactly the missed bytes.
	if got := string(b.SliceFrom(2)); got != "llo" {
		t.Fatalf("SliceFrom(2) = %q, want %q", got, "llo")
	}
	// An offset equal to EndOffset means "nothing missed".
	if got := b.SliceFrom(5); len(got) != 0 {
		t.Fatalf("SliceFrom(5) = %q, want empty", got)
	}
}

func TestReplayBufferEvictionKeepsCumulativeOffset(t *testing.T) {
	b := NewReplayBuffer(4)
	b.Append([]byte("abcdefgh")) // 8 bytes into a 4-byte ring
	if got := b.EndOffset(); got != 8 {
		t.Fatalf("EndOffset = %d, want 8 (offsets are cumulative, not retained length)", got)
	}
	if got := b.StartOffset(); got != 4 {
		t.Fatalf("StartOffset = %d, want 4", got)
	}
	// Evicted range must be reported as unresumable so the caller repaints instead.
	if got := b.SliceFrom(0); got != nil {
		t.Fatalf("SliceFrom(0) = %q, want nil for evicted offset", got)
	}
	if got := string(b.SliceFrom(4)); got != "efgh" {
		t.Fatalf("SliceFrom(4) = %q, want %q", got, "efgh")
	}
}

func TestReplayBufferChunkLargerThanCapacity(t *testing.T) {
	b := NewReplayBuffer(3)
	b.Append([]byte("abcdef"))
	// Only the trailing 3 bytes are retained, but the offset still counts all 6.
	if got := b.EndOffset(); got != 6 {
		t.Fatalf("EndOffset = %d, want 6", got)
	}
	if got := string(b.SliceFrom(3)); got != "def" {
		t.Fatalf("SliceFrom(3) = %q, want %q", got, "def")
	}
}

func TestReplayBufferTail(t *testing.T) {
	b := NewReplayBuffer(100)
	b.Append([]byte("0123456789"))
	offset, data := b.Tail(4)
	if offset != 6 || string(data) != "6789" {
		t.Fatalf("Tail(4) = (%d, %q), want (6, %q)", offset, data, "6789")
	}
	// A tail larger than the buffer returns everything retained.
	offset, data = b.Tail(50)
	if offset != 0 || string(data) != "0123456789" {
		t.Fatalf("Tail(50) = (%d, %q)", offset, data)
	}
}

func TestSnapTailToSafeBoundaryPrefersNewline(t *testing.T) {
	// The snap must cut after the last newline inside the budget window, so a
	// repaint never starts mid-escape-sequence.
	data := []byte("line one\r\x1b[31mline two\r\nPARTIAL")
	got, skipped := SnapTailToSafeBoundary(data, len(data))
	if string(got) != "PARTIAL" {
		t.Fatalf("snapped = %q, want %q", got, "PARTIAL")
	}
	if skipped != len(data)-len("PARTIAL") {
		t.Fatalf("skipped = %d, want %d", skipped, len(data)-len("PARTIAL"))
	}
}

func TestSnapTailToSafeBoundaryNoNewlineSkipsContinuationBytes(t *testing.T) {
	// No newline in range: replay from the start, but drop a leading UTF-8
	// continuation byte since it is provably mid-codepoint.
	cont := []byte{0x80, 0x80}
	data := append(cont, []byte("abc")...)
	got, skipped := SnapTailToSafeBoundary(data, len(data))
	if !bytes.Equal(got, []byte("abc")) {
		t.Fatalf("snapped = %q, want %q", got, "abc")
	}
	if skipped != 2 {
		t.Fatalf("skipped = %d, want 2", skipped)
	}
}

func TestSnapTailToSafeBoundaryEmpty(t *testing.T) {
	got, skipped := SnapTailToSafeBoundary(nil, 1024)
	if len(got) != 0 || skipped != 0 {
		t.Fatalf("empty snap = (%q, %d), want (empty, 0)", got, skipped)
	}
}
