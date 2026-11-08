//go:build !darwin || !cgo

package app

import "errors"

func nativeBundleIdentifier() string   { return "dev.ciip.app" }
func nativeApplicationPath() string    { return "" }
func nativeScreenPermission() bool     { return false }
func showNativePermissionGuide() error { return errors.New("权限引导需要 macOS") }
func revealNativeApplication() error   { return errors.New("此平台无法定位应用包") }
func nativeTrayIcon(string) []byte     { return nil }
