//go:build !darwin || !cgo

package app

import "github.com/egoist/mygo"

func maintainEditorChrome(*mygo.Window, mygo.Point) {}

func maintainQuickMaterial(*mygo.Window) {}

func showQuickWindow(window *mygo.Window, _ float64, _ [4]float64) {
	window.Show()
	window.Focus()
}

func refreshPinShadow(*mygo.Window) {}

func nativeDoubleClickMilliseconds() int { return 500 }
