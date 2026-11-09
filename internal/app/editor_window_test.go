package app

import (
	"context"
	"testing"

	"github.com/egoist/mygo"
)

func TestCloseEditorRejectsCallsWithoutAnEditorWindow(t *testing.T) {
	service := &CaptureService{}
	if err := service.CloseEditor(context.Background()); err == nil {
		t.Fatal("a call outside the editor must not close a window")
	}
}

func TestEditorDockPreservesAReopenEntry(t *testing.T) {
	s := &CaptureService{}
	check := func(state string, expected mygo.ActivationPolicy) {
		t.Helper()
		if policy := s.editorDockPolicy(); policy != expected {
			t.Fatalf("%s: policy %s, want %s", state, policy, expected)
		}
	}
	check("launch without a tray", mygo.ActivationPolicyRegular)
	s.trayAvailable.Store(true)
	check("open editor with a tray", mygo.ActivationPolicyRegular)
	s.editorClosed.Store(true)
	check("closed editor stays in the menu bar", mygo.ActivationPolicyAccessory)
	s.editorClosed.Store(false)
	check("reopened editor returns to the Dock", mygo.ActivationPolicyRegular)
	s.editorClosed.Store(true)
	s.trayAvailable.Store(false)
	check("disabled or failed tray retains the Dock entry", mygo.ActivationPolicyRegular)
	s.trayAvailable.Store(true)
	check("restored tray permits background residence", mygo.ActivationPolicyAccessory)
}
