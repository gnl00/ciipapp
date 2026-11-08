package app

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
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

func TestCaptureArgumentsAndCancellation(t *testing.T) {
	if _, err := captureArguments("area; rm -rf /"); err == nil {
		t.Fatal("invalid mode accepted")
	}
	for _, mode := range []string{"area", "window", "screen"} {
		if _, err := captureArguments(mode); err != nil {
			t.Fatal(err)
		}
	}
	exit := exec.Command("/bin/sh", "-c", "exit 1").Run()
	if !captureCanceled(exit, os.ErrNotExist, "", true) {
		t.Fatal("Esc exit should cancel")
	}
	for _, tc := range []struct {
		run, read   error
		stderr      string
		interactive bool
	}{
		{exit, os.ErrNotExist, "could not create image", true},
		{errors.New("cannot start"), os.ErrNotExist, "", true},
		{exit, os.ErrNotExist, "", false},
		{exit, nil, "", true},
	} {
		if captureCanceled(tc.run, tc.read, tc.stderr, tc.interactive) {
			t.Fatal("failure classified as cancellation")
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
