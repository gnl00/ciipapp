//go:build darwin && cgo

package app

/*
#cgo LDFLAGS: -framework Cocoa -framework QuartzCore
#cgo CFLAGS: -fblocks
#include <stdint.h>
void ciip_maintain_editor_chrome(uintptr_t window, double x, double y);
void ciip_maintain_quick_material(uintptr_t window);
void ciip_refresh_pin_shadow(uintptr_t window);
double ciip_double_click_interval(void);
*/
import "C"

import "github.com/egoist/mygo"

func maintainEditorChrome(window *mygo.Window, position mygo.Point) {
	mygo.RunOnMain(func() {
		C.ciip_maintain_editor_chrome(C.uintptr_t(window.NativeHandle()), C.double(position.X), C.double(position.Y))
	})
}

func maintainQuickMaterial(window *mygo.Window) {
	mygo.RunOnMain(func() {
		C.ciip_maintain_quick_material(C.uintptr_t(window.NativeHandle()))
	})
}

func refreshPinShadow(window *mygo.Window) {
	mygo.RunOnMain(func() {
		if !window.IsDestroyed() {
			C.ciip_refresh_pin_shadow(C.uintptr_t(window.NativeHandle()))
		}
	})
}

func nativeDoubleClickMilliseconds() int {
	interval := 500
	mygo.RunOnMain(func() { interval = max(1, int(float64(C.ciip_double_click_interval())*1000+.5)) })
	return interval
}
