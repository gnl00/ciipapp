package app

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPreferencesRoundTripAndInvalidValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app", "preferences.json")
	want := defaultPreferences()
	got, err := readPreferences(path)
	if err != nil || got != want {
		t.Fatalf("defaults: %#v, %v", got, err)
	}
	want.MenuBarVisible = false
	want.MenuBarStyle = "text"
	want.MenuBarIcon = "wordmark"
	want.OCREngine = "tesseract"
	want.OCRMode = "fast"
	want.CaptureMode = "editor"
	want.Shortcuts.Window = "Ctrl+Alt+W"
	want.Shortcuts.Pin = ""
	if err := savePreferences(path, want); err != nil {
		t.Fatal(err)
	}
	got, err = readPreferences(path)
	if err != nil || got != want {
		t.Fatalf("saved: %#v, %v", got, err)
	}
	for _, change := range []func(*Preferences){func(p *Preferences) { p.MenuBarStyle = "unknown" }, func(p *Preferences) { p.MenuBarIcon = "unknown" }, func(p *Preferences) { p.OCREngine = "cloud" }, func(p *Preferences) { p.OCRMode = "unknown" }, func(p *Preferences) { p.CaptureMode = "unknown" }, func(p *Preferences) { p.Shortcuts.Pin = "P" }} {
		p := defaultPreferences()
		change(&p)
		if validatePreferences(p) == nil {
			t.Fatal("invalid setting accepted")
		}
	}
	if err = os.WriteFile(path, []byte(`{"ocrEngine":"invalid"}`), 0600); err != nil {
		t.Fatal(err)
	}
	got, err = readPreferences(path)
	if err == nil || got != defaultPreferences() {
		t.Fatal("corrupt prefs must return defaults and an error")
	}
}
func TestMenuBarIconOptionsRoundTrip(t *testing.T) {
	for _, icon := range []string{"capture", "pin", "wordmark", "ligature"} {
		t.Run(icon, func(t *testing.T) {
			preferences := defaultPreferences()
			preferences.MenuBarIcon = icon
			if err := validatePreferences(preferences); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "preferences.json")
			if err := savePreferences(path, preferences); err != nil {
				t.Fatal(err)
			}
			got, err := readPreferences(path)
			if err != nil || got.MenuBarIcon != icon {
				t.Fatalf("icon preference changed: %#v, %v", got, err)
			}
		})
	}
	if defaultPreferences().MenuBarIcon != "capture" {
		t.Fatal("adding a ligature must not replace the default icon")
	}
	path := filepath.Join(t.TempDir(), "preferences.json")
	if err := os.WriteFile(path, []byte(`{"menuBarIcon":"future-icon"}`), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := readPreferences(path)
	if err == nil || got.MenuBarIcon != "capture" {
		t.Fatalf("unknown icons must retain the defaults fallback: %#v, %v", got, err)
	}
}
func TestTesseractTSVReturnsSelectablePixelLines(t *testing.T) {
	data := "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
		"5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t90\tHello\n" +
		"5\t1\t1\t1\t1\t2\t46\t18\t70\t18\t88\tworld\n" +
		"5\t1\t1\t1\t2\t1\t20\t60\t30\t12\t90\t截图\n"
	result, err := parseTesseractTSV([]byte(data), 100, 80)
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "Hello world\n截图" || len(result.Lines) != 2 {
		t.Fatalf("lines: %#v", result)
	}
	first := result.Lines[0]
	if first.X != 10 || first.Y != 18 || first.W != 90 || first.H != 18 {
		t.Fatalf("merged bounds: %#v", first)
	}
	if _, err = parseTesseractTSV([]byte(strings.Replace(data, "\t46\t18\t", "\t-1\t18\t", 1)), 100, 80); err == nil {
		t.Fatal("negative coordinates accepted")
	}
	if _, err = parseTesseractTSV([]byte("garbage"), 100, 80); err == nil {
		t.Fatal("invalid output accepted")
	}
}
func TestBoundedOCRProcessOutput(t *testing.T) {
	out := boundedOutput{limit: 4}
	if _, err := out.Write([]byte("abcd")); err != nil {
		t.Fatal(err)
	}
	if _, err := out.Write([]byte("e")); err == nil || out.String() != "abcd" {
		t.Fatal("OCR output was not bounded")
	}
	stream := boundedOutput{limit: 4}
	if _, err := io.Copy(&stream, io.LimitReader(strings.NewReader("abcde"), 5)); err == nil || len(stream.Bytes()) > 4 {
		t.Fatal("streamed process output bypassed the limit")
	}
}

func TestTesseractTSVPreservesLiteralQuotesAndRows(t *testing.T) {
	data := "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
		"5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t90\t\"Hello\n" +
		"5\t1\t1\t1\t1\t2\t46\t20\t30\t12\t88\tworld\"\n" +
		"5\t1\t1\t1\t2\t1\t20\t60\t30\t12\t90\t\"截图\"\n"
	result, err := parseTesseractTSV([]byte(data), 100, 80)
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "\"Hello world\"\n\"截图\"" || len(result.Lines) != 2 {
		t.Fatalf("literal quotes or line boundaries were lost: %#v", result)
	}
}
