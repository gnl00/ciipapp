package app

import (
	"math"
	"reflect"
	"strings"
	"testing"

	"ciip/frontend"
)

func TestCaptureSelectionArguments(t *testing.T) {
	window := &captureSelection{WindowID: 42, Rect: ScreenRect{-1920, -900, 960, 640}}
	args, err := window.arguments("window")
	if err != nil || !reflect.DeepEqual(args, []string{"-l", "42", "-o"}) {
		t.Fatalf("window args = %v, %v", args, err)
	}
	element := &captureSelection{Rect: ScreenRect{-1920.25, -900.5, 120.5, 42.25}}
	args, err = element.arguments("element")
	if err != nil || !reflect.DeepEqual(args, []string{"-R", "-1921,-901,122,43"}) || element.Rect != (ScreenRect{-1921, -901, 122, 43}) {
		t.Fatalf("element args = %v, rect = %+v, error = %v", args, element.Rect, err)
	}
	for _, selection := range []*captureSelection{nil, {}, {Rect: ScreenRect{0, 0, math.NaN(), 1}}, {Rect: ScreenRect{0, 0, 1, -1}}} {
		if _, err := selection.arguments("element"); err == nil {
			t.Fatalf("accepted invalid selection: %+v", selection)
		}
	}
	if _, err := (&captureSelection{Rect: ScreenRect{0, 0, 1, 1}}).arguments("window"); err == nil {
		t.Fatal("accepted a missing window ID")
	}
	if _, err := window.arguments("unknown"); err == nil {
		t.Fatal("accepted an unknown mode")
	}
}

func TestCaptureSelectionReadsSharedMotion(t *testing.T) {
	duration, err := captureSelectionMotion(frontend.TokensCSS)
	if err != nil || duration != .12 {
		t.Fatalf("shared motion: %v, %v", duration, err)
	}
	changed := strings.Replace(frontend.TokensCSS, "--motion-capture-selection:120ms", "--motion-capture-selection:150ms", 1)
	if duration, err := captureSelectionMotion(changed); err != nil || duration != .15 {
		t.Fatalf("native selection ignored the changed token: %v %v", duration, err)
	}
	for _, css := range []string{"", "--motion-capture-selection:bad", "--motion-capture-selection:-1ms", "--motion-capture-selection:1001ms"} {
		if _, err := captureSelectionMotion(css); err == nil {
			t.Fatalf("accepted broken native motion contract: %q", css)
		}
	}
	// The follower no longer consumes a Bezier curve. Only quick-window fades use --ease-panel.
	if duration, err := captureSelectionMotion("--motion-capture-selection:120ms;--ease-panel:unused"); err != nil || duration != .12 {
		t.Fatalf("selection incorrectly depends on panel easing: %v %v", duration, err)
	}
}
