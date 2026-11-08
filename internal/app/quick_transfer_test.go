package app

import "testing"

func TestQuickTransferAcknowledgementBelongsToOneAttempt(t *testing.T) {
	session := &quickSession{token: "capture-1"}
	if !session.beginTransfer("attempt-1") {
		t.Fatal("first transfer did not start")
	}
	if session.beginTransfer("attempt-2") {
		t.Fatal("a concurrent transfer replaced the active attempt")
	}
	if !session.endTransfer("attempt-1") {
		t.Fatal("cancelled transfer did not release its attempt")
	}
	if !session.beginTransfer("attempt-2") {
		t.Fatal("a new transfer could not start after cancellation")
	}
	if session.endTransfer("attempt-1") {
		t.Fatal("late acknowledgement cancelled the newer transfer")
	}
	if session.transferToken != "attempt-2" {
		t.Fatal("late acknowledgement changed the active token")
	}
	if !session.endTransfer("attempt-2") || session.transferToken != "" {
		t.Fatal("matching acknowledgement did not finish its transfer")
	}
	if session.endTransfer("attempt-2") || session.beginTransfer("") || session.endTransfer("") {
		t.Fatal("duplicate or empty transfer token was accepted")
	}
}

func TestClosingAnOldQuickWindowCannotRemoveItsReplacement(t *testing.T) {
	original := &quickSession{token: "capture-1", transferToken: "attempt-1"}
	state := quickState{quick: original}
	if state.detachQuickSession("stale-capture") != nil || state.quick != original {
		t.Fatal("unrelated close changed the current session")
	}
	if got := state.detachQuickSession(original.token); got != original || state.quick != nil {
		t.Fatal("closing the current session did not detach it")
	}
	if original.transferToken != "attempt-1" {
		t.Fatal("the pending attempt was lost before its abort notification")
	}
	replacement := &quickSession{token: "capture-2"}
	state.quick = replacement
	if state.detachQuickSession(original.token) != nil || state.quick != replacement {
		t.Fatal("late native OnClosed removed the replacement session")
	}
}
