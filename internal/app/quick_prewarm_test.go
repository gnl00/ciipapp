package app

import (
	"context"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

func TestPreparedQuickWaitsForCaptureAndDoesNotOwnEditorCommands(t *testing.T) {
	editor, window := &mygo.Window{}, &mygo.Window{}
	prepared := &quickSession{window: window, token: "prepared", captureReady: make(chan struct{})}
	s := &CaptureService{editor: editor, quickState: quickState{preparedQuick: prepared}}
	if s.hasQuickEditor() || s.activeEditorWindow() != editor || !s.focusQuickEditor() {
		t.Fatal("preloading must not expose a blank editor or take document commands")
	}
	result := make(chan QuickCapture, 1)
	errors := make(chan error, 1)
	go func() { capture, err := s.quickCapture(context.Background(), window); result <- capture; errors <- err }()
	select {
	case <-result:
		t.Fatal("preloading returned an empty screenshot")
	case <-time.After(15 * time.Millisecond):
	}
	image := &ImageData{DataURL: "fixture", Width: 120, Height: 40}
	placement := QuickPlacement{Scale: 2}
	if !s.publishQuickCapture(prepared, image, placement) {
		t.Fatal("prepared window was not activated")
	}
	select {
	case capture := <-result:
		if capture.Image != image || capture.Placement.Scale != 2 || <-errors != nil {
			t.Fatal("capture payload changed during preloading")
		}
	case <-time.After(time.Second):
		t.Fatal("capture did not release the waiting page")
	}
	if s.preparedQuick != nil || !s.hasQuickEditor() || s.activeEditorWindow() != window {
		t.Fatal("published capture did not own editor commands")
	}
}

func TestPreparedQuickCancellationRejectsLatePayloadAndOldCallers(t *testing.T) {
	window := &mygo.Window{}
	prepared := &quickSession{window: window, token: "old", captureReady: make(chan struct{})}
	s := &CaptureService{quickState: quickState{preparedQuick: prepared}}
	result := make(chan error, 1)
	go func() { _, err := s.quickCapture(context.Background(), window); result <- err }()
	if s.detachPreparedQuick("different") != nil || s.detachPreparedQuick("old") != prepared {
		t.Fatal("prepared close must be scoped to its token")
	}
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("cancelled page received a capture")
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled page stayed blocked")
	}
	replacement := &quickSession{window: &mygo.Window{}, token: "new", captureReady: make(chan struct{})}
	s.preparedQuick = replacement
	if s.publishQuickCapture(prepared, &ImageData{}, QuickPlacement{}) || s.detachPreparedQuick("old") != nil {
		t.Fatal("late capture changed replacement")
	}
	if _, err := s.quickCapture(context.Background(), window); err == nil {
		t.Fatal("old page read replacement payload")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.quickCapture(ctx, replacement.window); err != context.Canceled {
		t.Fatal("aborted bridge call did not finish")
	}
	s.detachPreparedQuick("new")
}
