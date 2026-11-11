//go:build darwin && cgo

package app

/*
#cgo LDFLAGS: -framework Cocoa -framework ApplicationServices -framework QuartzCore
#cgo CFLAGS: -fblocks
#include <stdint.h>
int ciip_element_permission(void);
int ciip_start_capture_selection(uintptr_t token, int mode, double duration);
void ciip_cancel_capture_selection(uintptr_t token);
*/
import "C"

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"

	"ciip/frontend"

	"github.com/egoist/mygo"
)

var captureSelectionCallbacks sync.Map
var captureSelectionToken atomic.Uint64

//export ciip_go_capture_selection
func ciip_go_capture_selection(token C.uintptr_t, window C.uint32_t, x, y, width, height C.double) {
	if value, ok := captureSelectionCallbacks.Load(uintptr(token)); ok {
		var selection *captureSelection
		if width > 0 && height > 0 {
			selection = &captureSelection{WindowID: uint32(window), Rect: ScreenRect{X: float64(x), Y: float64(y), Width: float64(width), Height: float64(height)}}
		}
		value.(chan *captureSelection) <- selection
	}
}

func nativeElementPermission() bool {
	var granted bool
	mygo.RunOnMain(func() { granted = C.ciip_element_permission() != 0 })
	return granted
}

func selectNativeCapture(ctx context.Context, mode string) (*captureSelection, error) {
	duration, err := captureSelectionMotion(frontend.TokensCSS)
	if err != nil {
		return nil, err
	}
	token := uintptr(captureSelectionToken.Add(1))
	result := make(chan *captureSelection, 1)
	captureSelectionCallbacks.Store(token, result)
	defer captureSelectionCallbacks.Delete(token)
	var started bool
	mygo.RunOnMain(func() {
		var nativeMode C.int
		switch mode {
		case "element":
			nativeMode = 1
		case "measure":
			nativeMode = 2
		}
		started = C.ciip_start_capture_selection(C.uintptr_t(token), nativeMode, C.double(duration)) != 0
	})
	if !started {
		if mode == "measure" {
			return nil, errors.New("无法打开元素测量")
		}
		return nil, errors.New("无法打开截图选择器")
	}
	defer mygo.RunOnMain(func() { C.ciip_cancel_capture_selection(C.uintptr_t(token)) })
	select {
	case selection := <-result:
		return selection, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
