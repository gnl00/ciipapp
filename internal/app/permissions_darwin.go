//go:build darwin && cgo

package app

/*
#cgo LDFLAGS: -framework Cocoa -framework CoreGraphics
#include <stdlib.h>
char *ciip_bundle_identifier(void);
char *ciip_application_path(void);
int ciip_screen_permission(void);
int ciip_show_permission_guide(void);
int ciip_reveal_application(void);
char *ciip_tray_icon(const char *style);
*/
import "C"
import (
	"encoding/base64"
	"errors"
	"github.com/egoist/mygo"
	"unsafe"
)

func nativeString(value *C.char) string {
	if value == nil {
		return ""
	}
	defer C.free(unsafe.Pointer(value))
	return C.GoString(value)
}
func nativeBundleIdentifier() string { return nativeString(C.ciip_bundle_identifier()) }
func nativeApplicationPath() string  { return nativeString(C.ciip_application_path()) }
func nativeScreenPermission() bool   { return C.ciip_screen_permission() != 0 }
func showNativePermissionGuide() error {
	var ok bool
	mygo.RunOnMain(func() { ok = C.ciip_show_permission_guide() != 0 })
	if !ok {
		return errors.New("请从已构建的 ciip.app 打开权限引导")
	}
	return nil
}
func revealNativeApplication() error {
	var ok bool
	mygo.RunOnMain(func() { ok = C.ciip_reveal_application() != 0 })
	if !ok {
		return errors.New("未找到当前应用包")
	}
	return nil
}
func nativeTrayIcon(style string) []byte {
	var data []byte
	mygo.RunOnMain(func() {
		s := C.CString(style)
		defer C.free(unsafe.Pointer(s))
		data, _ = base64.StdEncoding.DecodeString(nativeString(C.ciip_tray_icon(s)))
	})
	return data
}
