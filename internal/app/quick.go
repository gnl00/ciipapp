package app

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"ciip/frontend"

	"github.com/egoist/mygo"
)

type quickState struct {
	quickMu       sync.Mutex
	quick         *quickSession
	preparedQuick *quickSession
	quickSequence atomic.Uint64
}
type quickSession struct {
	window         *mygo.Window
	image          *ImageData
	placement      QuickPlacement
	token          string
	transferToken  string
	ready          bool
	captureReady   chan struct{}
	motionDuration float64
	motionCurve    [4]float64
}
type QuickCapture struct {
	Image         *ImageData     `json:"image"`
	Placement     QuickPlacement `json:"placement"`
	DoubleClickMS int            `json:"doubleClickMS"`
}

func (s *CaptureService) hasQuickEditor() bool {
	s.quickMu.Lock()
	defer s.quickMu.Unlock()
	return s.quick != nil
}
func (s *CaptureService) focusQuickEditor() bool {
	s.quickMu.Lock()
	current := s.quick
	transferring := current != nil && current.transferToken != ""
	ready := current != nil && current.ready
	preparing := s.preparedQuick != nil
	s.quickMu.Unlock()
	if current == nil || transferring {
		return preparing
	}
	// Reopen/activation may arrive while the new WebView is still loading.
	// Let QuickReady reveal it after the image has painted.
	if !ready {
		return true
	}
	current.window.Show()
	current.window.Focus()
	return true
}

// Start loading the hidden editor while the user chooses a capture. No document
// or editor commands belong to this window until presentQuick supplies the image.
func (s *CaptureService) prepareQuick() error {
	s.quickMu.Lock()
	if s.quick != nil {
		s.quickMu.Unlock()
		return errors.New("请先完成当前快捷编辑，或按 Esc 关闭后重新截图")
	}
	if s.preparedQuick != nil {
		s.quickMu.Unlock()
		return nil
	}
	s.quickMu.Unlock()
	duration, curve, err := nativePanelMotion(frontend.TokensCSS, "--motion-panel-in")
	if err != nil {
		return err
	}
	token := fmt.Sprint(s.quickSequence.Add(1))
	win := mygo.NewWindow(mygo.WindowOptions{
		Title: "ciip 快捷编辑", URL: "about:blank", Width: quickMinWidth, Height: quickMinHeight,
		MinWidth: 1, MinHeight: 1, Frameless: true, Panel: true, AlwaysOnTop: true, Hidden: true, Transparent: true,
		DisableShadow: true, DisableMaximize: true, DisableFullScreen: true, SkipTaskbar: true,
	})
	maintainQuickMaterial(win)
	current := &quickSession{window: win, token: token, captureReady: make(chan struct{}), motionDuration: duration, motionCurve: curve}
	s.quickMu.Lock()
	if s.quick != nil || s.preparedQuick != nil {
		s.quickMu.Unlock()
		win.Destroy()
		return errors.New("截图编辑器已改变")
	}
	s.preparedQuick = current
	s.quickMu.Unlock()
	win.OnClosed(func() {
		s.detachPreparedQuick(token)
		if current := s.detachQuickSession(token); current != nil {
			go func() { s.EndShortcutRecording(); s.abortQuickTransfer(current.transferToken) }()
		}
	})
	win.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
		if e.URL != "about:blank" && e.URL != "mygo://localhost/?mode=quick" && e.URL != "mygo://localhost/index.html?mode=quick" {
			e.PreventDefault()
		}
	})
	// Register the session before page JavaScript can request its capture.
	if err := win.Page().LoadURL("/?mode=quick"); err != nil {
		s.detachPreparedQuick(token)
		win.Destroy()
		return err
	}
	return nil
}

func (s *quickState) detachPreparedQuick(token string) *quickSession {
	s.quickMu.Lock()
	defer s.quickMu.Unlock()
	current := s.preparedQuick
	if current == nil || (token != "" && current.token != token) {
		return nil
	}
	s.preparedQuick = nil
	if current.captureReady != nil {
		close(current.captureReady)
		current.captureReady = nil
	}
	return current
}
func (s *CaptureService) discardPreparedQuick() {
	if current := s.detachPreparedQuick(""); current != nil {
		current.window.Destroy()
	}
}
func (s *CaptureService) presentQuick(image *ImageData, placement QuickPlacement) error {
	if err := s.prepareQuick(); err != nil {
		return err
	}
	s.quickMu.Lock()
	current := s.preparedQuick
	s.quickMu.Unlock()
	if current == nil {
		return errors.New("快捷编辑已关闭")
	}
	current.window.SetMinimumSize(min(quickMinWidth, placement.Panel.Width), min(quickMinHeight, placement.Panel.Height))
	current.window.SetBounds(placement.Panel)
	if !s.publishQuickCapture(current, image, placement) {
		return errors.New("快捷编辑已关闭")
	}
	token := current.token
	time.AfterFunc(12*time.Second, func() {
		s.quickMu.Lock()
		current := s.quick
		if current == nil || current.token != token || current.ready {
			s.quickMu.Unlock()
			return
		}
		s.quick = nil
		s.quickMu.Unlock()
		s.EndShortcutRecording()
		current.window.Destroy()
		s.showEditor()
		s.emit("ciip:image", current.image)
		s.report(errors.New("快捷编辑加载超时，已转到完整编辑器"))
	})
	return nil
}

