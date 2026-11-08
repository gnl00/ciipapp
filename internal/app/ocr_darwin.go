//go:build darwin && cgo

package app

/*
#cgo LDFLAGS: -framework Foundation -framework Vision
#include <stdlib.h>
char *ciip_recognize_text(const unsigned char *bytes, size_t length, int fast, char **error);
*/
import "C"

import (
	"errors"
	"unsafe"
)

func recognizeTextNative(png []byte) ([]byte, error) { return recognizeTextNativeMode(png, false) }

func recognizeTextNativeMode(png []byte, fast bool) ([]byte, error) {
	if len(png) == 0 {
		return nil, errors.New("图片为空")
	}
	var mode C.int
	if fast {
		mode = 1
	}
	var message *C.char
	result := C.ciip_recognize_text((*C.uchar)(unsafe.Pointer(&png[0])), C.size_t(len(png)), mode, &message)
	if message != nil {
		defer C.free(unsafe.Pointer(message))
	}
	if result == nil {
		if message != nil {
			return nil, errors.New(C.GoString(message))
		}
		return nil, errors.New("Apple Vision 未返回结果")
	}
	defer C.free(unsafe.Pointer(result))
	return []byte(C.GoString(result)), nil
}
