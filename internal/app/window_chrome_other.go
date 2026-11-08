//go:build !darwin || !cgo

package app

import "github.com/egoist/mygo"

func maintainEditorChrome(*mygo.Window, mygo.Point) {}

func maintainQuickMaterial(*mygo.Window) {}

func refreshPinShadow(*mygo.Window) {}

func nativeDoubleClickMilliseconds() int { return 500 }
