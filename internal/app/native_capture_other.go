//go:build !darwin || !cgo

package app

import "context"

func captureNativeSelection(context.Context, *captureSelection, string) ([]byte, bool, error) {
	return nil, false, nil
}
