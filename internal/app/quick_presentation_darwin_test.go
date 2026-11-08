//go:build darwin && cgo

package app

import (
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"ciip/frontend"
)

func TestQuickPresentationUsesSharedMotion(t *testing.T) {
	duration, curve, err := nativePanelMotion(frontend.TokensCSS, "--motion-panel-in")
	if err != nil || duration != .17 || curve != ([4]float64{.16, 1, .3, 1}) {
		t.Fatalf("quick presentation motion: %v %v, %v", duration, curve, err)
	}
	changed := strings.Replace(frontend.TokensCSS, "--motion-panel-in:170ms", "--motion-panel-in:200ms", 1)
	if duration, _, err := nativePanelMotion(changed, "--motion-panel-in"); err != nil || duration != .2 {
		t.Fatalf("quick presentation ignored shared token: %v, %v", duration, err)
	}
}

func TestNativeQuickPresentation(t *testing.T) {
	duration, curve, err := nativePanelMotion(frontend.TokensCSS, "--motion-panel-in")
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "quick-presentation")
	cmd := exec.Command("/usr/bin/clang", "-fblocks", "testdata/quick-presentation.m", "window_chrome_darwin.m", "-framework", "Cocoa", "-framework", "QuartzCore", "-o", binary)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile native quick presentation regression: %v\n%s", err, out)
	}
	args := []string{strconv.FormatFloat(duration, 'f', -1, 64)}
	for _, value := range curve {
		args = append(args, strconv.FormatFloat(value, 'f', -1, 64))
	}
	if out, err := exec.Command(binary, args...).CombinedOutput(); err != nil {
		t.Fatalf("native quick presentation regression: %v\n%s", err, out)
	} else if !strings.Contains(string(out), "PASS native quick presentation: intermediate alpha, stationary frame, settled image, reduced motion, zero duration") {
		t.Fatalf("native quick presentation exited without completing its assertions:\n%s", out)
	}
}
