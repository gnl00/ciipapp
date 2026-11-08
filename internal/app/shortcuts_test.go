package app

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestShortcutNormalizationAndDuplicates(t *testing.T) {
	for input, want := range map[string]string{
		"": "", " command + shift + p ": "CmdOrCtrl+Shift+P", "Option+Ctrl+3": "Ctrl+Alt+3", "Cmd+F20": "CmdOrCtrl+F20", "Ctrl+left": "Ctrl+Left", "Cmd+Shift+=": "CmdOrCtrl+Shift+=",
	} {
		got, err := normalizeShortcut(input)
		if err != nil || got != want {
			t.Fatalf("%q: %q / %v", input, got, err)
		}
	}
	for _, input := range []string{"P", "Shift+P", "Cmd+Cmd+P", "Cmd+Shift+", "Cmd+F21", "Cmd+⚡", "Fn+P", strings.Repeat("a", 81)} {
		if _, err := normalizeShortcut(input); err == nil {
			t.Fatalf("accepted invalid shortcut %q", input)
		}
	}
	p := defaultShortcuts()
	p.Window = "command+shift+2"
	if _, err := normalizedShortcuts(p); err == nil {
		t.Fatal("canonical duplicate accepted")
	}
	p.Window, p.Screen, p.Pin = "", "", ""
	if _, err := normalizedShortcuts(p); err != nil {
		t.Fatal("multiple cleared shortcuts rejected", err)
	}
	if shortcutDisplay(defaultShortcuts().Window) != "⌥⌘3" || shortcutDisplay("CmdOrCtrl+Ctrl+Alt+Shift+Left") != "⌃⌥⇧⌘←" {
		t.Fatal("macOS labels are inconsistent")
	}
}
func TestOldPreferencesGainCaptureModeAndShortcutDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prefs.json")
	if err := os.WriteFile(path, []byte(`{"menuBarVisible":false,"ocrMode":"fast"}`), 0600); err != nil {
		t.Fatal(err)
	}
	p, err := readPreferences(path)
	if err != nil || p.MenuBarVisible || p.OCRMode != "fast" || p.CaptureMode != "quick" || p.Shortcuts != defaultShortcuts() {
		t.Fatalf("old preferences: %#v %v", p, err)
	}
	if err := os.WriteFile(path, []byte(`{"shortcuts":{"area":""},"captureMode":"editor"}`), 0600); err != nil {
		t.Fatal(err)
	}
	p, err = readPreferences(path)
	if err != nil || p.Shortcuts.Area != "" || p.Shortcuts.Pin != defaultShortcuts().Pin || p.CaptureMode != "editor" {
		t.Fatalf("partial preferences: %#v %v", p, err)
	}
	p.Shortcuts.Window = "Cmd+shift+2"
	if err := savePreferences(path, p); err != nil {
		t.Fatal(err)
	}
	p, err = readPreferences(path)
	if err != nil || p.Shortcuts.Window != "CmdOrCtrl+Shift+2" {
		t.Fatalf("canonical persisted key: %#v %v", p, err)
	}
}

type fakeShortcutBackend struct {
	active                         map[string]func()
	blocked                        map[string]bool
	registerCalls, unregisterCalls []string
}

