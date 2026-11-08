//go:build !darwin || !cgo

package app

func nativeCaptureRect(string) *ScreenRect { return nil }
