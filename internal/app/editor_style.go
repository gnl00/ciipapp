package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

type EditorStyle struct {
	Color           string  `json:"color"`
	Stroke          float64 `json:"stroke"`
	PenStroke       float64 `json:"penStroke"`
	HighlightStroke float64 `json:"highlightStroke"`
	HighlightColor  string  `json:"highlightColor"`
	ArrowStyle      string  `json:"arrowStyle"`
	NumberStyle     string  `json:"numberStyle"`
	NumberRadius    float64 `json:"numberRadius"`
	RedactStyle     string  `json:"redactStyle"`
	RedactStrength  float64 `json:"redactStrength"`
	TextSize        float64 `json:"textSize"`
}

// A window submits only the controls it changed, so another window's latest
// values survive a save from an older editor snapshot.
type EditorStylePatch struct {
	Color           *string  `json:"color,omitempty"`
	Stroke          *float64 `json:"stroke,omitempty"`
	PenStroke       *float64 `json:"penStroke,omitempty"`
	HighlightStroke *float64 `json:"highlightStroke,omitempty"`
	HighlightColor  *string  `json:"highlightColor,omitempty"`
	ArrowStyle      *string  `json:"arrowStyle,omitempty"`
	NumberStyle     *string  `json:"numberStyle,omitempty"`
	NumberRadius    *float64 `json:"numberRadius,omitempty"`
	RedactStyle     *string  `json:"redactStyle,omitempty"`
	RedactStrength  *float64 `json:"redactStrength,omitempty"`
	TextSize        *float64 `json:"textSize,omitempty"`
}

type editorStyleState struct {
	editorStyleMu   sync.Mutex
	editorStyle     EditorStyle
	editorStylePath string
}

func defaultEditorStyle() EditorStyle {
	return EditorStyle{
		Color: "#c94632", Stroke: 4, PenStroke: 4, HighlightStroke: 20, HighlightColor: "#e6a32b",
		ArrowStyle: "line", NumberStyle: "filled", NumberRadius: 16,
		RedactStyle: "blur", RedactStrength: 12, TextSize: 24,
	}
}

var editorStyleColor = regexp.MustCompile(`^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$`)

func validateEditorStyle(style EditorStyle) error {
	if !editorStyleColor.MatchString(style.Color) {
		return errors.New("标注颜色无效")
	}
	if !editorStyleColor.MatchString(style.HighlightColor) {
		return errors.New("高亮颜色无效")
	}
	inRange := func(value, min, max float64) bool { return value >= min && value <= max }
	if !inRange(style.Stroke, .5, 200) || !inRange(style.PenStroke, .5, 200) || !inRange(style.HighlightStroke, .5, 200) {
		return errors.New("线条粗细无效")
	}
	switch style.ArrowStyle {
	case "line", "pointer", "curved", "tapered", "direction":
	default:
		return errors.New("箭头样式无效")
	}
	if style.NumberStyle != "filled" && style.NumberStyle != "outline" {
		return errors.New("编号样式无效")
	}
	if !inRange(style.NumberRadius, 12, 160) {
		return errors.New("编号大小无效")
	}
	if style.RedactStyle != "blur" && style.RedactStyle != "pixelate" && style.RedactStyle != "solid" {
		return errors.New("遮盖样式无效")
	}
	if !inRange(style.RedactStrength, 4, 40) {
		return errors.New("遮盖强度无效")
	}
	if !inRange(style.TextSize, 8, 512) {
		return errors.New("文字字号无效")
	}
	return nil
}

func readEditorStyle(path string) (EditorStyle, error) {
	style := defaultEditorStyle()
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return style, nil
	}
	if err != nil {
		return style, err
	}
	if len(raw) > 64<<10 {
		return defaultEditorStyle(), errors.New("工具样式文件过大")
	}
	if err := json.Unmarshal(raw, &style); err != nil {
		return defaultEditorStyle(), err
	}
	if err := validateEditorStyle(style); err != nil {
		return defaultEditorStyle(), err
	}
	return style, nil
}

func (s *CaptureService) initializeEditorStyle(directory string) error {
	s.editorStylePath = filepath.Join(directory, "editor-style.json")
	var err error
	s.editorStyle, err = readEditorStyle(s.editorStylePath)
	return err
}

func (s *CaptureService) GetEditorStyle() EditorStyle {
	s.editorStyleMu.Lock()
	defer s.editorStyleMu.Unlock()
	if s.editorStyle.Color == "" {
		return defaultEditorStyle()
	}
	return s.editorStyle
}

func (s *CaptureService) SetEditorStyle(patch EditorStylePatch) (EditorStyle, error) {
	s.editorStyleMu.Lock()
	defer s.editorStyleMu.Unlock()
	old := s.editorStyle
	if old.Color == "" {
		old = defaultEditorStyle()
	}
	next := old
	if patch.Color != nil {
		next.Color = *patch.Color
	}
	if patch.Stroke != nil {
		next.Stroke = *patch.Stroke
	}
	if patch.PenStroke != nil {
		next.PenStroke = *patch.PenStroke
	}
	if patch.HighlightStroke != nil {
		next.HighlightStroke = *patch.HighlightStroke
	}
	if patch.HighlightColor != nil {
		next.HighlightColor = *patch.HighlightColor
	}
	if patch.ArrowStyle != nil {
		next.ArrowStyle = *patch.ArrowStyle
	}
	if patch.NumberStyle != nil {
		next.NumberStyle = *patch.NumberStyle
	}
	if patch.NumberRadius != nil {
		next.NumberRadius = *patch.NumberRadius
	}
	if patch.RedactStyle != nil {
		next.RedactStyle = *patch.RedactStyle
	}
	if patch.RedactStrength != nil {
		next.RedactStrength = *patch.RedactStrength
	}
	if patch.TextSize != nil {
		next.TextSize = *patch.TextSize
	}
	if err := validateEditorStyle(next); err != nil {
		return old, err
	}
	if s.editorStylePath == "" {
		return old, errors.New("工具样式目录不可用")
	}
	if err := saveJSON(s.editorStylePath, next); err != nil {
		return old, fmt.Errorf("无法保存工具样式：%w", err)
	}
	s.editorStyle = next
	return next, nil
}
