package app

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Selection geometry uses global, top-left-origin points, not image pixels.
type captureSelection struct {
	WindowID uint32
	Rect     ScreenRect
}

// The selection token is the time for the native follower to cover 95% of a stationary target's distance.
func captureSelectionMotion(css string) (float64, error) {
	return nativeMotionDuration(css, "--motion-capture-selection")
}

func nativeMotionDuration(css, durationToken string) (float64, error) {
	d := regexp.MustCompile(regexp.QuoteMeta(durationToken) + `:\s*([0-9.]+)ms`).FindStringSubmatch(css)
	if len(d) != 2 {
		return 0, errors.New("截图动效设计变量缺失")
	}
	duration, err := strconv.ParseFloat(d[1], 64)
	if err != nil || duration < 0 || duration > 1000 {
		return 0, errors.New("截图动效时长无效")
	}
	return duration / 1000, nil
}

func nativePanelMotion(css, durationToken string) (duration float64, curve [4]float64, err error) {
	duration, err = nativeMotionDuration(css, durationToken)
	if err != nil {
		return 0, curve, err
	}
	c := regexp.MustCompile(`--ease-panel:\s*cubic-bezier\(([^)]+)\)`).FindStringSubmatch(css)
	if len(c) != 2 {
		return 0, curve, errors.New("截图动效设计变量缺失")
	}
	parts := strings.Split(c[1], ",")
	if len(parts) != 4 {
		return 0, curve, errors.New("截图动效曲线无效")
	}
	for i, part := range parts {
		curve[i], err = strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil || math.IsNaN(curve[i]) || math.IsInf(curve[i], 0) || curve[i] < 0 || curve[i] > 1 {
			return 0, curve, errors.New("截图动效曲线无效")
		}
	}
	return duration, curve, nil
}

func (s *captureSelection) arguments(mode string) ([]string, error) {
	if s == nil || !validScreenRect(&s.Rect) {
		return nil, errors.New("截图选区无效")
	}
	switch mode {
	case "window":
		if s.WindowID == 0 {
			return nil, errors.New("截图窗口无效")
		}
		return []string{"-l", fmt.Sprint(s.WindowID), "-o"}, nil
	case "element":
		// Capture every touched point and use the same rect for quick placement.
		r := s.Rect
		s.Rect = ScreenRect{X: math.Floor(r.X), Y: math.Floor(r.Y), Width: math.Ceil(r.X+r.Width) - math.Floor(r.X), Height: math.Ceil(r.Y+r.Height) - math.Floor(r.Y)}
		return []string{"-R", fmt.Sprintf("%.0f,%.0f,%.0f,%.0f", s.Rect.X, s.Rect.Y, s.Rect.Width, s.Rect.Height)}, nil
	default:
		return nil, errors.New("未知选区模式")
	}
}
