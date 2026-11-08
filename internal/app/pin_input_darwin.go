//go:build darwin && cgo

package app

/*
#cgo LDFLAGS: -framework Cocoa
#cgo CFLAGS: -fblocks
#include <stdint.h>
int ciip_install_pin_input(uintptr_t window, uintptr_t token, double width, double height);
void ciip_update_pin_input(uintptr_t window, double width, double height);
void ciip_remove_pin_input(uintptr_t window);
*/
import "C"

import (
	"sync"
	"sync/atomic"

	"github.com/egoist/mygo"
)

var pinMagnifyCallbacks sync.Map
var pinMagnifyToken atomic.Uint64

//export ciip_go_pin_magnify
func ciip_go_pin_magnify(token C.uintptr_t, magnification C.double) {
	if callback, ok := pinMagnifyCallbacks.Load(uintptr(token)); ok {
		callback.(func(float64))(float64(magnification))
	}
}

func installPinMagnify(window *mygo.Window, width, height int, callback func(float64)) (func(), bool) {
	token := uintptr(pinMagnifyToken.Add(1))
	pinMagnifyCallbacks.Store(token, callback)
	var handle uintptr
	enabled := false
	mygo.RunOnMain(func() {
		if !window.IsDestroyed() {
			handle = window.NativeHandle()
			enabled = C.ciip_install_pin_input(C.uintptr_t(handle), C.uintptr_t(token), C.double(width), C.double(height)) != 0
		}
	})
	if !enabled {
		pinMagnifyCallbacks.Delete(token)
		return func() {}, false
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			pinMagnifyCallbacks.Delete(token)
			mygo.RunOnMain(func() {
				if !window.IsDestroyed() {
					C.ciip_remove_pin_input(C.uintptr_t(handle))
				}
			})
		})
	}, true
}

func updatePinMagnify(window *mygo.Window, width, height int) {
	mygo.RunOnMain(func() {
		if !window.IsDestroyed() {
			C.ciip_update_pin_input(C.uintptr_t(window.NativeHandle()), C.double(width), C.double(height))
		}
	})
}
