//go:build darwin && cgo

package app

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"unsafe"

	"ciip/frontend"
)

func TestElementMeasurementSharesCaptureLock(t *testing.T) {
	var service CaptureService
	service.captureMu.Lock()
	defer service.captureMu.Unlock()
	if err := service.measureElements(context.Background()); !errors.Is(err, errScreenActionBusy) {
		t.Fatalf("element measurement while capture is busy: %v", err)
	}
}

func TestNativeCaptureSelectionCopyIntent(t *testing.T) {
	const token = 9005
	result := make(chan captureSelectionResult, 1)
	captureSelectionCallbacks.Store(uintptr(token), result)
	defer captureSelectionCallbacks.Delete(uintptr(token))

	ciip_go_capture_selection(token, 0, -20, 40, 200, 160, 1)
	got := (<-result).selection
	want := captureSelection{Rect: ScreenRect{-20, 40, 200, 160}, CopyOnly: true}
	if got == nil || got.Rect != want.Rect || !got.CopyOnly || got.WindowID != 0 || got.PNG != nil {
		t.Fatalf("copy selection = %+v, want %+v", got, want)
	}

	ciip_go_capture_selection(token, 0, 0, 0, 0, 0, 0)
	if got := (<-result).selection; got != nil {
		t.Fatalf("cancelled selection returned %+v", got)
	}

	data := []byte{1, 2, 3}
	ciip_go_capture_area_image(token, -20, 40, 200, 160, 1, unsafe.Pointer(&data[0]), 3, nil)
	selected := <-result
	data[0] = 0
	if selected.err != nil || selected.selection == nil || selected.selection.Rect != want.Rect ||
		!selected.selection.CopyOnly || len(selected.selection.PNG) != 3 || selected.selection.PNG[0] != 1 {
		t.Fatalf("frozen selection = %+v, err = %v", selected.selection, selected.err)
	}
	ciip_go_capture_area_image(token, -20, 40, 200, 160, 1, nil, 0, nil)
	if selected := <-result; selected.err == nil || selected.selection != nil {
		t.Fatalf("missing frozen image returned %+v", selected)
	}
}

func TestNativeCaptureSelection(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "capture-selection")
	cmd := exec.Command("/usr/bin/clang", "-fblocks", "testdata/capture-selection.m", "capture_snapshot_darwin.m", "capture_snapshot_crop_darwin.m", "-framework", "ImageIO", "-framework", "Cocoa", "-framework", "ApplicationServices", "-framework", "QuartzCore", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile native capture regression: %v\n%s", err, out)
	}
	if out, err := exec.Command(binary).CombinedOutput(); err != nil {
		t.Fatalf("native capture regression: %v\n%s", err, out)
	}
}

func TestNativeCaptureSelectionMotion(t *testing.T) {
	duration, err := captureSelectionMotion(frontend.TokensCSS)
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "capture-selection-motion")
	cmd := exec.Command("/usr/bin/clang", "-fblocks", "testdata/capture-selection-motion.m", "capture_snapshot_darwin.m", "capture_snapshot_crop_darwin.m", "-framework", "ImageIO", "-framework", "Cocoa", "-framework", "ApplicationServices", "-framework", "QuartzCore", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile native motion regression: %v\n%s", err, out)
	}
	args := []string{strconv.FormatFloat(duration, 'f', -1, 64)}
	if out, err := exec.Command(binary, args...).CombinedOutput(); err != nil {
		t.Fatalf("native motion regression: %v\n%s", err, out)
	}
}

func TestNativeCapturePointerRouting(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "capture-pointer-routing")
	cmd := exec.Command("/usr/bin/clang", "-fblocks", "testdata/capture-pointer-routing.m", "capture_snapshot_darwin.m", "capture_snapshot_crop_darwin.m", "-framework", "ImageIO", "-framework", "Cocoa", "-framework", "ApplicationServices", "-framework", "QuartzCore", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile native mouse regression: %v\n%s", err, out)
	}
	if out, err := exec.Command(binary).CombinedOutput(); err != nil {
		t.Fatalf("native mouse regression: %v\n%s", err, out)
	}
}
