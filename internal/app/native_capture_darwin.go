//go:build darwin && cgo

package app

/*
#cgo CFLAGS: -fblocks
#cgo LDFLAGS: -framework Cocoa -framework QuartzCore -framework ImageIO
#include <stdint.h>
#include <stdlib.h>
void ciip_capture_png_begin(uintptr_t token, int window, uint32_t windowID, double x, double y, double width, double height);
void ciip_capture_png_cancel(uintptr_t token);
*/
import "C"

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/egoist/mygo"
)

type nativeCaptureResult struct {
	data        []byte
	unsupported bool
	err         error
}

var nativeCaptureCallbacks sync.Map
var nativeCaptureSequence atomic.Uint64

//export ciip_go_capture_png
func ciip_go_capture_png(token C.uintptr_t, bytes unsafe.Pointer, length C.size_t, detail *C.char, unsupported C.int) {
	value, ok := nativeCaptureCallbacks.Load(uintptr(token))
	if !ok {
		return // Cancelled requests must not copy or deliver a late image.
	}
	result := nativeCaptureResult{unsupported: unsupported != 0}
	if detail != nil {
		result.err = errors.New(C.GoString(detail))
	} else if uint64(length) > maxImageBytes {
		result.err = errors.New("截图超过 64 MB")
	} else if length > 0 && bytes != nil {
		result.data = C.GoBytes(bytes, C.int(length))
	} else if !result.unsupported {
		result.err = errors.New("原生截图未返回图片")
	}
	deliverNativeCapture(value.(chan nativeCaptureResult), result)
}

func deliverNativeCapture(result chan nativeCaptureResult, value nativeCaptureResult) {
	select {
	case result <- value:
	default:
		// One completion per request. Never block AppKit on a cancelled waiter.
	}
}

// The native request starts after the picker's close transaction has flushed and
// the main queue advances. ScreenCaptureKit asynchronously supplies the new frame.
// Unsupported OS/geometry explicitly returns false so the existing CLI can run.
func captureNativeSelection(ctx context.Context, selection *captureSelection, mode string) ([]byte, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, true, err
	}
	token := uintptr(nativeCaptureSequence.Add(1))
	result := make(chan nativeCaptureResult, 1)
	nativeCaptureCallbacks.Store(token, result)
	defer func() {
		nativeCaptureCallbacks.Delete(token)
		mygo.RunOnMain(func() { C.ciip_capture_png_cancel(C.uintptr_t(token)) })
	}()
	mygo.RunOnMain(func() {
		var window C.int
		if mode == "window" {
			window = 1
		}
		r := selection.Rect
		C.ciip_capture_png_begin(C.uintptr_t(token), window, C.uint32_t(selection.WindowID), C.double(r.X), C.double(r.Y), C.double(r.Width), C.double(r.Height))
	})
	return awaitNativeCapture(ctx, token, result)
}

func awaitNativeCapture(ctx context.Context, token uintptr, result <-chan nativeCaptureResult) ([]byte, bool, error) {
	defer nativeCaptureCallbacks.Delete(token)
	select {
	case value := <-result:
		if err := ctx.Err(); err != nil {
			return nil, true, err
		}
		return value.data, !value.unsupported, value.err
	case <-ctx.Done():
		return nil, true, ctx.Err()
	}
}
