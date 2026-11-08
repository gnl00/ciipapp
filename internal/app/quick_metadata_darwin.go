//go:build darwin && cgo

package app

/*
#cgo LDFLAGS: -framework Foundation
#include <stdlib.h>
int ciip_capture_rect(const char *path, double *x, double *y, double *width, double *height);
*/
import "C"

import "unsafe"

func nativeCaptureRect(path string) *ScreenRect {
	name := C.CString(path)
	defer C.free(unsafe.Pointer(name))
	var x, y, width, height C.double
	if C.ciip_capture_rect(name, &x, &y, &width, &height) == 0 {
		return nil
	}
	r := &ScreenRect{X: float64(x), Y: float64(y), Width: float64(width), Height: float64(height)}
	if !validScreenRect(r) {
		return nil
	}
	return r
}
