//go:build darwin && cgo

package app

import (
	"os/exec"
	"path/filepath"
	"testing"
)

func TestNativeCaptureSelectionDrag(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "capture-selection-drag")
	cmd := exec.Command("/usr/bin/clang", "-fblocks", "testdata/capture-selection-drag.m", "-framework", "Cocoa", "-framework", "ApplicationServices", "-framework", "QuartzCore", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile native drag regression: %v\n%s", err, out)
	}
	if out, err := exec.Command(binary).CombinedOutput(); err != nil {
		t.Fatalf("native drag regression: %v\n%s", err, out)
	}
}
