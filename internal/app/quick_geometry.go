package app

import (
	"encoding/json"
	"errors"
	"math"
	"strings"

	"github.com/egoist/mygo"
)

// ScreenRect uses global screen points with the primary display's top-left as
// the origin, like MyGo. Image coordinates in QuickPlacement are panel-local.
type ScreenRect struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type QuickPlacement struct {
	Panel     mygo.Rectangle `json:"panel"`
	Image     ScreenRect     `json:"image"`
	Original  bool           `json:"original"`
	Scale     float64        `json:"scale"`
	DisplayID int64          `json:"displayID"`
}

const (
	quickWindowSide   = 12
	quickWindowTop    = 28
	quickWindowBottom = 112
	quickMinWidth     = 320
	quickMinHeight    = 240
)

func (p QuickPlacement) MarshalJSON() ([]byte, error) {
	// MyGo's Rectangle has no JSON tags; expose the same lower-case rectangle
	// shape for the panel and image while keeping the native SetBounds API.
	return json.Marshal(struct {
		Panel     ScreenRect `json:"panel"`
		Image     ScreenRect `json:"image"`
		Original  bool       `json:"original"`
		Scale     float64    `json:"scale"`
		DisplayID int64      `json:"displayID"`
	}{screenRectangle(p.Panel), p.Image, p.Original, p.Scale, p.DisplayID})
}

func validScreenRect(r *ScreenRect) bool {
	if r == nil {
		return false
	}
	for _, v := range []float64{r.X, r.Y, r.Width, r.Height} {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 1_000_000 {
			return false
		}
	}
	return r.Width > 0 && r.Height > 0
}

func screenRectangle(r mygo.Rectangle) ScreenRect {
	return ScreenRect{X: float64(r.X), Y: float64(r.Y), Width: float64(r.Width), Height: float64(r.Height)}
}

func screenIntersection(a, b ScreenRect) ScreenRect {
	x, y := math.Max(a.X, b.X), math.Max(a.Y, b.Y)
	return ScreenRect{X: x, Y: y, Width: math.Max(0, math.Min(a.X+a.Width, b.X+b.Width)-x), Height: math.Max(0, math.Min(a.Y+a.Height, b.Y+b.Height)-y)}
}

func rectContains(outer, inner ScreenRect) bool {
	const epsilon = 1e-6
	return inner.X >= outer.X-epsilon && inner.Y >= outer.Y-epsilon && inner.X+inner.Width <= outer.X+outer.Width+epsilon && inner.Y+inner.Height <= outer.Y+outer.Height+epsilon
}

// Use the gesture's initial global frame, never a frame already changed by an
// earlier pointer event; rounding and bridge latency must not accumulate.
func transformQuickBounds(initial ScreenRect, edge string, dx, dy float64, work mygo.Rectangle) (ScreenRect, error) {
	if !validScreenRect(&initial) || initial.Width > 32768 || initial.Height > 32768 || math.IsNaN(dx) || math.IsNaN(dy) || math.IsInf(dx, 0) || math.IsInf(dy, 0) || math.Abs(dx) > 1_000_000 || math.Abs(dy) > 1_000_000 {
		return ScreenRect{}, errors.New("窗口调整参数无效")
	}
	switch edge {
	case "n", "e", "s", "w", "ne", "nw", "se", "sw", "move":
	default:
		return ScreenRect{}, errors.New("窗口调整方向无效")
	}
	initial = ScreenRect{X: math.Round(initial.X), Y: math.Round(initial.Y), Width: math.Round(initial.Width), Height: math.Round(initial.Height)}
	if !validScreenRect(&initial) {
		return ScreenRect{}, errors.New("窗口尺寸无效")
	}
	next := initial
	if edge == "move" {
		next.X += math.Round(dx)
		next.Y += math.Round(dy)
	} else {
		maxWidth, maxHeight := 32768.0, 32768.0
		if work.Width > 0 {
			maxWidth = math.Min(maxWidth, float64(work.Width))
		}
		if work.Height > 0 {
			maxHeight = math.Min(maxHeight, float64(work.Height))
		}
		minWidth, minHeight := math.Min(quickMinWidth, maxWidth), math.Min(quickMinHeight, maxHeight)
		if strings.ContainsAny(edge, "ew") {
			width := initial.Width + dx
			if strings.Contains(edge, "w") {
				width = initial.Width - dx
			}
			next.Width = math.Round(math.Max(minWidth, math.Min(maxWidth, width)))
			if strings.Contains(edge, "w") {
				next.X = initial.X + initial.Width - next.Width
			}
		}
		if strings.ContainsAny(edge, "ns") {
			height := initial.Height + dy
			if strings.Contains(edge, "n") {
				height = initial.Height - dy
			}
			next.Height = math.Round(math.Max(minHeight, math.Min(maxHeight, height)))
			if strings.Contains(edge, "n") {
				next.Y = initial.Y + initial.Height - next.Height
			}
		}
	}
	if !validScreenRect(&next) {
		return ScreenRect{}, errors.New("窗口调整范围无效")
	}
	return next, nil
}

