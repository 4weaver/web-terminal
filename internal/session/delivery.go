// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. The Go backend, protocol design
// and frontend architecture in this fork derive from that project; this file is
// new work. Full license text: LICENSE at the repo root.

package session

import "sync"

// deliveryState tracks where a delivery is in its lifecycle.
type deliveryState int

const (
	deliveryRunning deliveryState = iota
	deliveryStopped
	deliveryOverflowed
)

// outputDelivery is a per-listener bounded, coalescing output buffer.
//
// enqueue never touches the socket, so a slow client cannot stall the pump. A
// dedicated goroutine drains it, merging chunks that arrive while a write is in
// flight so a burst of PTY reads becomes a few large frames.
//
// Bytes are never dropped mid-stream: the client discards any frame starting
// past its offset, so a gap would wedge a healthy connection. Past maxBytes the
// delivery stops and reports an error instead, letting the caller drop the
// connection for the client to resume into the replay buffer.
type outputDelivery struct {
	write    func(offset int64, payload []byte) error
	onError  func()
	maxBytes int

	mu          sync.Mutex
	cond        *sync.Cond
	pending     []byte
	startOffset int64
	state       deliveryState
}

func newOutputDelivery(write func(int64, []byte) error, maxBytes int, onError func()) *outputDelivery {
	d := &outputDelivery{write: write, onError: onError, maxBytes: maxBytes}
	d.cond = sync.NewCond(&d.mu)
	return d
}

// enqueue buffers a chunk, merging it with any not yet written. Never blocks.
func (d *outputDelivery) enqueue(offset int64, payload []byte) {
	if len(payload) == 0 {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.state != deliveryRunning {
		return
	}
	if len(d.pending) == 0 {
		d.startOffset = offset
	}
	d.pending = append(d.pending, payload...)
	if len(d.pending) > d.maxBytes {
		d.state = deliveryOverflowed
	}
	d.cond.Signal()
}

// stop halts delivery and discards anything still buffered.
func (d *outputDelivery) stop() {
	d.mu.Lock()
	d.state = deliveryStopped
	d.pending = nil
	d.mu.Unlock()
	d.cond.Signal()
}

// run drains the buffer until the delivery is stopped or fails.
func (d *outputDelivery) run() {
	for {
		batch, offset, state := d.drain()
		switch state {
		case deliveryStopped:
			return
		case deliveryOverflowed:
			d.fail()
			return
		}
		if err := d.write(offset, batch); err != nil {
			d.fail()
			return
		}
	}
}

// drain blocks until a batch is ready or the delivery leaves the running state.
func (d *outputDelivery) drain() ([]byte, int64, deliveryState) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for {
		if d.state != deliveryRunning {
			return nil, 0, d.state
		}
		if len(d.pending) > 0 {
			batch, offset := d.pending, d.startOffset
			d.pending, d.startOffset = nil, 0
			return batch, offset, deliveryRunning
		}
		d.cond.Wait()
	}
}

// fail marks the delivery dead and reports it once, off the pump goroutine.
func (d *outputDelivery) fail() {
	d.mu.Lock()
	d.state = deliveryStopped
	d.pending = nil
	d.mu.Unlock()
	if d.onError != nil {
		d.onError()
	}
}
