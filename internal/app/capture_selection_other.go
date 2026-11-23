//go:build !darwin || !cgo

package app

import (
	"context"
	"errors"

	"github.com/egoist/mygo"
)

func nativeElementPermission() bool { return false }
func selectNativeCapture(context.Context, string, *mygo.Window) (*captureSelection, error) {
	return nil, errors.New("截图选择器需要 macOS")
}

func submitNativeCaptureToolbar(context.Context, *mygo.Window, int) bool { return false }
