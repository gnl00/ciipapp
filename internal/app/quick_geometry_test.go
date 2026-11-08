package app

import (
	"context"
	"encoding/json"
	"math"
	"testing"

	"github.com/egoist/mygo"
)

func quickDisplays() []mygo.Display {
	return []mygo.Display{
		{ID: 10, Bounds: mygo.Rectangle{X: -1920, Y: 0, Width: 1920, Height: 1080}, WorkArea: mygo.Rectangle{X: -1920, Y: 24, Width: 1920, Height: 1056}, ScaleFactor: 1},
		{ID: 20, Bounds: mygo.Rectangle{X: 0, Y: 0, Width: 1440, Height: 900}, WorkArea: mygo.Rectangle{X: 0, Y: 25, Width: 1440, Height: 825}, ScaleFactor: 2, Primary: true},
		{ID: 30, Bounds: mygo.Rectangle{X: 0, Y: -1200, Width: 1920, Height: 1200}, WorkArea: mygo.Rectangle{X: 0, Y: -1175, Width: 1920, Height: 1175}, ScaleFactor: 1},
	}
}

func nearQuick(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-8 {
		t.Fatalf("got %.10f, want %.10f", got, want)
	}
}

func TestQuickPlacementPreservesOriginalCoordinates(t *testing.T) {
	for _, tc := range []struct {
		name          string
		width, height int
		source        ScreenRect
		display       int64
		x, y, scale   float64
	}{
		{"retina", 1200, 800, ScreenRect{X: 123.25, Y: 107.5, Width: 600, Height: 400}, 20, 123.25, 107.5, .5},
		{"negative x", 600, 400, ScreenRect{X: -1800.5, Y: 100.25, Width: 600, Height: 400}, 10, -1800.5, 100.25, 1},
		{"negative y", 300, 200, ScreenRect{X: 200.75, Y: -1100.25, Width: 300, Height: 200}, 30, 200.75, -1100.25, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := placeQuickImage(tc.width, tc.height, &tc.source, quickDisplays(), mygo.Point{X: 800, Y: 400})
			if err != nil || !got.Original || got.DisplayID != tc.display {
				t.Fatalf("placement=%+v, error=%v", got, err)
			}
			nearQuick(t, float64(got.Panel.X)+got.Image.X, tc.x)
			nearQuick(t, float64(got.Panel.Y)+got.Image.Y, tc.y)
			nearQuick(t, got.Scale, tc.scale)
			nearQuick(t, got.Image.Width/float64(tc.width), got.Image.Height/float64(tc.height))
		})
	}
}

func TestQuickPlacementFallbackFitsWithoutCropping(t *testing.T) {
	for _, tc := range []struct {
		name          string
		width, height int
		source        *ScreenRect
		preferred     mygo.Point
		display       int64
	}{
		{"missing", 1000, 600, nil, mygo.Point{X: -500, Y: 400}, 10},
		{"shared edge belongs to display interior", 1000, 600, nil, mygo.Point{X: 0, Y: 0}, 20},
		{"large", 7000, 5000, nil, mygo.Point{X: 500, Y: 400}, 20},
		{"full screen leaves toolbar room", 2880, 1800, &ScreenRect{X: 0, Y: 0, Width: 1440, Height: 900}, mygo.Point{X: 500, Y: 400}, 20},
		{"near desktop bottom shifts compact window", 1200, 800, &ScreenRect{X: 700, Y: 460, Width: 600, Height: 400}, mygo.Point{X: 800, Y: 600}, 20},
		{"spanning equal overlap chooses cursor", 800, 600, &ScreenRect{X: -200, Y: 100, Width: 400, Height: 300}, mygo.Point{X: 100, Y: 200}, 20},
		{"spanning selects most overlap", 800, 600, &ScreenRect{X: -300, Y: 100, Width: 400, Height: 300}, mygo.Point{X: 100, Y: 200}, 10},
		{"offscreen", 1000, 600, &ScreenRect{X: 50000, Y: 50000, Width: 500, Height: 300}, mygo.Point{X: 500, Y: 400}, 20},
		{"aspect mismatch", 1000, 600, &ScreenRect{X: 100, Y: 100, Width: 100, Height: 400}, mygo.Point{X: 500, Y: 400}, 20},
		{"invalid coordinates", 1000, 600, &ScreenRect{X: math.NaN(), Y: 100, Width: 500, Height: 300}, mygo.Point{X: 500, Y: 400}, 20},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := placeQuickImage(tc.width, tc.height, tc.source, quickDisplays(), tc.preferred)
			if err != nil || got.Original || got.DisplayID != tc.display {
				t.Fatalf("placement=%+v, error=%v", got, err)
			}
			if !rectContains(ScreenRect{Width: float64(got.Panel.Width), Height: float64(got.Panel.Height)}, got.Image) {
				t.Fatalf("image leaves panel: %+v", got)
			}
			for _, display := range quickDisplays() {
				if display.ID == got.DisplayID && !rectContains(screenRectangle(display.WorkArea), screenRectangle(got.Panel)) {
					t.Fatalf("window leaves work area: %+v", got)
				}
			}
			nearQuick(t, got.Image.Width/float64(tc.width), got.Image.Height/float64(tc.height))
			if got.Scale <= 0 || got.Scale > 1 {
				t.Fatalf("invalid fallback scale %g", got.Scale)
			}
		})
	}
}

