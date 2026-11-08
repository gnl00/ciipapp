package app

import (
	"encoding/json"
	"math"
	"testing"
)

func TestOCRPixelCoordinates(t *testing.T) {
	result := ocrPixelResult(1000, 500, []OCRLine{
		{Text: " top line ", X: .1, Y: .7, W: .5, H: .1},
		{Text: "clipped", X: -.1, Y: -.1, W: .3, H: .3},
		{Text: " ", W: 1, H: 1},
	})
	if len(result.Lines) != 2 || result.Text != "top line\nclipped" {
		t.Fatalf("unexpected result: %+v", result)
	}
	line := result.Lines[0]
	if math.Abs(line.X-100) > .001 || math.Abs(line.Y-100) > .001 || math.Abs(line.W-500) > .001 || math.Abs(line.H-50) > .001 {
		t.Fatalf("wrong top-left pixel coordinates: %+v", line)
	}
	line = result.Lines[1]
	if line.X != 0 || math.Abs(line.Y-400) > .001 || math.Abs(line.W-200) > .001 || math.Abs(line.H-100) > .001 {
		t.Fatalf("out-of-image box not clipped: %+v", line)
	}
	empty, err := json.Marshal(ocrPixelResult(100, 200, nil))
	if err != nil || string(empty) != `{"width":100,"height":200,"lines":[],"text":""}` {
		t.Fatalf("empty result must have an array: %s, %v", empty, err)
	}
}

func TestOCRRejectsInvalidInputAndConcurrentWork(t *testing.T) {
	s := &CaptureService{}
	if _, err := s.RecognizeText("data:image/png;base64,broken"); err == nil {
		t.Fatal("malformed image accepted")
	}
	ocrMu.Lock()
	_, err := s.RecognizeText("")
	ocrMu.Unlock()
	if err == nil || err.Error() != "已有文字识别正在进行，请稍候" {
		t.Fatalf("concurrent request not rejected: %v", err)
	}
	for _, value := range []string{"", "  \n", string([]byte{0xff})} {
		if err := s.CopyText(value); err == nil {
			t.Fatal("invalid text accepted")
		}
	}
}
