package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

const maxOCRPixels = 24_000_000

var ocrMu sync.Mutex

type OCRLine struct {
	Text string  `json:"text"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	W    float64 `json:"w"`
	H    float64 `json:"h"`
}

type OCRResult struct {
	Width  int       `json:"width"`
	Height int       `json:"height"`
	Lines  []OCRLine `json:"lines"`
	Text   string    `json:"text"`
}

func (s *CaptureService) RecognizeText(dataURL string) (*OCRResult, error) {
	if !ocrMu.TryLock() {
		return nil, errors.New("已有文字识别正在进行，请稍候")
	}
	defer ocrMu.Unlock()
	raw, img, err := decodeImageURL(dataURL)
	if err != nil {
		return nil, err
	}
	if int64(img.Width)*int64(img.Height) > maxOCRPixels {
		return nil, errors.New("文字识别最多支持 2400 万像素，请先裁剪图片")
	}
	prefs := s.preferenceSnapshot()
	if prefs.OCREngine == "tesseract" {
		return recognizeTextTesseract(raw, img.Width, img.Height)
	}
	data, err := recognizeTextNativeMode(raw, prefs.OCRMode == "fast")
	if err != nil {
		return nil, fmt.Errorf("文字识别失败：%w", err)
	}
	var lines []OCRLine
	if err := json.Unmarshal(data, &lines); err != nil {
		return nil, fmt.Errorf("无法读取文字识别结果：%w", err)
	}
	return ocrPixelResult(img.Width, img.Height, lines), nil
}

func ocrPixelResult(width, height int, lines []OCRLine) *OCRResult {
	result := &OCRResult{Width: width, Height: height, Lines: make([]OCRLine, 0, len(lines))}
	text := make([]string, 0, len(lines))
	for _, line := range lines {
		line.Text = strings.TrimSpace(line.Text)
		if line.Text == "" || line.W <= 0 || line.H <= 0 {
			continue
		}
		// Vision uses normalized lower-left coordinates; the editor uses image pixels from the top left.
		x1, x2 := math.Max(0, math.Min(1, line.X)), math.Max(0, math.Min(1, line.X+line.W))
		y1, y2 := math.Max(0, math.Min(1, 1-line.Y-line.H)), math.Max(0, math.Min(1, 1-line.Y))
		line.X, line.Y = x1*float64(width), y1*float64(height)
		line.W, line.H = (x2-x1)*float64(width), (y2-y1)*float64(height)
		if line.W <= 0 || line.H <= 0 {
			continue
		}
		result.Lines = append(result.Lines, line)
		text = append(text, line.Text)
	}
	result.Text = strings.Join(text, "\n")
	return result
}

func (s *CaptureService) CopyText(text string) error {
	if !utf8.ValidString(text) || len(text) > 4<<20 {
		return errors.New("文字无效或超过 4 MB")
	}
	if strings.TrimSpace(text) == "" {
		return errors.New("没有可复制的文字")
	}
	return mygo.Clipboard.Write(transfer.TextData(text))
}