func newFakeShortcuts() (*shortcutRegistry, *fakeShortcutBackend) {
	backend := &fakeShortcutBackend{active: map[string]func(){}, blocked: map[string]bool{}}
	register := func(key string, action func()) error {
		backend.registerCalls = append(backend.registerCalls, key)
		if backend.blocked[key] {
			return errors.New("occupied")
		}
		if backend.active[key] != nil {
			return errors.New("already active")
		}
		backend.active[key] = action
		return nil
	}
	unregister := func(key string) {
		backend.unregisterCalls = append(backend.unregisterCalls, key)
		delete(backend.active, key)
	}
	return newShortcutRegistry(register, unregister, map[string]func(){}), backend
}
func checkShortcutBindings(t *testing.T, r *shortcutRegistry, b *fakeShortcutBackend, p ShortcutPreferences) {
	t.Helper()
	for action, key := range p.values() {
		if key == "" {
			continue
		}
		if b.active[key] == nil || !r.status(p)[action].Registered {
			t.Fatalf("%s lost %s", action, key)
		}
	}
}
func TestShortcutRegistrationFailurePreservesAllExistingBindings(t *testing.T) {
	r, b := newFakeShortcuts()
	old := defaultShortcuts()
	r.initialize(old)
	next := old
	next.Area = "Ctrl+Alt+A"
	next.Window = "Ctrl+Alt+W"
	b.blocked[next.Window] = true
	persisted := false
	err := r.replace(next, func() error { persisted = true; return nil })
	if err == nil || persisted || b.active[next.Area] != nil {
		t.Fatalf("failed transaction leaked: %v %v", err, persisted)
	}
	checkShortcutBindings(t, r, b, old)
	if len(b.active) != 4 {
		t.Fatal("unexpected bindings remain", b.active)
	}
}
func TestShortcutPersistenceFailureRollsBackOnlyNewKeys(t *testing.T) {
	r, b := newFakeShortcuts()
	old := defaultShortcuts()
	r.initialize(old)
	next := old
	next.Pin = "Ctrl+Alt+P"
	err := r.replace(next, func() error { return errors.New("disk full") })
	if err == nil || b.active[next.Pin] != nil {
		t.Fatal("save failure lost atomicity")
	}
	checkShortcutBindings(t, r, b, old)
	if !reflect.DeepEqual(b.unregisterCalls, []string{next.Pin}) {
		t.Fatalf("old binding was released before save: %#v", b.unregisterCalls)
	}
}
func TestShortcutSwapAndClearCommitWithoutDroppingSharedKeys(t *testing.T) {
	r, b := newFakeShortcuts()
	old := defaultShortcuts()
	r.initialize(old)
	next := old
	next.Area, next.Window = old.Window, old.Area
	next.Pin = ""
	if err := r.replace(next, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if len(b.registerCalls) != 4 || !reflect.DeepEqual(b.unregisterCalls, []string{old.Pin}) {
		t.Fatal("shared key re-registered during swap")
	}
	checkShortcutBindings(t, r, b, next)
	if r.bindings[old.Area] != "window" || r.bindings[old.Window] != "area" || r.status(next)["pin"].Registered {
		t.Fatal("swap dispatch or cleared status wrong")
	}
}
func TestShortcutStartupConflictDoesNotDisableOtherActionsAndCanRecover(t *testing.T) {
	r, b := newFakeShortcuts()
	p := defaultShortcuts()
	b.blocked[p.Window] = true
	r.initialize(p)
	status := r.status(p)
	if status["window"].Registered || status["window"].Error == "" || !status["area"].Registered || !status["pin"].Registered {
		t.Fatalf("startup conflict status: %#v", status)
	}
	delete(b.blocked, p.Window)
	if err := r.replace(p, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	checkShortcutBindings(t, r, b, p)
	if r.status(p)["window"].Error != "" {
		t.Fatal("recovered key retained stale error")
	}
}
func TestShortcutRecorderTemporarilyReleasesKeysAndReportsRestoreConflict(t *testing.T) {
	r, b := newFakeShortcuts()
	p := defaultShortcuts()
	r.initialize(p)
	r.beginRecording()
	defer r.endRecording()
	if len(b.active) != 0 || !r.recording {
		t.Fatal("recorder did not release global interception")
	}
	if err := r.replace(p, func() error { return nil }); err == nil {
		t.Fatal("binding mutated during recording")
	}
	b.blocked[p.Window] = true
	r.endRecording()
	status := r.status(p)
	if r.recording || !status["pin"].Registered || status["window"].Error == "" || status["window"].Registered {
		t.Fatalf("restore status: %#v", status)
	}
	calls := len(b.registerCalls)
	r.endRecording()
	if len(b.registerCalls) != calls {
		t.Fatal("ending recorder twice re-registered keys")
	}
}
