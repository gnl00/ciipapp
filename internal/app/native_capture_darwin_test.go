//go:build darwin && cgo

package app

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"testing"
	"unsafe"
)

func TestNativeCaptureCancellationAndLateResult(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan nativeCaptureResult, 1)
	const token = 9001
	nativeCaptureCallbacks.Store(uintptr(token), result)
	done := make(chan error, 1)
	go func() { _, _, err := awaitNativeCapture(ctx, token, result); done <- err }()
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled capture: %v", err)
	}
	if _, exists := nativeCaptureCallbacks.Load(uintptr(token)); exists {
		t.Fatal("cancelled capture retained its callback")
	}
	ciip_go_capture_png(token, nil, 0, nil, 0)
	if len(result) != 0 {
		t.Fatal("a late native callback reached the cancelled waiter")
	}
	if _, _, err := captureNativeSelection(ctx, nil, "element"); !errors.Is(err, context.Canceled) {
		t.Fatalf("a pre-cancelled context entered AppKit: %v", err)
	}
}

func TestNativeCaptureCopiesAndBoundsPNG(t *testing.T) {
	const token = 9002
	result := make(chan nativeCaptureResult, 1)
	nativeCaptureCallbacks.Store(uintptr(token), result)
	defer nativeCaptureCallbacks.Delete(uintptr(token))
	bytes := []byte{1, 2, 3}
	ciip_go_capture_png(token, unsafe.Pointer(&bytes[0]), 3, nil, 0)
	bytes[0] = 9
	if got := <-result; got.err != nil || len(got.data) != 3 || got.data[0] != 1 {
		t.Fatalf("native result must own its PNG bytes: %+v", got)
	}
	ciip_go_capture_png(token, nil, maxImageBytes+1, nil, 0)
	if got := <-result; got.err == nil || got.data != nil {
		t.Fatalf("oversized native image was accepted: %+v", got)
	}
	ciip_go_capture_png(token, nil, 0, nil, 0)
	if got := <-result; got.err == nil {
		t.Fatal("empty native success silently passed")
	}
}

func TestNativeCaptureFallbackAndErrorsStayDistinct(t *testing.T) {
	for _, tc := range []struct {
		name      string
		value     nativeCaptureResult
		supported bool
	}{
		{"legacy", nativeCaptureResult{unsupported: true}, false},
		{"image", nativeCaptureResult{data: []byte{1}}, true},
		{"failure", nativeCaptureResult{err: errors.New("capture failed")}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := make(chan nativeCaptureResult, 1)
			deliverNativeCapture(result, tc.value)
			deliverNativeCapture(result, nativeCaptureResult{}) // Duplicates never block AppKit.
			data, supported, err := awaitNativeCapture(context.Background(), 9003, result)
			if supported != tc.supported || err != tc.value.err || len(data) != len(tc.value.data) {
				t.Fatalf("result=%v supported=%v err=%v", data, supported, err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := make(chan nativeCaptureResult, 1)
	result <- nativeCaptureResult{data: []byte{1}}
	if _, _, err := awaitNativeCapture(ctx, 9004, result); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation must beat an already queued image: %v", err)
	}
}

func TestNativeScreenshotPipeline(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "native-capture")
	cmd := exec.Command("/usr/bin/clang", "-fblocks", "testdata/native-capture.m", "-framework", "Cocoa", "-framework", "QuartzCore", "-framework", "ImageIO", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile native screenshot regression: %v\n%s", err, out)
	}
	if out, err := exec.Command(binary).CombinedOutput(); err != nil {
		t.Fatalf("native screenshot regression: %v\n%s", err, out)
	} else {
		t.Logf("%s", out)
	}
}
