package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"log"
	"sync/atomic"
	"time"

	"ciip/frontend"

	"github.com/egoist/mygo"
)

func Run() error {
	mygo.App.SetName("ciip")
	mygo.App.SetVersion(Version)
	mygo.Theme.SetSource(mygo.ThemeLight)
	mygo.SetFrontend(frontend.Files)
	service := &CaptureService{pins: make(map[string]*pinnedImage), editorReady: make(chan struct{})}
	if err := service.initializePreferences(); err != nil {
		log.Printf("settings: %v", err)
	}
	mygo.Bind(service)
	if !mygo.App.RequestSingleInstanceLock() {
		return nil
	}
	mygo.App.OnSecondInstance(func([]string, string) {
		if !service.focusQuickEditor() {
			service.showEditor()
		}
	})
	var quitting atomic.Bool
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { quitting.Store(true) })
	mygo.App.OnActivate(func(bool) {
		if !service.focusQuickEditor() {
			service.showEditor()
		}
	})
	mygo.App.WhenReady(func() {
		trafficLights := mygo.Point{X: 20, Y: 22}
		service.editor = mygo.NewWindow(mygo.WindowOptions{
			Title: "ciip", URL: "/", Width: 1120, Height: 760,
			MinWidth: 840, MinHeight: 540,
			Hidden:        !service.preferences.ShowEditorOnLaunch && service.preferences.MenuBarVisible,
			TitleBarStyle: mygo.TitleBarHidden,
			// AppKit's button frame is 14×16 pt; (20,22) centers it in the 60 pt toolbar.
			TrafficLightPosition: &trafficLights,
			Transparent:          true,
			Vibrancy:             mygo.VibrancySidebar,
		})
		maintainEditorChrome(service.editor, trafficLights)
		service.editor.OnClose(func(e *mygo.CloseEvent) {
			if !quitting.Load() {
				e.PreventDefault()
				service.editor.Hide()
				go func() {
					service.EndShortcutRecording()
					service.cancelQuickTransfer()
					service.restoreEditingPins()
				}()
			}
		})
		service.editor.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
			// Only bundled app pages may retain access to desktop methods.
			if e.URL != "mygo://localhost/" && e.URL != "mygo://localhost/index.html" {
				e.PreventDefault()
			}
		})
		capture := func(mode string) func(*mygo.MenuItem, *mygo.Window) {
			return func(*mygo.MenuItem, *mygo.Window) { go service.captureAndNotify(mode) }
		}
		openImage := func(*mygo.MenuItem, *mygo.Window) {
			go service.requestOpenImage()
		}
		editAction := func(name string) func(*mygo.MenuItem, *mygo.Window) {
			return func(*mygo.MenuItem, *mygo.Window) { go service.emitActive(name, nil) }
		}
		mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
			{Label: "ciip", Submenu: []*mygo.MenuItem{
				{Label: "设置…", Accelerator: "CmdOrCtrl+,", Click: func(*mygo.MenuItem, *mygo.Window) { go service.showSettings("general") }},
				{Label: "权限引导…", Click: func(*mygo.MenuItem, *mygo.Window) { go service.ShowPermissionGuide() }},
				mygo.Separator(), {Role: mygo.RoleServices}, mygo.Separator(),
				{Role: mygo.RoleHide}, {Role: mygo.RoleHideOthers}, {Role: mygo.RoleUnhide}, mygo.Separator(), {Role: mygo.RoleQuit},
			}},
			{Label: "文件", Submenu: []*mygo.MenuItem{
				{Label: "区域截图", Click: capture("area")},
				{Label: "窗口截图", Click: capture("window")},
				{Label: "元素截图", Click: capture("element")},
				{Label: "全屏截图", Click: capture("screen")},
				mygo.Separator(), {Label: "打开图片…", Click: openImage},
				{Label: "保存图片…", Click: editAction("ciip:save")},
				{Role: mygo.RoleClose},
			}},
			{Label: "编辑", Submenu: []*mygo.MenuItem{
				{Label: "撤销标注", Click: editAction("ciip:undo")},
				{Label: "重做标注", Click: editAction("ciip:redo")},
				mygo.Separator(), {Label: "复制图片", Click: editAction("ciip:copy")},
				{Label: "贴图", Click: func(*mygo.MenuItem, *mygo.Window) { go service.PinCurrent() }},
				mygo.Separator(),
				{Role: mygo.RoleCut},
				{Role: mygo.RolePaste},
				{Role: mygo.RoleSelectAll},
			}}, {Role: mygo.RoleWindowMenu},
		}))
		if err := service.applyTray(service.preferences); err != nil {
			log.Printf("tray: %v", err)
		}
		service.initializeShortcuts()
	})
	return mygo.App.Run()
}

func (s *CaptureService) showEditor() {
	if s.editor != nil {
		s.editor.Show()
		s.editor.Focus()
	}
}

func (s *CaptureService) CloseEditor(ctx context.Context) error {
	if caller := mygo.CallerWindow(ctx); caller == nil || caller != s.editor {
		return errors.New("当前调用不是完整编辑器")
	}
	// Use the normal close handler to retain the document and restore edited pins.
	s.editor.Close()
	return nil
}

func (s *CaptureService) emit(name string, payload any) {
	if s.editor == nil {
		return
	}
	if s.editorReady != nil {
		select {
		case <-s.editorReady:
		case <-time.After(5 * time.Second):
			log.Printf("editor not ready for %s", name)
			return
		}
	}
	s.emitWindow(s.editor, name, payload)
}

func (s *CaptureService) emitWindow(window *mygo.Window, name string, payload any) {
	if window == nil || window.IsDestroyed() {
		return
	}
	n, _ := json.Marshal(name)
	p, err := json.Marshal(payload)
	if err != nil {
		log.Print(err)
		return
	}
	_, err = window.Page().Eval("window.dispatchEvent(new CustomEvent(" + string(n) + ",{detail:" + string(p) + "}))")
	if err != nil {
		log.Printf("editor event: %v", err)
	}
}

func (s *CaptureService) report(err error) {
	s.emitActive("ciip:error", map[string]string{"message": err.Error()})
}

func (s *CaptureService) captureAndNotify(mode string) {
	img, err := s.Capture(context.Background(), mode)
	if err != nil {
		if !s.focusQuickEditor() {
			s.showEditor()
		}
		s.report(err)
		return
	}
	if img != nil {
		s.emit("ciip:image", img)
	}
}

func trayPNG() []byte {
	im := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	ink := color.NRGBA{A: 255}
	for y := 5; y < 27; y++ {
		for x := 5; x < 27; x++ {
			if (x < 8 || x >= 24) && (y < 13 || y >= 19) || (y < 8 || y >= 24) && (x < 13 || x >= 19) {
				im.SetNRGBA(x, y, ink)
			}
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, im)
	return b.Bytes()
}
