//go:build !darwin || !cgo

package app

import "github.com/egoist/mygo"

func installPinMagnify(*mygo.Window, int, int, func(float64)) (func(), bool) {
	return func() {}, false
}

func updatePinMagnify(*mygo.Window, int, int) {}
