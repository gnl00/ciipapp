package app

import (
	"context"
	"testing"
)

func TestCloseEditorRejectsCallsWithoutAnEditorWindow(t *testing.T) {
	service := &CaptureService{}
	if err := service.CloseEditor(context.Background()); err == nil {
		t.Fatal("a call outside the editor must not close a window")
	}
}
