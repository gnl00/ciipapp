package app

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

type ShortcutPreferences struct {
	Area    string `json:"area"`
	Window  string `json:"window"`
	Element string `json:"element"`
	Screen  string `json:"screen"`
	Pin     string `json:"pin"`
}

type ShortcutStatus struct {
	Accelerator string `json:"accelerator"`
	Display     string `json:"display"`
	Registered  bool   `json:"registered"`
	Error       string `json:"error,omitempty"`
}

var shortcutActions = []string{"area", "window", "element", "screen", "pin"}
var shortcutNames = map[string]string{"area": "区域截图", "window": "窗口截图", "element": "元素截图", "screen": "全屏截图", "pin": "贴图"}

func defaultShortcuts() ShortcutPreferences {
	return ShortcutPreferences{Area: "CmdOrCtrl+Shift+2", Window: "CmdOrCtrl+Alt+3", Screen: "CmdOrCtrl+Alt+4", Pin: "CmdOrCtrl+Shift+P"}
}
func (p ShortcutPreferences) values() map[string]string {
	return map[string]string{"area": p.Area, "window": p.Window, "element": p.Element, "screen": p.Screen, "pin": p.Pin}
}
func normalizeShortcut(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if len(value) > 80 {
		return "", errors.New("快捷键过长")
	}
	parts := strings.Split(value, "+")
	mods := map[string]bool{}
	for _, part := range parts[:len(parts)-1] {
		var modifier string
		switch strings.ToLower(strings.TrimSpace(part)) {
		case "cmdorctrl", "cmd", "command", "meta", "super":
			modifier = "CmdOrCtrl"
		case "ctrl", "control":
			modifier = "Ctrl"
		case "alt", "option":
			modifier = "Alt"
		case "shift":
			modifier = "Shift"
		default:
			return "", errors.New("快捷键修饰键无效")
		}
		if mods[modifier] {
			return "", errors.New("快捷键修饰键重复")
		}
		mods[modifier] = true
	}
	if !mods["CmdOrCtrl"] && !mods["Ctrl"] && !mods["Alt"] {
		return "", errors.New("快捷键需包含 ⌘、⌃ 或 ⌥")
	}
	key := strings.ToUpper(strings.TrimSpace(parts[len(parts)-1]))
	valid := len(key) == 1 && strings.Contains("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-=[];',./`\\", key)
	if !valid {
		for _, candidate := range []string{"Space", "Tab", "Enter", "Escape", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "Left", "Right", "Up", "Down"} {
			if strings.EqualFold(key, candidate) {
				key, valid = candidate, true
				break
			}
		}
	}
	if !valid {
		for i := 1; i <= 20; i++ {
			if key == fmt.Sprintf("F%d", i) {
				valid = true
				break
			}
		}
	}
	if !valid {
		return "", errors.New("暂不支持此按键，请使用字母、数字、方向键或 F1–F20")
	}
	canonical := []string{}
	for _, modifier := range []string{"CmdOrCtrl", "Ctrl", "Alt", "Shift"} {
		if mods[modifier] {
			canonical = append(canonical, modifier)
		}
	}
	canonical = append(canonical, key)
	return strings.Join(canonical, "+"), nil
}
func normalizedShortcuts(p ShortcutPreferences) (ShortcutPreferences, error) {
	seen := map[string]string{}
	values := p.values()
	for _, action := range shortcutActions {
		value, err := normalizeShortcut(values[action])
		if err != nil {
			return p, fmt.Errorf("%s：%w", shortcutNames[action], err)
		}
		if previous := seen[value]; value != "" && previous != "" {
			return p, fmt.Errorf("%s与%s使用了相同快捷键", shortcutNames[action], shortcutNames[previous])
		}
		seen[value], values[action] = action, value
	}
	return ShortcutPreferences{Area: values["area"], Window: values["window"], Element: values["element"], Screen: values["screen"], Pin: values["pin"]}, nil
}
func shortcutDisplay(value string) string {
	if value == "" {
		return "未设置"
	}
	parts := strings.Split(value, "+")
	mods := map[string]bool{}
	for _, part := range parts[:len(parts)-1] {
		mods[part] = true
	}
	label := ""
	for _, item := range [][2]string{{"Ctrl", "⌃"}, {"Alt", "⌥"}, {"Shift", "⇧"}, {"CmdOrCtrl", "⌘"}} {
		if mods[item[0]] {
			label += item[1]
		}
	}
	key := parts[len(parts)-1]
	if symbol := map[string]string{"Space": "空格", "Left": "←", "Right": "→", "Up": "↑", "Down": "↓", "Enter": "↩", "Tab": "⇥", "Escape": "Esc", "Backspace": "⌫", "Delete": "⌦"}[key]; symbol != "" {
		key = symbol
	}
	return label + key
}
func shortcutMenuLabel(title, accelerator string) string {
	if accelerator == "" {
		return title
	}
	return title + "   " + shortcutDisplay(accelerator)
}

// Keep old bindings active until new keys and preference persistence both succeed.
// Shared keys dispatch through the map, so swapping two actions needs no unbind gap.
type shortcutRegistry struct {
	mu          sync.Mutex
	register    func(string, func()) error
	unregister  func(string)
	actions     map[string]func()
	bindings    map[string]string // accelerator -> action
	registered  map[string]bool
	failures    map[string]string
	recording   bool
	resumeTimer *time.Timer
}