func TestQuickPlacementDoesNotStretchRoundedMetadata(t *testing.T) {
	source := &ScreenRect{X: 100, Y: 100, Width: 300.25, Height: 200}
	got, err := placeQuickImage(600, 400, source, quickDisplays(), mygo.Point{})
	if err != nil || !got.Original {
		t.Fatalf("placement=%+v, error=%v", got, err)
	}
	nearQuick(t, got.Scale, .5)
	nearQuick(t, float64(got.Panel.X)+got.Image.X, 100.125)
	nearQuick(t, got.Image.Width, 300)
}

func TestQuickPlacementValidationAndJSON(t *testing.T) {
	for _, size := range [][2]int{{0, 1}, {-1, 1}, {1, 0}, {10000, 10000}} {
		if _, err := placeQuickImage(size[0], size[1], nil, quickDisplays(), mygo.Point{}); err == nil {
			t.Fatalf("accepted invalid size %v", size)
		}
	}
	if _, err := placeQuickImage(100, 100, nil, nil, mygo.Point{}); err == nil {
		t.Fatal("accepted no displays")
	}
	displays := []mygo.Display{{ID: 1, Bounds: mygo.Rectangle{Width: 500, Height: 400}, ScaleFactor: math.NaN()}}
	got, err := placeQuickImage(200, 100, nil, displays, mygo.Point{})
	if err != nil || got.Scale != 1 {
		t.Fatalf("missing work area/invalid scale fallback=%+v, error=%v", got, err)
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatal(err)
	}
	panel := object["panel"].(map[string]any)
	if len(panel) != 4 || panel["width"] != float64(320) || object["original"] != false {
		t.Fatalf("unexpected placement JSON: %s", raw)
	}
}

func TestQuickWindowTracksCaptureSizeInsteadOfCoveringDisplay(t *testing.T) {
	got, err := placeQuickImage(1200, 800, &ScreenRect{X: 200, Y: 150, Width: 600, Height: 400}, quickDisplays(), mygo.Point{})
	if err != nil {
		t.Fatal(err)
	}
	if got.Panel.Width != 624 || got.Panel.Height != 540 {
		t.Fatalf("compact window=%+v, want capture plus chrome", got.Panel)
	}
	if got.Panel.Width >= 1440 || got.Panel.Height >= 825 {
		t.Fatalf("small capture still covers the desktop: %+v", got)
	}
	nearQuick(t, got.Image.X, quickWindowSide)
	nearQuick(t, got.Image.Y, quickWindowTop)
	if !got.Original {
		t.Fatal("an in-bounds capture should keep its original screen position")
	}
}

func TestQuickWindowMinimumSizeKeepsTinyCaptureAndToolbarReachable(t *testing.T) {
	got, err := placeQuickImage(20, 16, nil, quickDisplays(), mygo.Point{X: 800, Y: 400})
	if err != nil {
		t.Fatal(err)
	}
	if got.Panel.Width != quickMinWidth || got.Panel.Height != quickMinHeight {
		t.Fatalf("tiny window has inaccessible chrome: %+v", got)
	}
	if got.Image.Y < quickWindowTop || got.Image.Y+got.Image.Height > float64(got.Panel.Height-quickWindowBottom) {
		t.Fatalf("tiny capture overlaps controls: %+v", got)
	}
	if got.Scale != .5 {
		t.Fatalf("tiny Retina capture upscaled: %g", got.Scale)
	}
}

func TestQuickWindowFitsSmallWorkAreaAndRejectsUnusableDisplays(t *testing.T) {
	display := []mygo.Display{{ID: 1, Bounds: mygo.Rectangle{X: -300, Y: -200, Width: 300, Height: 200}, WorkArea: mygo.Rectangle{X: -300, Y: -190, Width: 300, Height: 190}, ScaleFactor: 1}}
	got, err := placeQuickImage(1000, 1000, nil, display, mygo.Point{})
	if err != nil {
		t.Fatal(err)
	}
	if !rectContains(screenRectangle(display[0].WorkArea), screenRectangle(got.Panel)) || !rectContains(ScreenRect{Width: float64(got.Panel.Width), Height: float64(got.Panel.Height)}, got.Image) {
		t.Fatalf("small-screen placement=%+v", got)
	}
	display[0].Bounds.Height = 100
	display[0].WorkArea.Height = 90
	if _, err := placeQuickImage(100, 100, nil, display, mygo.Point{}); err == nil {
		t.Fatal("an unusable work area should not open an offscreen window")
	}
}

