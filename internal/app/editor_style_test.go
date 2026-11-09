package app

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func editorStylePointer[T any](value T) *T { return &value }

func editorStyleService(t *testing.T) *CaptureService {
	t.Helper()
	s := &CaptureService{}
	if err := s.initializeEditorStyle(filepath.Join(t.TempDir(), "app")); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestEditorStyleDefaultsMergeAndRestart(t *testing.T) {
	s := editorStyleService(t)
	defaults := EditorStyle{Color: "#c94632", Stroke: 4, PenStroke: 4, HighlightStroke: 20, HighlightColor: "#e6a32b", ArrowStyle: "line", NumberStyle: "filled", NumberRadius: 16, RedactStyle: "blur", RedactStrength: 12, TextSize: 24}
	if got := s.GetEditorStyle(); got != defaults {
		t.Fatalf("missing file: %#v", got)
	}
	if got := (&CaptureService{}).GetEditorStyle(); got != defaults {
		t.Fatalf("uninitialized service: %#v", got)
	}
	var patch EditorStylePatch
	if err := json.Unmarshal([]byte(`{"color":"#AbC","stroke":8.5,"penStroke":0.5,"highlightStroke":200,"highlightColor":"#c94632","arrowStyle":"curved","numberStyle":"outline","numberRadius":160,"redactStyle":"pixelate","redactStrength":40,"textSize":512}`), &patch); err != nil {
		t.Fatal(err)
	}
	want := EditorStyle{Color: "#AbC", Stroke: 8.5, PenStroke: .5, HighlightStroke: 200, HighlightColor: "#c94632", ArrowStyle: "curved", NumberStyle: "outline", NumberRadius: 160, RedactStyle: "pixelate", RedactStrength: 40, TextSize: 512}
	got, err := s.SetEditorStyle(patch)
	if err != nil || got != want {
		t.Fatalf("full style: %#v, %v", got, err)
	}
	want.Stroke = 12
	got, err = s.SetEditorStyle(EditorStylePatch{Stroke: editorStylePointer(12.)})
	if err != nil || got != want {
		t.Fatalf("partial patch must preserve other fields: %#v, %v", got, err)
	}
	restarted := &CaptureService{}
	if err := restarted.initializeEditorStyle(filepath.Dir(s.editorStylePath)); err != nil {
		t.Fatal(err)
	}
	if got := restarted.GetEditorStyle(); got != want {
		t.Fatalf("restart lost the latest style: %#v", got)
	}
	info, err := os.Stat(s.editorStylePath)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("style file permissions: %v, %v", info, err)
	}
	entries, err := os.ReadDir(filepath.Dir(s.editorStylePath))
	if err != nil || len(entries) != 1 || entries[0].Name() != "editor-style.json" {
		t.Fatalf("save left temporary files: %v, %v", entries, err)
	}
}

func TestEditorStyleConcurrentPatchesKeepAllFields(t *testing.T) {
	s := editorStyleService(t)
	patches := []EditorStylePatch{
		{Color: editorStylePointer("#123456")},
		{Stroke: editorStylePointer(8.)},
		{PenStroke: editorStylePointer(10.)},
		{HighlightStroke: editorStylePointer(28.)},
		{HighlightColor: editorStylePointer("#c94632")},
		{ArrowStyle: editorStylePointer("direction")},
		{NumberStyle: editorStylePointer("outline")},
		{NumberRadius: editorStylePointer(40.)},
		{RedactStyle: editorStylePointer("solid")},
		{RedactStrength: editorStylePointer(18.)},
		{TextSize: editorStylePointer(36.)},
	}
	start := make(chan struct{})
	errors := make(chan error, len(patches))
	var workers sync.WaitGroup
	for _, patch := range patches {
		workers.Go(func() {
			<-start
			_, err := s.SetEditorStyle(patch)
			errors <- err
		})
	}
	workers.Go(func() {
		<-start
		for range len(patches) {
			if err := validateEditorStyle(s.GetEditorStyle()); err != nil {
				t.Error(err)
			}
		}
	})
	close(start)
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	want := EditorStyle{Color: "#123456", Stroke: 8, PenStroke: 10, HighlightStroke: 28, HighlightColor: "#c94632", ArrowStyle: "direction", NumberStyle: "outline", NumberRadius: 40, RedactStyle: "solid", RedactStrength: 18, TextSize: 36}
	if got := s.GetEditorStyle(); got != want {
		t.Fatalf("concurrent patches replaced another control: %#v", got)
	}
	got, err := readEditorStyle(s.editorStylePath)
	if err != nil || got != want {
		t.Fatalf("disk differs from the merged style: %#v, %v", got, err)
	}
}