func newShortcutRegistry(register func(string, func()) error, unregister func(string), actions map[string]func()) *shortcutRegistry {
	return &shortcutRegistry{register: register, unregister: unregister, actions: actions, bindings: map[string]string{}, registered: map[string]bool{}, failures: map[string]string{}}
}
func (r *shortcutRegistry) callback(key string) func() {
	// Carbon invokes callbacks on the UI thread. Dispatch off-thread so a setting
	// transaction waiting for a UI-thread registration never deadlocks a callback.
	return func() {
		go func() {
			r.mu.Lock()
			var action func()
			if !r.recording {
				action = r.actions[r.bindings[key]]
			}
			r.mu.Unlock()
			if action != nil {
				action()
			}
		}()
	}
}
func (r *shortcutRegistry) initialize(p ShortcutPreferences) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, action := range shortcutActions {
		key := p.values()[action]
		if key == "" {
			continue
		}
		r.bindings[key] = action
		if err := r.register(key, r.callback(key)); err != nil {
			r.failures[action] = fmt.Sprintf("未能注册 %s，可能已被系统或其他应用占用：%v", shortcutDisplay(key), err)
		} else {
			r.registered[key] = true
		}
	}
}
func (r *shortcutRegistry) replace(p ShortcutPreferences, persist func() error) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.recording {
		return errors.New("请先结束快捷键录制")
	}
	bindings := map[string]string{}
	added := []string{}
	rollback := func() {
		for _, key := range added {
			r.unregister(key)
		}
	}
	for _, action := range shortcutActions {
		key := p.values()[action]
		if key == "" {
			continue
		}
		bindings[key] = action
		if r.registered[key] {
			continue
		}
		if err := r.register(key, r.callback(key)); err != nil {
			rollback()
			return fmt.Errorf("%s的快捷键 %s 注册失败，原设置已保留：%w", shortcutNames[action], shortcutDisplay(key), err)
		}
		added = append(added, key)
	}
	if err := persist(); err != nil {
		rollback()
		return err
	}
	for key := range r.registered {
		if bindings[key] == "" {
			r.unregister(key)
		}
	}
	r.bindings, r.registered, r.failures = bindings, map[string]bool{}, map[string]string{}
	for key := range bindings {
		r.registered[key] = true
	}
	return nil
}
func (r *shortcutRegistry) status(p ShortcutPreferences) map[string]ShortcutStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := map[string]ShortcutStatus{}
	for action, key := range p.values() {
		result[action] = ShortcutStatus{Accelerator: key, Display: shortcutDisplay(key), Registered: key != "" && r.registered[key] && r.bindings[key] == action, Error: r.failures[action]}
	}
	return result
}
func (r *shortcutRegistry) beginRecording() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.recording {
		return
	}
	r.recording = true
	for key := range r.registered {
		r.unregister(key)
	}
	r.registered = map[string]bool{}
	r.resumeTimer = time.AfterFunc(time.Minute, r.endRecording)
}
func (r *shortcutRegistry) endRecording() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.recording {
		return
	}
	if r.resumeTimer != nil {
		r.resumeTimer.Stop()
		r.resumeTimer = nil
	}
	r.recording = false
	r.failures = map[string]string{}
	for key, action := range r.bindings {
		if err := r.register(key, r.callback(key)); err != nil {
			r.failures[action] = fmt.Sprintf("恢复 %s 失败，请重新设置快捷键：%v", shortcutDisplay(key), err)
		} else {
			r.registered[key] = true
		}
	}
}
func (s *CaptureService) initializeShortcuts() {
	s.preferencesMu.Lock()
	defer s.preferencesMu.Unlock()
	if s.shortcuts != nil {
		return
	}
	s.shortcuts = newShortcutRegistry(mygo.GlobalShortcut.Register, mygo.GlobalShortcut.Unregister, map[string]func(){
		"area": func() { s.captureAndNotify("area") }, "window": func() { s.captureAndNotify("window") }, "element": func() { s.captureAndNotify("element") }, "screen": func() { s.captureAndNotify("screen") }, "pin": s.PinCurrent,
	})
	s.shortcuts.initialize(s.preferences.Shortcuts)
}
func (s *CaptureService) GetShortcutStatus() map[string]ShortcutStatus {
	s.preferencesMu.Lock()
	defer s.preferencesMu.Unlock()
	if s.shortcuts != nil {
		return s.shortcuts.status(s.preferences.Shortcuts)
	}
	result := map[string]ShortcutStatus{}
	for action, key := range s.preferences.Shortcuts.values() {
		result[action] = ShortcutStatus{Accelerator: key, Display: shortcutDisplay(key)}
	}
	return result
}
func (s *CaptureService) BeginShortcutRecording() error {
	s.preferencesMu.Lock()
	defer s.preferencesMu.Unlock()
	if s.shortcuts == nil {
		return errors.New("快捷键服务尚未就绪")
	}
	s.shortcuts.beginRecording()
	return nil
}
func (s *CaptureService) EndShortcutRecording() {
	s.preferencesMu.Lock()
	defer s.preferencesMu.Unlock()
	if s.shortcuts != nil {
		s.shortcuts.endRecording()
	}
}
