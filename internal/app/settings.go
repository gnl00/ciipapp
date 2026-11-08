package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/egoist/mygo"
)

type Preferences struct {
	OpenAtLogin        bool                `json:"openAtLogin"`
	ShowEditorOnLaunch bool                `json:"showEditorOnLaunch"`
	MenuBarVisible     bool                `json:"menuBarVisible"`
	MenuBarStyle       string              `json:"menuBarStyle"`
	MenuBarIcon        string              `json:"menuBarIcon"`
	OCREngine          string              `json:"ocrEngine"`
	OCRMode            string              `json:"ocrMode"`
	CaptureMode        string              `json:"captureMode"`
	Shortcuts          ShortcutPreferences `json:"shortcuts"`
}

type settingsState struct {
	preferencesMu   sync.Mutex
	preferences     Preferences
	preferencesPath string
	tray            *mygo.Tray
	shortcuts       *shortcutRegistry
}

func defaultPreferences() Preferences {
	return Preferences{ShowEditorOnLaunch: true, MenuBarVisible: true, MenuBarStyle: "icon", MenuBarIcon: "capture", OCREngine: "vision", OCRMode: "accurate", CaptureMode: "quick", Shortcuts: defaultShortcuts()}
}
func validatePreferences(p Preferences) error {
	if p.CaptureMode != "quick" && p.CaptureMode != "editor" {
		return errors.New("截图后的编辑方式无效")
	}
	if _, err := normalizedShortcuts(p.Shortcuts); err != nil {
		return err
	}
	if p.MenuBarStyle != "icon" && p.MenuBarStyle != "icon-text" && p.MenuBarStyle != "text" {
		return errors.New("菜单栏显示样式无效")
	}
	if p.MenuBarIcon != "capture" && p.MenuBarIcon != "pin" && p.MenuBarIcon != "wordmark" && p.MenuBarIcon != "ligature" {
		return errors.New("菜单栏图标样式无效")
	}
	if p.OCREngine != "vision" && p.OCREngine != "tesseract" {
		return errors.New("文字识别引擎无效")
	}
	if p.OCRMode != "accurate" && p.OCRMode != "fast" {
		return errors.New("文字识别模式无效")
	}
	return nil
}
func readPreferences(path string) (Preferences, error) {
	p := defaultPreferences()
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if len(raw) > 64<<10 {
		return defaultPreferences(), errors.New("设置文件过大")
	}
	if err = json.Unmarshal(raw, &p); err != nil {
		return defaultPreferences(), err
	}
	if p.Shortcuts, err = normalizedShortcuts(p.Shortcuts); err != nil {
		return defaultPreferences(), err
	}
	if err = validatePreferences(p); err != nil {
		return defaultPreferences(), err
	}
	return p, nil
}
func savePreferences(path string, p Preferences) error {
	raw, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".preferences-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(raw, '\n')); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
func (s *CaptureService) initializePreferences() error {
	s.preferences = defaultPreferences()
	dir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	id := nativeBundleIdentifier()
	if id == "" {
		id = "dev.ciip.app"
	}
	s.preferencesPath = filepath.Join(dir, id, "preferences.json")
	s.preferences, err = readPreferences(s.preferencesPath)
	return err
}
func (s *CaptureService) GetPreferences() Preferences {
	s.preferencesMu.Lock()
	defer s.preferencesMu.Unlock()
	p := s.preferences
	p.OpenAtLogin = mygo.App.OpenAtLogin()
	return p
}
func (s *CaptureService) preferenceSnapshot() Preferences {
	s.preferencesMu.Lock()
	defer s.preferencesMu.Unlock()
	p := s.preferences
	if p.OCREngine == "" {
		return defaultPreferences()
	}
	return p
}
func (s *CaptureService) SetPreferences(p Preferences) (Preferences, error) {
	normalized, err := normalizedShortcuts(p.Shortcuts)
	if err != nil {
		return Preferences{}, err
	}
	p.Shortcuts = normalized
	if err := validatePreferences(p); err != nil {
		return Preferences{}, err
	}
	if p.OCREngine == "tesseract" {
		if _, err := tesseractPath(); err != nil {
			return Preferences{}, err
		}
	}
	s.preferencesMu.Lock()
	defer s.preferencesMu.Unlock()
	if s.preferencesPath == "" {
		return s.preferences, errors.New("设置目录不可用")
	}
	old := s.preferences
	actualLogin := mygo.App.OpenAtLogin()
	if p.OpenAtLogin != actualLogin {
		if err := mygo.App.SetOpenAtLogin(p.OpenAtLogin); err != nil {
			return old, fmt.Errorf("无法修改登录启动：%w", err)
		}
	}
	trayChanged := old.MenuBarVisible != p.MenuBarVisible || old.MenuBarStyle != p.MenuBarStyle || old.MenuBarIcon != p.MenuBarIcon || old.Shortcuts != p.Shortcuts || (p.MenuBarVisible && s.tray == nil)
	rollback := func() {
		if p.OpenAtLogin != actualLogin {
			_ = mygo.App.SetOpenAtLogin(actualLogin)
		}
		if trayChanged {
			_ = s.applyTray(old)
		}
	}
	if trayChanged {
		if err := s.applyTray(p); err != nil {
			rollback()
			return old, err
		}
	}
	persist := func() error {
		if err := savePreferences(s.preferencesPath, p); err != nil {
			return fmt.Errorf("无法保存设置：%w", err)
		}
		return nil
	}
	if old.Shortcuts != p.Shortcuts {
		if s.shortcuts == nil {
			rollback()
			return old, errors.New("快捷键服务尚未就绪")
		}
		if err := s.shortcuts.replace(p.Shortcuts, persist); err != nil {
			rollback()
			return old, err
		}
	} else if err := persist(); err != nil {
		rollback()
		return old, err
	}
	s.preferences = p
	go s.emitActive("ciip:preferences", p)
	if !p.MenuBarVisible && !s.focusQuickEditor() {
		s.showEditor()
	}
	p.OpenAtLogin = mygo.App.OpenAtLogin()
	return p, nil
}
func (s *CaptureService) showSettings(tab string) {
	if s.focusQuickEditor() {
		s.emitActive("ciip:settings", map[string]string{"tab": tab})
		return
	}
	s.showEditor()
	s.emit("ciip:settings", map[string]string{"tab": tab})
}
func (s *CaptureService) applyTray(p Preferences) error {
	if !p.MenuBarVisible {
		if s.tray != nil {
			s.tray.Destroy()
			s.tray = nil
		}
		return nil
	}
	icon := nativeTrayIcon(p.MenuBarIcon)
	if len(icon) == 0 {
		icon = trayPNG()
	}
	title := ""
	if p.MenuBarStyle != "icon" {
		title = "ciip"
	}
	if p.MenuBarStyle == "text" {
		icon = nil
	}
	menu := mygo.NewMenu([]*mygo.MenuItem{
		{Label: shortcutMenuLabel("区域截图", p.Shortcuts.Area), Click: func(*mygo.MenuItem, *mygo.Window) { go s.captureAndNotify("area") }},
		{Label: shortcutMenuLabel("窗口截图", p.Shortcuts.Window), Click: func(*mygo.MenuItem, *mygo.Window) { go s.captureAndNotify("window") }},
		{Label: shortcutMenuLabel("全屏截图", p.Shortcuts.Screen), Click: func(*mygo.MenuItem, *mygo.Window) { go s.captureAndNotify("screen") }}, mygo.Separator(),
		{Label: shortcutMenuLabel("贴图", p.Shortcuts.Pin), Click: func(*mygo.MenuItem, *mygo.Window) { go s.PinCurrent() }}, mygo.Separator(),
		{Label: "打开编辑器", Click: func(*mygo.MenuItem, *mygo.Window) { go s.ShowEditor() }},
		{Label: "打开图片…", Click: func(*mygo.MenuItem, *mygo.Window) { go s.requestOpenImage() }},
		mygo.Separator(),
		{Label: "设置…", Click: func(*mygo.MenuItem, *mygo.Window) { go s.showSettings("general") }},
		mygo.Separator(), {Role: mygo.RoleQuit},
	})
	if s.tray != nil {
		s.tray.Destroy()
		s.tray = nil
	}
	tray, err := mygo.NewTray(mygo.TrayOptions{Icon: icon, IconIsTemplate: true, Title: title, ToolTip: "ciip · 截图与贴图", Menu: menu})
	if err != nil {
		return fmt.Errorf("无法更新菜单栏：%w", err)
	}
	s.tray = tray
	return nil
}
func (s *CaptureService) GetAppInfo() map[string]any {
	engines := []map[string]any{{"id": "vision", "name": "Apple Vision", "available": runtime.GOOS == "darwin", "detail": "系统离线识别 · 中文与英文"}}
	path, err := tesseractPath()
	detail := "未安装 Tesseract；安装后可选择"
	if err == nil {
		detail = "本机离线识别 · " + path
	}
	engines = append(engines, map[string]any{"id": "tesseract", "name": "Tesseract", "available": err == nil, "detail": detail})
	return map[string]any{"name": "ciip", "version": mygo.App.Version(), "platform": runtime.GOOS, "architecture": runtime.GOARCH, "appPath": nativeApplicationPath(), "screenPermission": nativeScreenPermission(), "engines": engines, "updateConfigured": false}
}
func (s *CaptureService) ShowPermissionGuide() error { return showNativePermissionGuide() }
func (s *CaptureService) RevealApplication() error   { return revealNativeApplication() }

type UpdateResult struct {
	Status         string `json:"status"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	URL            string `json:"url"`
	Message        string `json:"message"`
}

func (s *CaptureService) CheckForUpdates() UpdateResult {
	return UpdateResult{Status: "not_configured", CurrentVersion: mygo.App.Version(), Message: "更新功能已预留，尚未接入发布服务"}
}
