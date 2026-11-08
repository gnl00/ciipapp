package app

import (
	"math"
	"sync"
	"time"
)

// Native magnify callbacks run on AppKit's main thread. Never resize there:
// another ResizePin may hold resizeMu while waiting for that same main thread.
type pinMagnifyQueue struct {
	mu       sync.Mutex
	pending  float64
	busy     bool
	closed   bool
	cancel   func()
	schedule func(func()) func()
	resize   func(float64)
}

func newPinMagnifyQueue(resize func(float64)) *pinMagnifyQueue {
	return &pinMagnifyQueue{resize: resize, schedule: func(fn func()) func() {
		timer := time.AfterFunc(time.Second/60, fn)
		return func() { timer.Stop() }
	}}
}

func (q *pinMagnifyQueue) enqueue(magnification float64) {
	if math.IsNaN(magnification) || math.IsInf(magnification, 0) || magnification <= -1 {
		return
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if !q.closed {
		q.pending = math.Max(-math.Ln2, math.Min(math.Ln2, q.pending+math.Log1p(magnification)))
		q.scheduleLocked()
	}
}

func (q *pinMagnifyQueue) scheduleLocked() {
	if !q.closed && !q.busy && q.cancel == nil && math.Abs(q.pending) > 1e-8 {
		q.cancel = q.schedule(q.flush)
	}
}

func (q *pinMagnifyQueue) flush() {
	q.mu.Lock()
	q.cancel = nil
	if q.closed {
		q.mu.Unlock()
		return
	}
	delta := q.pending
	q.pending = 0
	if math.Abs(delta) <= 1e-8 {
		q.mu.Unlock()
		return
	}
	q.busy = true
	q.mu.Unlock()
	q.resize(math.Exp(delta))
	q.mu.Lock()
	q.busy = false
	q.scheduleLocked()
	q.mu.Unlock()
}

func (q *pinMagnifyQueue) close() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.closed = true
	q.pending = 0
	if q.cancel != nil {
		q.cancel()
		q.cancel = nil
	}
}
