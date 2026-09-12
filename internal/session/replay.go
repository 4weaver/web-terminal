// Copyright (c) 2026 YeonGyu Kim
// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. This Go file is a
// reimplementation derived from the original TypeScript source; the original
// copyright notice is retained. Full license text: LICENSE at the repo root.

package session

import "sync"

// ReplayBuffer is a bounded ring of trailing output bytes with cumulative offsets.
// It is the mechanism behind disconnect survival: a reconnecting client sends its
// last offset and gets back exactly the bytes it missed.
//
// endOffset only ever grows. The buffer retains at most capacity trailing bytes.
type ReplayBuffer struct {
	mu       sync.Mutex
	capacity int
	chunks   [][]byte
	stored   int
	end      int64
}

// NewReplayBuffer creates a buffer retaining at most capacity bytes.
func NewReplayBuffer(capacity int) *ReplayBuffer {
	if capacity <= 0 {
		panic("replay buffer capacity must be positive")
	}
	return &ReplayBuffer{capacity: capacity}
}

// StartOffset is the oldest offset still retained.
func (b *ReplayBuffer) StartOffset() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.end - int64(b.stored)
}

// EndOffset is the cumulative number of bytes ever appended.
func (b *ReplayBuffer) EndOffset() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.end
}

// Append adds a chunk, evicting the oldest retained bytes beyond capacity.
func (b *ReplayBuffer) Append(chunk []byte) {
	if len(chunk) == 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	kept := chunk
	if len(chunk) > b.capacity {
		kept = chunk[len(chunk)-b.capacity:]
	}
	// Copy: callers reuse their read buffers.
	cp := make([]byte, len(kept))
	copy(cp, kept)
	b.chunks = append(b.chunks, cp)
	b.stored += len(cp)
	// xterm counts the full chunk toward the stream offset even when truncated.
	b.end += int64(len(chunk))
	b.evictLocked()
}

// SliceFrom returns bytes from offset to end, or nil when offset is out of range.
func (b *ReplayBuffer) SliceFrom(offset int64) []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.sliceFromLocked(offset)
}

func (b *ReplayBuffer) sliceFromLocked(offset int64) []byte {
	start := b.end - int64(b.stored)
	if offset < start || offset > b.end {
		return nil
	}
	result := make([]byte, b.end-offset)
	var written int
	position := start
	for _, chunk := range b.chunks {
		chunkEnd := position + int64(len(chunk))
		if chunkEnd > offset {
			from := int64(0)
			if offset > position {
				from = offset - position
			}
			written += copy(result[written:], chunk[from:])
		}
		position = chunkEnd
	}
	return result
}

// Tail returns at most maxBytes of trailing output and the offset it starts at.
func (b *ReplayBuffer) Tail(maxBytes int) (int64, []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	offset := b.end - int64(maxBytes)
	if start := b.end - int64(b.stored); offset < start {
		offset = start
	}
	data := b.sliceFromLocked(offset)
	if data == nil {
		data = []byte{}
	}
	return offset, data
}

func (b *ReplayBuffer) evictLocked() {
	for len(b.chunks) > 0 && b.stored > b.capacity {
		excess := b.stored - b.capacity
		head := b.chunks[0]
		if len(head) <= excess {
			b.chunks = b.chunks[1:]
			b.stored -= len(head)
			continue
		}
		b.chunks[0] = head[excess:]
		b.stored -= excess
	}
}

// SnapTailToSafeBoundary trims a replay tail to a boundary safe to repaint from.
//
// Only boundaries the byte stream actually proves are used: the most recent
// newline within the budget window (a newline cannot occur inside an escape
// sequence or a multi-byte codepoint), else the buffer start. A mid-stream cut is
// never guessed — without the emitter's parser state a raw byte run is ambiguous
// ("123a" is valid text and a valid CSI body).
func SnapTailToSafeBoundary(data []byte, maxBytes int) (trimmed []byte, skipped int) {
	if len(data) == 0 {
		return data, 0
	}
	budgetStart := len(data) - maxBytes
	if budgetStart < 0 {
		budgetStart = 0
	}
	for i := len(data) - 1; i >= budgetStart; i-- {
		if data[i] == '\n' {
			return data[i+1:], i + 1
		}
	}
	// No newline in the window: replay from the buffer start, skipping only
	// leading UTF-8 continuation bytes (unambiguously mid-codepoint).
	start := 0
	for start < len(data) && data[start]&0xc0 == 0x80 {
		start++
	}
	return data[start:], start
}