// Publish only after native bounds have been applied; cancellation may have
// detached this prepared window while the main-thread operation was queued.
func (s *quickState) publishQuickCapture(current *quickSession, image *ImageData, placement QuickPlacement) bool {
	s.quickMu.Lock()
	defer s.quickMu.Unlock()
	if current == nil || s.preparedQuick != current || s.quick != nil {
		return false
	}
	current.image = image
	current.placement = placement
	s.preparedQuick = nil
	s.quick = current
	if current.captureReady != nil {
		close(current.captureReady)
		current.captureReady = nil
	}
	return true
}
func (s *CaptureService) callerQuick(ctx context.Context) (*quickSession, error) {
	s.quickMu.Lock()
	defer s.quickMu.Unlock()
	if s.quick == nil || mygo.CallerWindow(ctx) != s.quick.window {
		return nil, errors.New("快捷编辑已关闭")
	}
	return s.quick, nil
}
func (s *CaptureService) GetQuickCapture(ctx context.Context) (QuickCapture, error) {
	capture, err := s.quickCapture(ctx, mygo.CallerWindow(ctx))
	if err == nil {
		capture.DoubleClickMS = nativeDoubleClickMilliseconds()
	}
	return capture, err
}
func (s *CaptureService) quickCapture(ctx context.Context, caller *mygo.Window) (QuickCapture, error) {
	if err := ctx.Err(); err != nil {
		return QuickCapture{}, err
	}
	s.quickMu.Lock()
	current := s.quick
	if current == nil || current.window != caller {
		current = s.preparedQuick
	}
	if caller == nil || current == nil || current.window != caller {
		s.quickMu.Unlock()
		return QuickCapture{}, errors.New("快捷编辑已关闭")
	}
	wait := current.captureReady
	s.quickMu.Unlock()
	if wait != nil {
		select {
		case <-wait:
		case <-ctx.Done():
			return QuickCapture{}, ctx.Err()
		}
	}
	if err := ctx.Err(); err != nil {
		return QuickCapture{}, err
	}
	s.quickMu.Lock()
	defer s.quickMu.Unlock()
	if s.quick != current || current.image == nil {
		return QuickCapture{}, errors.New("快捷编辑已关闭")
	}
	return QuickCapture{Image: current.image, Placement: current.placement}, nil
}

func (s *CaptureService) GetQuickBounds(ctx context.Context) (ScreenRect, error) {
	current, err := s.callerQuick(ctx)
	if err != nil {
		return ScreenRect{}, err
	}
	return screenRectangle(current.window.Bounds()), nil
}

func (s *CaptureService) TransformQuickWindow(ctx context.Context, initial ScreenRect, edge string, dx, dy float64) (ScreenRect, error) {
	current, err := s.callerQuick(ctx)
	if err != nil {
		return ScreenRect{}, err
	}
	s.quickMu.Lock()
	available := s.quick == current && current.transferToken == ""
	s.quickMu.Unlock()
	if !available {
		return ScreenRect{}, errors.New("快捷编辑正在切换或已关闭")
	}
	var work mygo.Rectangle
	if edge != "move" {
		work = mygo.Screen.DisplayMatching(current.window.Bounds()).WorkArea
	}
	next, err := transformQuickBounds(initial, edge, dx, dy, work)
	if err != nil {
		return ScreenRect{}, err
	}
	current.window.SetBounds(mygo.Rectangle{X: int(next.X), Y: int(next.Y), Width: int(next.Width), Height: int(next.Height)})
	return screenRectangle(current.window.Bounds()), nil
}
func (s *CaptureService) QuickReady(ctx context.Context) error {
	current, err := s.callerQuick(ctx)
	if err != nil {
		return err
	}
	s.quickMu.Lock()
	if s.quick != current {
		s.quickMu.Unlock()
		return errors.New("快捷编辑已关闭")
	}
	if current.ready {
		s.quickMu.Unlock()
		return nil
	}
	current.ready = true
	s.quickMu.Unlock()
	showQuickWindow(current.window, current.motionDuration, current.motionCurve)
	return nil
}
func (s *CaptureService) CloseQuick(ctx context.Context) error {
	current, err := s.callerQuick(ctx)
	if err != nil {
		return err
	}
	s.closeQuick(current.token)
	return nil
}