func TestEditorStyleRejectsInvalidPatchesWithoutChangingMemoryOrDisk(t *testing.T) {
	s := editorStyleService(t)
	want, err := s.SetEditorStyle(EditorStylePatch{Stroke: editorStylePointer(8.)})
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(s.editorStylePath)
	if err != nil {
		t.Fatal(err)
	}
	patches := []EditorStylePatch{
		{Color: editorStylePointer("")}, {Color: editorStylePointer("red")},
		{Color: editorStylePointer("#abcd")}, {Color: editorStylePointer("#12345")},
		{Color: editorStylePointer("#1234567")}, {Color: editorStylePointer("#GGG")},
		{HighlightColor: editorStylePointer("")}, {HighlightColor: editorStylePointer("red")},
		{HighlightColor: editorStylePointer("#abcd")}, {HighlightColor: editorStylePointer("#12345")},
		{HighlightColor: editorStylePointer("#1234567")}, {HighlightColor: editorStylePointer("#GGG")},
		{Stroke: editorStylePointer(.49)}, {Stroke: editorStylePointer(201.)},
		{PenStroke: editorStylePointer(.49)}, {PenStroke: editorStylePointer(201.)},
		{HighlightStroke: editorStylePointer(.49)}, {HighlightStroke: editorStylePointer(201.)},
		{Stroke: editorStylePointer(math.NaN())}, {PenStroke: editorStylePointer(math.Inf(1))},
		{HighlightStroke: editorStylePointer(math.Inf(-1))},
		{ArrowStyle: editorStylePointer("unknown")}, {NumberStyle: editorStylePointer("unknown")},
		{NumberRadius: editorStylePointer(11.)}, {NumberRadius: editorStylePointer(161.)},
		{RedactStyle: editorStylePointer("unknown")},
		{RedactStrength: editorStylePointer(3.)}, {RedactStrength: editorStylePointer(41.)},
		{TextSize: editorStylePointer(7.)}, {TextSize: editorStylePointer(513.)},
		{Color: editorStylePointer("#fff"), TextSize: editorStylePointer(math.NaN())},
	}
	for i, patch := range patches {
		if got, err := s.SetEditorStyle(patch); err == nil || got != want {
			t.Fatalf("invalid patch %d: %#v, %v", i, got, err)
		}
		if got := s.GetEditorStyle(); got != want {
			t.Fatalf("invalid patch %d changed memory: %#v", i, got)
		}
		after, err := os.ReadFile(s.editorStylePath)
		if err != nil || string(after) != string(before) {
			t.Fatalf("invalid patch %d changed disk: %s, %v", i, after, err)
		}
	}
}

