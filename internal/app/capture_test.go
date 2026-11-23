package app

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func testPNG(t *testing.T) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	im.SetNRGBA(1, 1, color.NRGBA{R: 255, A: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestImageValidationAndRoundTrip(t *testing.T) {
	raw := testPNG(t)
	img, pngBytes, err := imageData(raw, "../example.png")
	if err != nil {
		t.Fatal(err)
	}
	if img.Width != 3 || img.Height != 2 || img.Name != "example.png" {
		t.Fatalf("unexpected image: %+v", img)
	}
	decoded, _, err := decodeImageURL(img.DataURL)
	if err != nil || !bytes.Equal(decoded, pngBytes) {
		t.Fatalf("PNG round trip: %v", err)
	}
	for _, value := range []string{"", "data:text/html;base64,PHNjcmlwdD4=", "data:image/png;base64,broken", "data:image/png;base64," + base64.StdEncoding.EncodeToString(raw[:len(raw)/2])} {
		if _, _, err := decodeImageURL(value); err == nil {
			t.Fatalf("accepted malformed image %q", value)
		}
	}
}

func TestCaptureArguments(t *testing.T) {
	for _, mode := range []string{"area; rm -rf /", "measure"} {
		if _, err := captureArguments(mode); err == nil {
			t.Fatalf("invalid capture mode accepted: %q", mode)
		}
	}
	for _, mode := range []string{"area", "window", "element", "screen"} {
		want := []string{"-x", "-t", "png"}
		if mode == "screen" {
			want = append(want, "-m")
		}
		if args, err := captureArguments(mode); err != nil || !slices.Equal(args, want) {
			t.Fatalf("%s arguments = %v, %v; want %v", mode, args, err, want)
		}
	}
}

func TestAtomicSaveAndPinBounds(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shot.png")
	if err := writeImageAtomically(path, []byte("old")); err != nil {
		t.Fatal(err)
	}
	raw := testPNG(t)
	if err := writeImageAtomically(path, raw); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, raw) {
		t.Fatalf("save mismatch: %v", err)
	}
	for _, size := range [][2]int{{1920, 1080}, {400, 2200}, {10000, 10}, {20, 20}} {
		w, h := fitPinSize(size[0], size[1], 800, 600, 2)
		if w < 1 || w > 800 || h < 1 || h > 600 || max(w, h) < 120 {
			t.Fatalf("pin outside bounds: %dx%d", w, h)
		}
	}
}
