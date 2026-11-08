//go:build !darwin || !cgo

package app

import "errors"

func recognizeTextNative([]byte) ([]byte, error) {
	return nil, errors.New("离线文字识别需要 macOS 13 或更新版本，并使用 CGO_ENABLED=1 构建")
}

func recognizeTextNativeMode(png []byte, fast bool) ([]byte, error) { return recognizeTextNative(png) }
