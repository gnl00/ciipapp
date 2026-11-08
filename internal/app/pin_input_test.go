package app

import (
	"math"
	"testing"
)

func pinInputFixture(resize func(float64)) (*pinMagnifyQueue, func()) {
	queue := newPinMagnifyQueue(resize)
	var frame func()
	queue.schedule = func(fn func()) func() {
		frame = fn
		return func() { frame = nil }
	}
	return queue, func() {
		if frame != nil {
			fn := frame
			frame = nil
			fn()
		}
	}
}

func TestPinMagnifyWithoutDOMEventsCoalescesNativeDeltas(t *testing.T) {
	var calls []float64
	queue, frame := pinInputFixture(func(factor float64) { calls = append(calls, factor) })
	queue.enqueue(.1)
	queue.enqueue(.2)
	if len(calls) != 0 {
		t.Fatal("AppKit callback synchronously resized the window")
	}
	frame()
	if len(calls) != 1 || math.Abs(calls[0]-1.32) > 1e-12 {
		t.Fatalf("native-only deltas were not coalesced: %v", calls)
	}
}

func TestPinMagnifyBackpressureAndIndependentPins(t *testing.T) {
	var calls []float64
	var queue *pinMagnifyQueue
	queue, frame := pinInputFixture(func(factor float64) {
		calls = append(calls, factor)
		if len(calls) == 1 {
			// Input can arrive while ResizePin is waiting for the UI thread.
			for range 100 {
				queue.enqueue(.01)
			}
		}
	})
	var otherCalls []float64
	other, otherFrame := pinInputFixture(func(factor float64) { otherCalls = append(otherCalls, factor) })
	queue.enqueue(.1)
	other.enqueue(-.2)
	frame()
	if len(calls) != 1 || len(otherCalls) != 0 {
		t.Fatalf("pins shared a drain or queued overlapping resizes: %v %v", calls, otherCalls)
	}
	frame()
	otherFrame()
	if len(calls) != 2 || math.Abs(calls[1]-2) > 1e-12 || len(otherCalls) != 1 || math.Abs(otherCalls[0]-.8) > 1e-12 {
		t.Fatalf("backpressure or per-pin isolation failed: %v %v", calls, otherCalls)
	}
}

func TestPinMagnifyRejectsInvalidInputAndDropsClosedWork(t *testing.T) {
	var calls []float64
	queue, frame := pinInputFixture(func(factor float64) { calls = append(calls, factor) })
	for _, delta := range []float64{math.NaN(), math.Inf(1), -1, -2, 0} {
		queue.enqueue(delta)
	}
	frame()
	if len(calls) != 0 {
		t.Fatalf("invalid magnification resized a pin: %v", calls)
	}
	queue.enqueue(.1)
	queue.close()
	queue.enqueue(.2)
	frame()
	queue.flush() // A timer already dispatched when ClosePin ran is harmless.
	if len(calls) != 0 {
		t.Fatalf("closed pin still resized: %v", calls)
	}
}