func TestQuickWindowResizeKeepsOppositeEdgesFixed(t *testing.T) {
	initial := ScreenRect{X: -400, Y: 100, Width: 624, Height: 540}
	work := mygo.Rectangle{Width: 1440, Height: 900}
	for _, tc := range []struct {
		edge string
		want ScreenRect
	}{
		{"e", ScreenRect{-400, 100, 674, 540}},
		{"s", ScreenRect{-400, 100, 624, 580}},
		{"w", ScreenRect{-350, 100, 574, 540}},
		{"n", ScreenRect{-400, 140, 624, 500}},
		{"ne", ScreenRect{-400, 140, 674, 500}},
		{"nw", ScreenRect{-350, 140, 574, 500}},
		{"se", ScreenRect{-400, 100, 674, 580}},
		{"sw", ScreenRect{-350, 100, 574, 580}},
	} {
		got, err := transformQuickBounds(initial, tc.edge, 50, 40, work)
		if err != nil || got != tc.want {
			t.Fatalf("edge %s: %+v error=%v want=%+v", tc.edge, got, err, tc.want)
		}
	}
	got, err := transformQuickBounds(initial, "nw", 10000, 10000, work)
	if err != nil || got.Width != 320 || got.Height != 240 || got.X+got.Width != initial.X+initial.Width || got.Y+got.Height != initial.Y+initial.Height {
		t.Fatalf("minimum-size anchor drifted: %+v error=%v", got, err)
	}
	got, err = transformQuickBounds(initial, "nw", -10000, -10000, work)
	if err != nil || got.Width != 1440 || got.Height != 900 || got.X+got.Width != 224 || got.Y+got.Height != 640 {
		t.Fatalf("maximum-size anchor drifted: %+v error=%v", got, err)
	}
}

func TestQuickWindowMoveCrossesDisplaysAndUsesInitialFrame(t *testing.T) {
	initial := ScreenRect{X: 100, Y: 100, Width: 624, Height: 540}
	work := mygo.Rectangle{Width: 1440, Height: 900}
	got, err := transformQuickBounds(initial, "move", -1800.4, -800.6, work)
	if err != nil || got != (ScreenRect{-1700, -701, 624, 540}) {
		t.Fatalf("cross-display move was clamped or scaled: %+v error=%v", got, err)
	}
	for i := 0; i < 100; i++ {
		got, err = transformQuickBounds(initial, "se", .4, .6, work)
		if err != nil || got != (ScreenRect{100, 100, 624, 541}) {
			t.Fatalf("sub-point gestures accumulated: %+v error=%v", got, err)
		}
	}
	got, err = transformQuickBounds(initial, "nw", 500, 500, mygo.Rectangle{Width: 300, Height: 190})
	if err != nil || got.Width != 300 || got.Height != 190 {
		t.Fatalf("minimum exceeded small display: %+v error=%v", got, err)
	}
}

func TestQuickWindowTransformRejectsMalformedInput(t *testing.T) {
	initial := ScreenRect{X: 100, Y: 100, Width: 624, Height: 540}
	for _, tc := range []struct {
		frame  ScreenRect
		edge   string
		dx, dy float64
	}{
		{initial, "invalid", 0, 0},
		{initial, "move", math.NaN(), 0},
		{initial, "move", 0, math.Inf(1)},
		{initial, "se", 1_000_001, 0},
		{ScreenRect{0, 0, 0, 10}, "move", 0, 0},
		{ScreenRect{math.Inf(-1), 0, 100, 100}, "e", 0, 0},
		{ScreenRect{1_000_000, 0, 100, 100}, "move", 1, 0},
		{ScreenRect{0, 0, .01, 100}, "e", 0, 0},
		{ScreenRect{0, 0, 32769, 100}, "move", 0, 0},
	} {
		if _, err := transformQuickBounds(tc.frame, tc.edge, tc.dx, tc.dy, mygo.Rectangle{}); err == nil {
			t.Fatalf("accepted malformed transform: %+v", tc)
		}
	}
}

func TestQuickWindowAPIsRejectCallsOutsideCurrentQuickPage(t *testing.T) {
	for _, service := range []*CaptureService{{}, {quickState: quickState{quick: &quickSession{window: &mygo.Window{}}}}} {
		if _, err := service.GetQuickBounds(context.Background()); err == nil {
			t.Fatal("non-quick caller read private window bounds")
		}
		if _, err := service.TransformQuickWindow(context.Background(), ScreenRect{0, 0, 624, 540}, "move", 10, 10); err == nil {
			t.Fatal("non-quick caller moved a quick window")
		}
	}
}