func TestEditorStyleAcceptsDocumentCompatibleBoundsAndEnums(t *testing.T) {
	s := editorStyleService(t)
	for _, patch := range []EditorStylePatch{
		{Color: editorStylePointer("#FFF"), HighlightColor: editorStylePointer("#AbC"), Stroke: editorStylePointer(.5), PenStroke: editorStylePointer(.5), HighlightStroke: editorStylePointer(.5), NumberRadius: editorStylePointer(12.), RedactStrength: editorStylePointer(4.), TextSize: editorStylePointer(8.)},
		{Color: editorStylePointer("#aBcD09"), HighlightColor: editorStylePointer("#c94632"), Stroke: editorStylePointer(200.), PenStroke: editorStylePointer(200.), HighlightStroke: editorStylePointer(200.), NumberRadius: editorStylePointer(160.), RedactStrength: editorStylePointer(40.), TextSize: editorStylePointer(512.)},
	} {
		if _, err := s.SetEditorStyle(patch); err != nil {
			t.Fatal(err)
		}
	}
	for _, arrow := range []string{"line", "pointer", "curved", "tapered", "direction"} {
		if _, err := s.SetEditorStyle(EditorStylePatch{ArrowStyle: &arrow}); err != nil {
			t.Fatal(err)
		}
	}
	for _, redact := range []string{"blur", "pixelate", "solid"} {
		if _, err := s.SetEditorStyle(EditorStylePatch{RedactStyle: &redact}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEditorStyleStorageFailurePreservesMemoryAndFile(t *testing.T) {
	for _, failure := range []string{"create", "rename", "uninitialized"} {
		t.Run(failure, func(t *testing.T) {
			s := editorStyleService(t)
			want, err := s.SetEditorStyle(EditorStylePatch{Stroke: editorStylePointer(8.)})
			if err != nil {
				t.Fatal(err)
			}
			path := s.editorStylePath
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			blocked := filepath.Join(filepath.Dir(path), "blocked")
			switch failure {
			case "create":
				if err := os.WriteFile(blocked, []byte("file"), 0600); err != nil {
					t.Fatal(err)
				}
				s.editorStylePath = filepath.Join(blocked, "editor-style.json")
			case "rename":
				if err := os.Mkdir(blocked, 0700); err != nil {
					t.Fatal(err)
				}
				s.editorStylePath = blocked
			case "uninitialized":
				s.editorStylePath = ""
			}
			if got, err := s.SetEditorStyle(EditorStylePatch{Stroke: editorStylePointer(16.)}); err == nil || got != want {
				t.Fatalf("failed save returned a successful style: %#v, %v", got, err)
			}
			if got := s.GetEditorStyle(); got != want {
				t.Fatalf("failed save changed memory: %#v", got)
			}
			after, err := os.ReadFile(path)
			if err != nil || string(after) != string(before) {
				t.Fatalf("failed save changed the previous file: %s, %v", after, err)
			}
			matches, err := filepath.Glob(filepath.Join(filepath.Dir(path), ".*-*"))
			if err != nil || len(matches) != 0 {
				t.Fatalf("failed save left temporary files: %v, %v", matches, err)
			}
		})
	}
}

func TestEditorStyleReadDefaultsAndInvalidFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "editor-style.json")
	if err := os.WriteFile(path, []byte(`{"stroke":8}`), 0600); err != nil {
		t.Fatal(err)
	}
	want := defaultEditorStyle()
	want.Stroke = 8
	if got, err := readEditorStyle(path); err != nil || got != want {
		t.Fatalf("partial file must keep other defaults: %#v, %v", got, err)
	}
	for _, raw := range []string{`{`, `{"stroke":0}`, `{"color":"blue"}`, `{"highlightColor":"blue"}`, `{"textSize":"large"}`, strings.Repeat(" ", 64<<10+1)} {
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if got, err := readEditorStyle(path); err == nil || got != defaultEditorStyle() {
			t.Fatalf("invalid file must restore defaults and report an error: %#v, %v", got, err)
		}
	}
}

func TestEditorStyleAndGeneralPreferencesCannotOverwriteEachOther(t *testing.T) {
	s := editorStyleService(t)
	preferencesPath := filepath.Join(filepath.Dir(s.editorStylePath), "preferences.json")
	preferences := defaultPreferences()
	if err := savePreferences(preferencesPath, preferences); err != nil {
		t.Fatal(err)
	}
	preferencesBefore, err := os.ReadFile(preferencesPath)
	if err != nil {
		t.Fatal(err)
	}
	want, err := s.SetEditorStyle(EditorStylePatch{Stroke: editorStylePointer(8.)})
	if err != nil {
		t.Fatal(err)
	}
	if raw, err := os.ReadFile(preferencesPath); err != nil || string(raw) != string(preferencesBefore) {
		t.Fatalf("style save changed general preferences: %s, %v", raw, err)
	}
	// A settings dialog can save a snapshot obtained before the style update.
	preferences.MenuBarStyle = "text"
	if err := savePreferences(preferencesPath, preferences); err != nil {
		t.Fatal(err)
	}
	if got, err := readEditorStyle(s.editorStylePath); err != nil || got != want {
		t.Fatalf("stale general settings overwrote tool styles: %#v, %v", got, err)
	}
	if got, err := readPreferences(preferencesPath); err != nil || got != preferences {
		t.Fatalf("general settings did not retain their own update: %#v, %v", got, err)
	}
}
