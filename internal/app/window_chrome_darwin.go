//go:build darwin && cgo

package app

/*
#cgo LDFLAGS: -framework Cocoa -framework QuartzCore
#cgo CFLAGS: -fblocks
#include <stdint.h>
void ciip_maintain_editor_chrome(uintptr_t window, double x, double y);
void ciip_maintain_quick_material(uintptr_t window);
void ciip_reveal_quick_window(uintptr_t window, double duration, double x1, double y1, double x2, double y2);
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

func showQuickWindow(window *mygo.Window, duration float64, curve [4]float64) {
	mygo.RunOnMain(func() {
		if window.IsDestroyed() {
			return
		}
		// Order the already painted WebView at zero opacity in the same main-loop
		// turn. Showing it first would expose one full-strength frame before fading.
		window.SetOpacity(0)
		window.Show()
		window.Focus()
		C.ciip_reveal_quick_window(C.uintptr_t(window.NativeHandle()), C.double(duration), C.double(curve[0]), C.double(curve[1]), C.double(curve[2]), C.double(curve[3]))
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
