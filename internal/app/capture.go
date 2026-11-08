package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

const maxImageBytes = 64 << 20
const maxImagePixels = 60_000_000

type ImageData struct {
	DataURL string `json:"dataURL"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Name    string `json:"name"`
}

type CaptureService struct {
	settingsState
	quickState
	editor      *mygo.Window
	captureMu   sync.Mutex
	mu          sync.Mutex
	editorReady chan struct{}
	readyOnce   sync.Once
	pins        map[string]*pinnedImage
}

func (s *CaptureService) GetStatus() map[string]any {
	s.readyOnce.Do(func() {
		if s.editorReady != nil {
			close(s.editorReady)
		}
	})
	status := s.GetShortcutStatus()
	return map[string]any{
		"platform": runtime.GOOS, "version": mygo.App.Version(), "autoCopy": true,
		"shortcuts": status, "captureMode": s.preferenceSnapshot().CaptureMode,
	}

}

func (s *CaptureService) Capture(ctx context.Context, mode string) (*ImageData, error) {
	if runtime.GOOS != "darwin" {
		return nil, errors.New("当前版本的屏幕截图仅支持 macOS")
	}
	if s.hasQuickEditor() {
		return nil, errors.New("请先完成当前快捷编辑，或按 Esc 关闭后重新截图")
	}
	args, err := captureArguments(mode)
	if err != nil {
		return nil, err
	}
	if !nativeScreenPermission() {
		_ = s.ShowPermissionGuide()
		return nil, errors.New("需要屏幕录制权限，请在权限引导中允许 ciip")
	}
	if s.editorReady != nil {
		select {
		case <-s.editorReady:
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(5 * time.Second):
			return nil, errors.New("编辑器尚未就绪，请稍后重试")
		}
	}
	if !s.captureMu.TryLock() {
		return nil, errors.New("已有截图正在进行，请先完成或按 Esc 取消")
	}
	defer s.captureMu.Unlock()
	if s.hasQuickEditor() {
		return nil, errors.New("请先完成当前快捷编辑，或按 Esc 关闭后重新截图")
	}
	if mode == "element" && !nativeElementPermission() {
		return nil, errors.New("元素截图需要辅助功能权限，请在系统设置 → 隐私与安全性 → 辅助功能中允许 ciip 后重试")
	}
	if s.preferenceSnapshot().CaptureMode == "quick" {
		if err := s.prepareQuick(); err != nil {
			return nil, err
		}
		defer s.discardPreparedQuick()
	}
	wasVisible := s.editor != nil && s.editor.IsVisible()
	if s.editor != nil {
		s.editor.Hide()
	}
	succeeded := false
	quickStarted := false
	defer func() {
		if !quickStarted && (succeeded || wasVisible) {
			s.showEditor()
		}
	}()
	// Wait for the editor's hide to reach the compositor before capturing.
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(180 * time.Millisecond):
	}
	var data []byte
	var captureRect *ScreenRect
	if mode == "window" || mode == "element" {
		selection, err := selectNativeCapture(ctx, mode)
		if err != nil || selection == nil {
			return nil, err
		}
		selectedArgs, selectionErr := selection.arguments(mode)
		if selectionErr != nil {
			return nil, selectionErr
		}
		var supported bool
		data, supported, err = captureNativeSelection(ctx, selection, mode)
		if err != nil {
			return nil, fmt.Errorf("截图未完成：%w", err)
		}
		if !supported {
			// Older systems and cross-display regions retain the system
			// capture. The bounded fallback covers close/compositor propagation;
			// modern SCK requests the next frame after the native close barrier.
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(180 * time.Millisecond):
			}
			data, _, err = captureCommand(ctx, append(args, selectedArgs...), false)
		}
		captureRect = &selection.Rect
	} else {
		data, captureRect, err = captureCommand(ctx, args, mode == "area")
	}
	if err != nil || data == nil {
		return nil, err
	}
	img, raw, err := imageData(data, screenshotName())
	if err != nil {
		return nil, err
	}
	if err := mygo.Clipboard.WriteImage(raw); err != nil {
		return nil, fmt.Errorf("截图已完成，但复制到剪贴板失败：%w", err)
	}
	if s.preferenceSnapshot().CaptureMode == "quick" {
		placement, placementErr := placeQuickImage(img.Width, img.Height, captureRect, mygo.Screen.Displays(), mygo.Screen.CursorScreenPoint())
		if placementErr != nil {
			return nil, placementErr
		}
		if err := s.presentQuick(img, placement); err != nil {
			return nil, err
		}
		quickStarted = true
		succeeded = true
		return nil, nil
	}
	succeeded = true
	return img, nil
}

// Interactive area/full-screen capture and older-system fallback keep the system
// utility. Modern selected-window/element capture never creates a PNG file.
func captureCommand(ctx context.Context, args []string, interactive bool) ([]byte, *ScreenRect, error) {
	dir, err := os.MkdirTemp("", "ciip-capture-")
	if err != nil {
		return nil, nil, err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "capture.png")
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "/usr/sbin/screencapture", append(args, path)...)
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	if ctx.Err() != nil {
		return nil, nil, ctx.Err()
	}
	data, readErr := readImageFile(path)
	if captureCanceled(runErr, readErr, stderr.String(), interactive) {
		return nil, nil, nil
	}
	if runErr != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = runErr.Error()
		}
		return nil, nil, fmt.Errorf("截图未完成：%s。请在系统设置 → 隐私与安全性 → 屏幕与系统音频录制中允许 ciip", detail)
	}
	if readErr != nil {
		return nil, nil, fmt.Errorf("无法读取截图：%w", readErr)
	}
	return data, nativeCaptureRect(path), nil
}

func captureArguments(mode string) ([]string, error) {
	args := []string{"-x", "-t", "png"}
	switch mode {
	case "area":
		return append(args, "-i", "-s"), nil
	case "window", "element":
		return args, nil // The native picker supplies a window ID or an element rect.
	case "screen":
		return append(args, "-m"), nil
	default:
		return nil, errors.New("未知截图模式")
	}
}

func captureCanceled(runErr, readErr error, stderr string, interactive bool) bool {
	if !interactive || !errors.Is(readErr, os.ErrNotExist) || strings.TrimSpace(stderr) != "" {
		return false
	}
	if runErr == nil {
		return true
	}
	var exit *exec.ExitError
	return errors.As(runErr, &exit) && exit.ExitCode() == 1
}

func (s *CaptureService) OpenImage(ctx context.Context) (*ImageData, error) {
	parent := mygo.CallerWindow(ctx)
	if parent == nil {
		parent = s.editor
	}
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent: parent, Title: "打开图片", Filters: []mygo.FileFilter{{Name: "图片", Extensions: []string{"png", "jpg", "jpeg"}}},
	})
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	data, err := readImageFile(paths[0])
	if err != nil {
		return nil, err
	}
	img, _, err := imageData(data, filepath.Base(paths[0]))
	return img, err
}

func (s *CaptureService) CopyImage(dataURL string) error {
	data, _, err := decodeImageURL(dataURL)
	if err != nil {
		return err
	}
	return mygo.Clipboard.WriteImage(data)
}

func (s *CaptureService) SaveImage(ctx context.Context, dataURL string) (string, error) {
	data, _, err := decodeImageURL(dataURL)
	if err != nil {
		return "", err
	}
	parent := mygo.CallerWindow(ctx)
	if parent == nil {
		parent = s.editor
	}
	defaultPath := screenshotName()
	if home, err := os.UserHomeDir(); err == nil {
		defaultPath = filepath.Join(home, "Desktop", defaultPath)
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent: parent, Title: "保存截图", DefaultPath: defaultPath, CreateDirectories: true,
		Filters: []mygo.FileFilter{{Name: "PNG 图片", Extensions: []string{"png"}}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if strings.ToLower(filepath.Ext(path)) != ".png" {
		path += ".png"
	}
	if err := writeImageAtomically(path, data); err != nil {
		return "", fmt.Errorf("保存失败：%w", err)
	}
	return path, nil
}

func (s *CaptureService) OpenScreenSettings() error {
	return mygo.Shell.OpenExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
}

func screenshotName() string { return "ciip-" + time.Now().Format("2006-01-02-150405") + ".png" }

func readImageFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxImageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxImageBytes {
		return nil, errors.New("图片超过 64 MB")
	}
	return data, nil
}

func imageData(data []byte, name string) (*ImageData, []byte, error) {
	if len(data) > maxImageBytes {
		return nil, nil, errors.New("图片超过 64 MB")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, nil, errors.New("无法识别图片，请使用 PNG 或 JPEG 图片")
	}
	if cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > maxImagePixels {
		return nil, nil, errors.New("图片尺寸过大，最多支持 6000 万像素")
	}
	im, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, nil, errors.New("图片文件不完整或已损坏")
	}
	if format != "png" {
		var output bytes.Buffer
		if err := png.Encode(&output, im); err != nil {
			return nil, nil, err
		}
		data = output.Bytes()
	}
	if len(data) > maxImageBytes {
		return nil, nil, errors.New("PNG 图片超过 64 MB")
	}
	return &ImageData{DataURL: "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), Width: cfg.Width, Height: cfg.Height, Name: filepath.Base(name)}, data, nil
}

func decodeImageURL(value string) ([]byte, *ImageData, error) {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(value, prefix) {
		return nil, nil, errors.New("只接受 PNG 图片")
	}
	if len(value) > base64.StdEncoding.EncodedLen(maxImageBytes)+len(prefix) {
		return nil, nil, errors.New("图片超过 64 MB")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil {
		return nil, nil, errors.New("图片编码无效")
	}
	img, raw, err := imageData(raw, "ciip.png")
	return raw, img, err
}

func validDocument(doc string) error {
	if len(doc) > 96<<20 {
		return errors.New("编辑数据过大")
	}
	if !json.Valid([]byte(doc)) {
		return errors.New("编辑数据无效")
	}
	return nil
}

func writeImageAtomically(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".ciip-save-*.png")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(temp, path)
}
