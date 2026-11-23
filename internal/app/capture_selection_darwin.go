//go:build darwin && cgo

package app

/*
#cgo LDFLAGS: -framework Cocoa -framework ApplicationServices -framework QuartzCore
#cgo CFLAGS: -fblocks
#include <stdint.h>
int ciip_element_permission(void);
int ciip_start_capture_selection(uintptr_t token, int mode, double duration, uintptr_t toolbarHandle);
void ciip_cancel_capture_selection(uintptr_t token);
int ciip_submit_capture_toolbar(uintptr_t toolbarHandle, int action);
*/
import "C"

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"unsafe"

	"ciip/frontend"

	"github.com/egoist/mygo"
)

var captureSelectionCallbacks sync.Map
var captureSelectionToken atomic.Uint64

type captureSelectionResult struct {
	selection *captureSelection
	err       error
}

func deliverCaptureSelection(token uintptr, result captureSelectionResult) {
	if value, ok := captureSelectionCallbacks.Load(token); ok {
		select {
		case value.(chan captureSelectionResult) <- result:
		default:
		}
	}
}

//export ciip_go_capture_selection
func ciip_go_capture_selection(token C.uintptr_t, window C.uint32_t, x, y, width, height C.double, copyOnly C.int) {
	var selection *captureSelection
	if width > 0 && height > 0 {
		selection = &captureSelection{
			WindowID: uint32(window), Rect: ScreenRect{X: float64(x), Y: float64(y), Width: float64(width), Height: float64(height)},
			CopyOnly: copyOnly != 0,
		}
	}
	deliverCaptureSelection(uintptr(token), captureSelectionResult{selection: selection})
}

//export ciip_go_capture_area_image
func ciip_go_capture_area_image(token C.uintptr_t, x, y, width, height C.double, copyOnly C.int, png unsafe.Pointer, length C.size_t, detail *C.char) {
	if _, ok := captureSelectionCallbacks.Load(uintptr(token)); !ok {
		return
	}
	if detail != nil {
		deliverCaptureSelection(uintptr(token), captureSelectionResult{err: errors.New(C.GoString(detail))})
		return
	}
	rect := ScreenRect{X: float64(x), Y: float64(y), Width: float64(width), Height: float64(height)}
	if png == nil || length == 0 || uint64(length) > maxImageBytes || !validScreenRect(&rect) {
		deliverCaptureSelection(uintptr(token), captureSelectionResult{err: errors.New("冻结选区未返回有效截图")})
		return
	}
	deliverCaptureSelection(uintptr(token), captureSelectionResult{selection: &captureSelection{
		Rect: rect, CopyOnly: copyOnly != 0, PNG: C.GoBytes(png, C.int(length)),
	}})
}

func nativeElementPermission() bool {
	var granted bool
	mygo.RunOnMain(func() { granted = C.ciip_element_permission() != 0 })
	return granted
}

func selectNativeCapture(ctx context.Context, mode string, toolbar *mygo.Window) (*captureSelection, error) {
	duration, err := captureSelectionMotion(frontend.TokensCSS)
	if err != nil {
		return nil, err
	}
	token := uintptr(captureSelectionToken.Add(1))
	result := make(chan captureSelectionResult, 1)
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
		case "area":
			nativeMode = 3
		}
		var handle uintptr
		if toolbar != nil {
			handle = toolbar.NativeHandle()
		}
		started = C.ciip_start_capture_selection(C.uintptr_t(token), nativeMode, C.double(duration), C.uintptr_t(handle)) != 0
	})
	if !started {
		if mode == "measure" {
			return nil, errors.New("无法打开元素测量")
		}
		return nil, errors.New("无法打开截图选择器")
	}
	select {
	case selected := <-result:
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return selected.selection, selected.err
	case <-ctx.Done():
		captureSelectionCallbacks.Delete(token)
		mygo.RunOnMain(func() { C.ciip_cancel_capture_selection(C.uintptr_t(token)) })
		return nil, ctx.Err()
	}
}

func submitNativeCaptureToolbar(ctx context.Context, toolbar *mygo.Window, action int) bool {
	var submitted bool
	mygo.RunOnMain(func() {
		if ctx.Err() != nil {
			return
		}
		if handle := toolbar.NativeHandle(); handle != 0 {
			submitted = C.ciip_submit_capture_toolbar(C.uintptr_t(handle), C.int(action)) != 0
		}
	})
	return submitted
}
