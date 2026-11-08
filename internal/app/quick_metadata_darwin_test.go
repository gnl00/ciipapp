//go:build darwin && cgo

package app

import (
	"encoding/base64"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestCaptureRectMetadata(t *testing.T) {
	file := filepath.Join(t.TempDir(), "metadata-fixture.png")
	if err := os.WriteFile(file, []byte("metadata fixture, no screen content"), 0600); err != nil {
		t.Fatal(err)
	}
	if nativeCaptureRect(file) != nil || nativeCaptureRect(file+".missing") != nil {
		t.Fatal("missing metadata must not invent screen coordinates")
	}
	for _, tc := range []struct {
		name, plist string
		valid       bool
	}{
		{"binary rect", "YnBsaXN0MDCkAQIDBCPAngIAAAAAACNAW5AAAAAAACNAhAAAAAAAACNAdoAAAAAAAAgNFh8oAAAAAAAAAQEAAAAAAAAABQAAAAAAAAAAAAAAAAAAADE=", true},
		{"boolean", "YnBsaXN0MDCkAQIDBAgQABECgBEBaAgNDhATAAAAAAAAAQEAAAAAAAAABQAAAAAAAAAAAAAAAAAAABY=", false},
		{"string", "YnBsaXN0MDCkAQIDBFEwEAARAoARAWgIDQ8RFAAAAAAAAAEBAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAX", false},
		{"dictionary", "YnBsaXN0MDDUAQIDBAUGBwdWaGVpZ2h0VXdpZHRoUXhReREBaBECgBAACBEYHiAiJSgAAAAAAAABAQAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAKg==", false},
		{"negative size", "YnBsaXN0MDCkAQECAxAAE///////////EGQIDQ8YAAAAAAAAAQEAAAAAAAAABAAAAAAAAAAAAAAAAAAAABo=", false},
		{"infinite", "YnBsaXN0MDCkAQIDAxAAI3/wAAAAAAAAEGQIDQ8YAAAAAAAAAQEAAAAAAAAABAAAAAAAAAAAAAAAAAAAABo=", false},
		{"malformed", "bm90IGEgcGxpc3Q=", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := base64.StdEncoding.DecodeString(tc.plist)
			if err != nil {
				t.Fatal(err)
			}
			if out, err := exec.Command("/usr/bin/xattr", "-wx", "com.apple.metadata:kMDItemScreenCaptureGlobalRect", hex.EncodeToString(raw), file).CombinedOutput(); err != nil {
				t.Fatalf("write metadata fixture: %v: %s", err, out)
			}
			got := nativeCaptureRect(file)
			if (got != nil) != tc.valid {
				t.Fatalf("metadata accepted=%v, expected=%v", got != nil, tc.valid)
			}
			if tc.valid && *got != (ScreenRect{X: -1920.5, Y: 110.25, Width: 640, Height: 360}) {
				t.Fatalf("coordinates changed: %+v", got)
			}
		})
	}
	t.Run("oversized", func(t *testing.T) {
		if out, err := exec.Command("/usr/bin/xattr", "-wx", "com.apple.metadata:kMDItemScreenCaptureGlobalRect", hex.EncodeToString(make([]byte, 4097)), file).CombinedOutput(); err != nil {
			t.Fatalf("write oversized fixture: %v: %s", err, out)
		}
		if nativeCaptureRect(file) != nil {
			t.Fatal("accepted oversized metadata")
		}
	})
}