// A mixed-DPI capture spanning displays cannot be positioned by stretching its
// pixels. Fit that image on one display instead, preserving all its pixels.
func placeQuickImage(width, height int, source *ScreenRect, displays []mygo.Display, preferred mygo.Point) (QuickPlacement, error) {
	if width <= 0 || height <= 0 || int64(width) > maxImagePixels/int64(height) {
		return QuickPlacement{}, errors.New("截图尺寸无效")
	}
	available := make([]mygo.Display, 0, len(displays))
	for _, d := range displays {
		bounds := screenRectangle(d.Bounds)
		if validScreenRect(&bounds) {
			available = append(available, d)
		}
	}
	if len(available) == 0 {
		return QuickPlacement{}, errors.New("没有可用的显示器")
	}
	chosen, bestDistance := 0, math.Inf(1)
	for i, d := range available {
		b := screenRectangle(d.Bounds)
		if float64(preferred.X) >= b.X && float64(preferred.X) < b.X+b.Width && float64(preferred.Y) >= b.Y && float64(preferred.Y) < b.Y+b.Height {
			chosen = i
			break
		}
		dx := math.Max(math.Max(b.X-float64(preferred.X), 0), float64(preferred.X)-(b.X+b.Width))
		dy := math.Max(math.Max(b.Y-float64(preferred.Y), 0), float64(preferred.Y)-(b.Y+b.Height))
		if distance := dx*dx + dy*dy; distance < bestDistance {
			chosen, bestDistance = i, distance
		}
	}
	validSource := validScreenRect(source)
	if validSource {
		preferredIntersection := screenIntersection(*source, screenRectangle(available[chosen].Bounds))
		bestArea := preferredIntersection.Width * preferredIntersection.Height
		for i, d := range available {
			intersection := screenIntersection(*source, screenRectangle(d.Bounds))
			if area := intersection.Width * intersection.Height; area > bestArea {
				chosen, bestArea = i, area
			}
		}
	}
	display := available[chosen]
	bounds := screenRectangle(display.Bounds)
	work := screenIntersection(bounds, screenRectangle(display.WorkArea))
	if work.Width <= 0 || work.Height <= 0 {
		work = bounds
	}
	if work.Width <= 2*quickWindowSide || work.Height <= quickWindowTop+quickWindowBottom {
		return QuickPlacement{}, errors.New("显示器工作区过小，无法显示快捷编辑")
	}
	maxWidth := math.Max(1, work.Width-2*quickWindowSide)
	maxHeight := math.Max(1, work.Height-quickWindowTop-quickWindowBottom)
	deviceScale := display.ScaleFactor
	if math.IsNaN(deviceScale) || math.IsInf(deviceScale, 0) || deviceScale <= 0 {
		deviceScale = 1
	}
	desiredScale := math.Min(1, 1/deviceScale)
	originalLocation := false
	if validSource && rectContains(bounds, *source) {
		scale := math.Min(source.Width/float64(width), source.Height/float64(height))
		// Permit at most one logical point of metadata rounding, never stretch.
		if math.Abs(source.Width-float64(width)*scale) <= 1 && math.Abs(source.Height-float64(height)*scale) <= 1 {
			desiredScale, originalLocation = scale, true
		}
	}
	scale := math.Min(desiredScale, math.Min(maxWidth/float64(width), maxHeight/float64(height)))
	w, h := float64(width)*scale, float64(height)*scale
	panelWidth := min(int(work.Width), max(quickMinWidth, int(math.Ceil(w+2*quickWindowSide))))
	panelHeight := min(int(work.Height), max(quickMinHeight, int(math.Ceil(h+quickWindowTop+quickWindowBottom))))
	imageX := (float64(panelWidth) - w) / 2
	imageY := quickWindowTop + (float64(panelHeight)-quickWindowTop-quickWindowBottom-h)/2
	x, y := work.X+(work.Width-float64(panelWidth))/2, work.Y+(work.Height-float64(panelHeight))/2
	if originalLocation && scale == desiredScale {
		x = source.X + (source.Width-w)/2 - imageX
		y = source.Y + (source.Height-h)/2 - imageY
	}
	x = math.Max(work.X, math.Min(work.X+work.Width-float64(panelWidth), math.Round(x)))
	y = math.Max(work.Y, math.Min(work.Y+work.Height-float64(panelHeight), math.Round(y)))
	placement := QuickPlacement{
		Panel: mygo.Rectangle{X: int(x), Y: int(y), Width: panelWidth, Height: panelHeight},
		Image: ScreenRect{X: imageX, Y: imageY, Width: w, Height: h},
		Scale: scale, DisplayID: display.ID,
	}
	if originalLocation && scale == desiredScale {
		// Preserve sub-point capture coordinates when the whole window fits.
		globalX, globalY := source.X+(source.Width-w)/2, source.Y+(source.Height-h)/2
		imageRect := ScreenRect{X: globalX - x, Y: globalY - y, Width: w, Height: h}
		// The native frame rounds to whole points; retain up to one point
		// of capture metadata precision inside the clear resize margin.
		content := ScreenRect{X: quickWindowSide - 1, Y: quickWindowTop - 1, Width: float64(panelWidth - 2*quickWindowSide + 2), Height: float64(panelHeight - quickWindowTop - quickWindowBottom + 2)}
		if rectContains(content, imageRect) {
			placement.Image, placement.Original = imageRect, true
		}
	}
	return placement, nil
}
