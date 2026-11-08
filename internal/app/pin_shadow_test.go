package app

import (
	"context"
	"testing"

	"github.com/egoist/mygo"
)

func TestPinShadowRejectsMissingOrForeignCaller(t *testing.T) {
	service := &CaptureService{pins: map[string]*pinnedImage{"existing": {window: &mygo.Window{}}}}
	for _, id := range []string{"existing", "closed"} {
		if err := service.RefreshPinShadow(context.Background(), id); err == nil {
			t.Fatalf("non-pin caller refreshed shadow for %q", id)
		}
	}
}
