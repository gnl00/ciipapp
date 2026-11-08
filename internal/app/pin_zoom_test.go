package app

import (
	"math"
	"testing"

	"github.com/egoist/mygo"
)

func assertPinCenter(t *testing.T, bounds mygo.Rectangle, x, y float64) {
	t.Helper()
	if math.Abs(float64(bounds.X)+float64(bounds.Width)/2-x) > 0.5 || math.Abs(float64(bounds.Y)+float64(bounds.Height)/2-y) > 0.5 {
		t.Fatalf("pin center drifted from (%v,%v): %+v", x, y, bounds)
	}
}

func TestPinZoomKeepsSubpixelInput(t *testing.T) {
	var zoom pinZoomGeometry
	bounds := mygo.Rectangle{X: 500, Y: 400, Width: 400, Height: 300}
	work := mygo.Rectangle{Width: 2000, Height: 1600}
	for i := 0; i < 100; i++ {
		bounds = zoom.resize(bounds, work, 800, 600, math.Exp(-0.0001))
	}
	want := int(math.Round(400 * math.Exp(-0.01)))
	if bounds.Width != want {
		t.Fatalf("small deltas lost: width=%d want=%d", bounds.Width, want)
	}
	assertPinCenter(t, bounds, 700, 550)
}

func TestPinZoomCenterDoesNotDriftWithOnePixelSteps(t *testing.T) {
	var zoom pinZoomGeometry
	bounds := mygo.Rectangle{X: 500, Y: 400, Width: 400, Height: 300}
	work := mygo.Rectangle{Width: 2000, Height: 1600}
	for i := 0; i < 100; i++ {
		bounds = zoom.resize(bounds, work, 800, 600, 0.997)
		assertPinCenter(t, bounds, 700, 550)
	}
}

func TestPinZoomRebasesAfterManualMoveOrResize(t *testing.T) {
	var zoom pinZoomGeometry
	work := mygo.Rectangle{Width: 2000, Height: 1600}
	zoom.resize(mygo.Rectangle{X: 500, Y: 400, Width: 400, Height: 300}, work, 800, 600, 1.1)
	manual := mygo.Rectangle{X: 70, Y: 90, Width: 520, Height: 390}
	bounds := zoom.resize(manual, work, 800, 600, 1.1)
	if bounds.Width != 572 || bounds.Height != 429 {
		t.Fatalf("manual size not respected: %+v", bounds)
	}
	assertPinCenter(t, bounds, 330, 285)
	manual = bounds
	manual.X += 80
	manual.Y += 60
	bounds = zoom.resize(manual, work, 800, 600, 1)
	if bounds != manual {
		t.Fatalf("manual position not respected: got %+v want %+v", bounds, manual)
	}
}

func TestPinZoomRefitsChangedImageAtSameCenter(t *testing.T) {
	var zoom pinZoomGeometry
	work := mygo.Rectangle{X: -1400, Y: 30, Width: 1400, Height: 1000}
	bounds := mygo.Rectangle{X: -900, Y: 400, Width: 400, Height: 300}
	bounds = zoom.resize(bounds, work, 800, 600, 1)
	bounds = zoom.resize(bounds, work, 400, 600, 1)
	if bounds.Width != 200 || bounds.Height != 300 {
		t.Fatalf("new aspect ratio not fitted: %+v", bounds)
	}
	assertPinCenter(t, bounds, -700, 550)
}

func TestPinZoomClampsWithoutKeepingOvershoot(t *testing.T) {
	var zoom pinZoomGeometry
	work := mygo.Rectangle{Width: 1000, Height: 800}
	bounds := mygo.Rectangle{X: 0, Y: 0, Width: 400, Height: 300}
	for i := 0; i < 20; i++ {
		bounds = zoom.resize(bounds, work, 800, 600, 2)
		if bounds.X < 0 || bounds.Y < 0 || bounds.X+bounds.Width > work.Width || bounds.Y+bounds.Height > work.Height {
			t.Fatalf("pin outside display: %+v", bounds)
		}
	}
	if bounds.Width != 976 {
		t.Fatalf("max width=%d want=976", bounds.Width)
	}
	bounds = zoom.resize(bounds, work, 800, 600, 0.99)
	if bounds.Width >= 976 {
		t.Fatal("maximum overshoot delayed reversal")
	}
	for i := 0; i < 20; i++ {
		bounds = zoom.resize(bounds, work, 800, 600, 0.5)
	}
	if bounds.Width != 120 || bounds.Height != 90 {
		t.Fatalf("minimum size: %+v", bounds)
	}
	bounds = zoom.resize(bounds, work, 800, 600, 1.01)
	if bounds.Width <= 120 {
		t.Fatal("minimum overshoot delayed reversal")
	}
}

func TestPinMinimumPreservesSourceAspectRatio(t *testing.T) {
	for _, tc := range []struct{ sourceW, sourceH, wantW, wantH int }{
		{800, 600, 120, 90}, {600, 800, 90, 120}, {1000, 100, 120, 12}, {100, 1000, 12, 120},
	} {
		width, height := fitPinSize(tc.sourceW, tc.sourceH, 1920, 1080, 0)
		if width != tc.wantW || height != tc.wantH {
			t.Fatalf("source %dx%d minimum became %dx%d; want %dx%d", tc.sourceW, tc.sourceH, width, height, tc.wantW, tc.wantH)
		}
	}
}

func TestPinFitNeverAddsIndependentMinimumPadding(t *testing.T) {
	for _, source := range [][2]int{{800, 600}, {600, 800}, {10000, 10}, {10, 10000}, {20, 20}} {
		for _, requested := range []float64{0, 0.01, 0.5, 1, 8} {
			scale := fitPinScale(source[0], source[1], 800, 600, requested)
			width, height := fitPinSize(source[0], source[1], 800, 600, requested)
			wantW := max(1, int(math.Round(float64(source[0])*scale)))
			wantH := max(1, int(math.Round(float64(source[1])*scale)))
			if width != wantW || height != wantH || width > 800 || height > 600 {
				t.Fatalf("source %v scale %v padded beyond its uniform fit: %dx%d; want %dx%d", source, requested, width, height, wantW, wantH)
			}
		}
	}
}
