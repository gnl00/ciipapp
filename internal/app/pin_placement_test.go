package app

import (
	"github.com/egoist/mygo"
	"testing"
)

func TestPinKeepsDisplayedScreenshotPositionAndScale(t *testing.T) {
	display := mygo.Display{WorkArea: mygo.Rectangle{X: 0, Y: 25, Width: 1440, Height: 825}, ScaleFactor: 2}
	source := &ScreenRect{X: 184, Y: 164, Width: 800, Height: 500}
	got := initialPinBounds(1600, 1000, source, display)
	want := mygo.Rectangle{X: 184, Y: 164, Width: 800, Height: 500}
	if got != want {
		t.Fatalf("pin moved away from its displayed screenshot: got %+v want %+v", got, want)
	}
}

func TestPinPositionHandlesNegativeDisplaysAndFitsOversizedViews(t *testing.T) {
	display := mygo.Display{WorkArea: mygo.Rectangle{X: -1920, Y: 24, Width: 1920, Height: 1056}, ScaleFactor: 1}
	source := &ScreenRect{X: -1700, Y: 120, Width: 600, Height: 400}
	if got := initialPinBounds(1200, 800, source, display); got != (mygo.Rectangle{X: -1700, Y: 120, Width: 600, Height: 400}) {
		t.Fatalf("negative display changed position: %+v", got)
	}
	large := initialPinBounds(6000, 4000, &ScreenRect{X: -2000, Y: -20, Width: 3000, Height: 2000}, display)
	if large.X < display.WorkArea.X || large.Y < display.WorkArea.Y || large.X+large.Width > 0 || large.Y+large.Height > 1080 {
		t.Fatalf("large pin not visible: %+v", large)
	}
	if large.Width*4000 != large.Height*6000 {
		t.Fatalf("large pin aspect changed: %+v", large)
	}
}

func TestPinWithoutSourceRetainsCenteredFallback(t *testing.T) {
	display := mygo.Display{WorkArea: mygo.Rectangle{X: 0, Y: 25, Width: 1440, Height: 825}, ScaleFactor: 2}
	got := initialPinBounds(1000, 700, nil, display)
	if got != (mygo.Rectangle{X: 470, Y: 262, Width: 500, Height: 350}) {
		t.Fatalf("fallback changed: %+v", got)
	}
}

func TestSmallPinKeepsSourceSizeAndDoesNotJumpOnZoom(t *testing.T) {
	display := mygo.Display{WorkArea: mygo.Rectangle{X: 0, Y: 25, Width: 1440, Height: 825}}
	source := &ScreenRect{X: 184, Y: 164, Width: 100, Height: 50}
	bounds := initialPinBounds(200, 100, source, display)
	if bounds != (mygo.Rectangle{X: 184, Y: 164, Width: 100, Height: 50}) {
		t.Fatalf("small pin changed source rectangle: %+v", bounds)
	}
	var zoom pinZoomGeometry
	larger := zoom.resize(bounds, display.WorkArea, 200, 100, 1.1)
	if larger.Width != 110 || larger.Height != 55 {
		t.Fatalf("small pin jumped to the default minimum: %+v", larger)
	}
	if restored := zoom.resize(larger, display.WorkArea, 200, 100, 1/1.1); restored != bounds {
		t.Fatalf("small pin cannot return to original size: %+v", restored)
	}
}
