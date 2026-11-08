//go:build darwin && cgo

package app

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"strings"
	"testing"
)

func TestVisionOCRFixture(t *testing.T) {
	png, err := os.ReadFile("testdata/ocr-multilingual.png")
	if err != nil {
		t.Fatal(err)
	}
	result, err := (&CaptureService{}).RecognizeText("data:image/png;base64," + base64.StdEncoding.EncodeToString(png))
	if err != nil {
		t.Fatal(err)
	}
	if result.Width != 1200 || result.Height != 400 {
		t.Fatalf("wrong source dimensions: %+v", result)
	}
	for _, expected := range []string{"CIIP OCR 2026", "截图文字识别", "繁體中文測試"} {
		if !strings.Contains(strings.ReplaceAll(result.Text, " ", ""), strings.ReplaceAll(expected, " ", "")) {
			t.Fatalf("Vision did not recognize %q: %q", expected, result.Text)
		}
	}
	for _, line := range result.Lines {
		if line.X < 0 || line.Y < 0 || line.W <= 0 || line.H <= 0 || line.X+line.W > 1200.01 || line.Y+line.H > 400.01 {
			t.Fatalf("invalid source pixel box: %+v", line)
		}
		if strings.Contains(line.Text, "2026") && (line.X < 35 || line.X > 70 || line.Y < 25 || line.Y > 100) {
			t.Fatalf("top line should be near the top-left fixture text, got %+v", line)
		}
	}
	t.Logf("Vision OCR: %q; boxes: %+v", result.Text, result.Lines)
}

func TestVisionOCRNoText(t *testing.T) {
	blank := image.NewRGBA(image.Rect(0, 0, 640, 360))
	draw.Draw(blank, blank.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, blank); err != nil {
		t.Fatal(err)
	}
	result, err := (&CaptureService{}).RecognizeText("data:image/png;base64," + base64.StdEncoding.EncodeToString(buffer.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "" || len(result.Lines) != 0 || result.Lines == nil {
		t.Fatalf("blank image should return an empty array and text: %+v", result)
	}
}

func TestVisionFastMode(t *testing.T) {
	raw, err := os.ReadFile("testdata/ocr-multilingual.png")
	if err != nil {
		t.Fatal(err)
	}
	service := &CaptureService{settingsState: settingsState{preferences: defaultPreferences()}}
	service.preferences.OCRMode = "fast"
	result, err := service.RecognizeText("data:image/png;base64," + base64.StdEncoding.EncodeToString(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Text, "2026") {
		t.Fatalf("fast mode did not recognize fixture year: %q", result.Text)
	}
}
