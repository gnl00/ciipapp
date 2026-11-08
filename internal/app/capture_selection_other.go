//go:build !darwin || !cgo

package app

import (
	"context"
	"errors"
)

func nativeElementPermission() bool { return false }
func selectNativeCapture(context.Context, string) (*captureSelection, error) {
	return nil, errors.New("截图选择器需要 macOS")
}
