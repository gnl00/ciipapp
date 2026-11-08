//go:build darwin && cgo

package app

import (
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"

	"ciip/frontend"
)

func TestNativeCaptureSelection(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "capture-selection")
	cmd := exec.Command("/usr/bin/clang", "-fblocks", "testdata/capture-selection.m", "-framework", "Cocoa", "-framework", "ApplicationServices", "-framework", "QuartzCore", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile native capture regression: %v\n%s", err, out)
	}
	if out, err := exec.Command(binary).CombinedOutput(); err != nil {
		t.Fatalf("native capture regression: %v\n%s", err, out)
	}
}

func TestNativeCaptureSelectionMotion(t *testing.T) {
	duration, curve, err := captureSelectionMotion(frontend.TokensCSS)
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "capture-selection-motion")
	cmd := exec.Command("/usr/bin/clang", "-fblocks", "testdata/capture-selection-motion.m", "-framework", "Cocoa", "-framework", "ApplicationServices", "-framework", "QuartzCore", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile native motion regression: %v\n%s", err, out)
	}
	args := []string{strconv.FormatFloat(duration, 'f', -1, 64)}
	for _, value := range curve {
		args = append(args, strconv.FormatFloat(value, 'f', -1, 64))
	}
	if out, err := exec.Command(binary, args...).CombinedOutput(); err != nil {
		t.Fatalf("native motion regression: %v\n%s", err, out)
	}
}

func TestNativeCapturePointerRouting(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "capture-pointer-routing")
	cmd := exec.Command("/usr/bin/clang", "-fblocks", "testdata/capture-pointer-routing.m", "-framework", "Cocoa", "-framework", "ApplicationServices", "-framework", "QuartzCore", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile native mouse regression: %v\n%s", err, out)
	}
	if out, err := exec.Command(binary).CombinedOutput(); err != nil {
		t.Fatalf("native mouse regression: %v\n%s", err, out)
	}
}
