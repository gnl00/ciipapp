//go:build darwin && cgo

package app

import (
	"os/exec"
	"path/filepath"
	"testing"
)

func TestFrozenScreenshotCrop(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "capture-snapshot-crop")
	cmd := exec.Command("/usr/bin/clang", "testdata/capture-snapshot-crop.m", "capture_snapshot_crop_darwin.m",
		"-framework", "Foundation", "-framework", "CoreGraphics", "-framework", "ImageIO", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile frozen screenshot crop regression: %v\n%s", err, out)
	}
	if out, err := exec.Command(binary).CombinedOutput(); err != nil {
		t.Fatalf("frozen screenshot crop regression: %v\n%s", err, out)
	}
}