// Detach before calling native APIs so UI callbacks never wait on quickMu.
func (s *quickState) detachQuickSession(token string) *quickSession {
	s.quickMu.Lock()
	defer s.quickMu.Unlock()
	current := s.quick
	if current == nil || current.token != token {
		return nil
	}
	s.quick = nil
	return current
}

func (s *CaptureService) closeQuick(token string) {
	current := s.detachQuickSession(token)
	if current == nil {
		return
	}
	s.EndShortcutRecording()
	s.abortQuickTransfer(current.transferToken)
	current.window.Destroy()
}

// Transfer acknowledgements are scoped to one attempt, not the quick session.
func (s *quickSession) beginTransfer(token string) bool {
	if token == "" || s.transferToken != "" {
		return false
	}
	s.transferToken = token
	return true
}

func (s *quickSession) endTransfer(token string) bool {
	if token == "" || s.transferToken != token {
		return false
	}
	s.transferToken = ""
	return true
}

func (s *CaptureService) abortQuickTransfer(token string) {
	if token != "" {
		s.emit("ciip:quick-transfer-abort", map[string]string{"token": token})
	}
}

// Called after the native editor has hidden, outside its main-thread close callback.
func (s *CaptureService) cancelQuickTransfer() {
	s.quickMu.Lock()
	current := s.quick
	if current == nil || current.transferToken == "" {
		s.quickMu.Unlock()
		return
	}
	token := current.transferToken
	current.endTransfer(token)
	s.quickMu.Unlock()
	s.abortQuickTransfer(token)
	current.window.Show()
	current.window.Focus()
	s.emitWindow(current.window, "ciip:quick-transfer-cancelled", nil)
}

func (s *CaptureService) OpenQuickInEditor(ctx context.Context, documentJSON string) error {
	if err := validDocument(documentJSON); err != nil {
		return err
	}
	current, err := s.callerQuick(ctx)
	if err != nil {
		return err
	}
	s.quickMu.Lock()
	transferToken := fmt.Sprintf("%s-%d", current.token, s.quickSequence.Add(1))
	if s.quick != current || !current.beginTransfer(transferToken) {
		s.quickMu.Unlock()
		return errors.New("正在打开完整编辑器")
	}
	s.quickMu.Unlock()
	mygo.RunOnMain(func() {
		current.window.Hide()
		s.showEditor()
	})
	s.emit("ciip:quick-document", map[string]string{"documentJSON": documentJSON, "token": transferToken})
	return nil
}
func (s *CaptureService) FinishQuickTransfer(ctx context.Context, token string, accepted bool) error {
	if mygo.CallerWindow(ctx) != s.editor {
		return errors.New("只能由完整编辑器确认接收")
	}
	s.quickMu.Lock()
	current := s.quick
	if current == nil || !current.endTransfer(token) {
		s.quickMu.Unlock()
		return nil
	}
	if accepted {
		s.quick = nil
	}
	s.quickMu.Unlock()
	if accepted {
		s.EndShortcutRecording()
		current.window.Destroy()
	} else {
		s.dismissEditor()
		current.window.Show()
		current.window.Focus()
		s.emitWindow(current.window, "ciip:quick-transfer-cancelled", nil)
	}
	return nil
}
func (s *CaptureService) emitActive(name string, payload any) {
	window := s.activeEditorWindow()
	if window == s.editor {
		s.emit(name, payload)
		return
	}
	s.emitWindow(window, name, payload)
}

// Commands follow the quick document until it is handed to the full editor.
// Resolve the target under the lock, then call native APIs after releasing it.
func (s *CaptureService) activeEditorWindow() *mygo.Window {
	s.quickMu.Lock()
	defer s.quickMu.Unlock()
	if s.quick != nil && s.quick.transferToken == "" {
		return s.quick.window
	}
	return s.editor
}
func (s *CaptureService) PinCurrent() { s.emitActive("ciip:pin", nil) }

func (s *CaptureService) requestOpenImage() {
	window := s.activeEditorWindow()
	if window == nil {
		return
	}
	if window == s.editor {
		s.showEditor()
		s.emit("ciip:open", nil)
	} else {
		window.Show()
		window.Focus()
		s.emitWindow(window, "ciip:open", nil)
	}
}

func (s *CaptureService) ShowEditor() {
	window := s.activeEditorWindow()
	if window != nil && window != s.editor {
		window.Show()
		window.Focus()
		s.emitWindow(window, "ciip:quick-open-editor", nil)
		return
	}
	s.showEditor()
}
