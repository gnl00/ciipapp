package app

import (
	"testing"

	"github.com/egoist/mygo"
)

func TestEditorCommandRoutingFollowsQuickTransfer(t *testing.T) {
	editor, overlay := &mygo.Window{}, &mygo.Window{}
	service := &CaptureService{editor: editor}
	if service.activeEditorWindow() != editor {
		t.Fatal("without quick editing commands must reach the full editor")
	}
	service.quick = &quickSession{window: overlay}
	if service.activeEditorWindow() != overlay {
		t.Fatal("a full-screen quick panel must receive commands instead of covering their target")
	}
	service.quick.beginTransfer("transfer")
	if service.activeEditorWindow() != editor {
		t.Fatal("commands during handoff must reach the visible full editor")
	}
	service.quick.endTransfer("transfer")
	if service.activeEditorWindow() != overlay {
		t.Fatal("cancelled handoff must restore the quick document as command target")
	}
}

func TestQuickLoadingWaitsForReadyBeforeReopen(t *testing.T) {
	// An unready session must be handled without touching its native window.
	service := &CaptureService{quickState: quickState{quick: &quickSession{}}}
	if !service.focusQuickEditor() {
		t.Fatal("a loading quick editor must retain the reopen request until ready")
	}
	service.quick.transferToken = "transfer"
	if service.focusQuickEditor() {
		t.Fatal("a quick editor transferring to the full editor must not handle reopen")
	}
}
