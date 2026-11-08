package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sync"

	"ciip/frontend"

	"github.com/egoist/mygo"
)

var pinScript = frontend.PinScript

var pinHTML = frontend.PinHTML

var tokensCSS = frontend.TokensCSS

type pinnedImage struct {
	window        *mygo.Window
	dataURL       string
	documentJSON  string
	width, height int
	hiddenForEdit bool
	resizeMu      sync.Mutex
	zoom          pinZoomGeometry
}

type pinZoomGeometry struct {
	last                                  mygo.Rectangle
	imageWidth, imageHeight               int
	scale, minimumScale, centerX, centerY float64
}

func (z *pinZoomGeometry) resize(bounds, work mygo.Rectangle, imageWidth, imageHeight int, factor float64) mygo.Rectangle {
	if bounds != z.last || imageWidth != z.imageWidth || imageHeight != z.imageHeight {
		z.scale = math.Min(float64(bounds.Width)/float64(imageWidth), float64(bounds.Height)/float64(imageHeight))
		z.minimumScale = math.Min(z.scale, 120/float64(max(imageWidth, imageHeight)))
		z.centerX, z.centerY = float64(bounds.X)+float64(bounds.Width)/2, float64(bounds.Y)+float64(bounds.Height)/2
		z.imageWidth, z.imageHeight = imageWidth, imageHeight
	}
	// Keep fractional size and center across frames; reset only after an external change.
	maximum := math.Min(float64(max(1, work.Width-24))/float64(imageWidth), float64(max(1, work.Height-24))/float64(imageHeight))
	z.scale = math.Min(maximum, math.Max(z.minimumScale, z.scale*factor))
	width, height := pinSizeAtScale(imageWidth, imageHeight, z.scale)
	x, y := int(math.Round(z.centerX-float64(width)/2)), int(math.Round(z.centerY-float64(height)/2))
	boundedX := max(work.X, min(x, work.X+work.Width-width))
	boundedY := max(work.Y, min(y, work.Y+work.Height-height))
	if boundedX != x {
		z.centerX = float64(boundedX) + float64(width)/2
	}
	if boundedY != y {
		z.centerY = float64(boundedY) + float64(height)/2
	}
	z.last = mygo.Rectangle{X: boundedX, Y: boundedY, Width: width, Height: height}
	return z.last
}

type PinData struct {
	DataURL      string `json:"dataURL"`
	DocumentJSON string `json:"documentJSON"`
	PinID        string `json:"pinID"`
}

func (s *CaptureService) PinImage(ctx context.Context, dataURL, documentJSON string, placement *ScreenRect) (string, error) {
	_, img, err := decodeImageURL(dataURL)
	if err != nil {
		return "", err
	}
	if err = validDocument(documentJSON); err != nil {
		return "", err
	}
	var token [12]byte
	if _, err = rand.Read(token[:]); err != nil {
		return "", err
	}
	id := hex.EncodeToString(token[:])
	display := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
	var source *ScreenRect
	if placement != nil {
		if !validScreenRect(placement) {
			return "", errors.New("贴图显示范围无效")
		}
		if caller := mygo.CallerWindow(ctx); caller != nil {
			bounds := caller.Bounds()
			source = &ScreenRect{X: float64(bounds.X) + placement.X, Y: float64(bounds.Y) + placement.Y, Width: placement.Width, Height: placement.Height}
			display = mygo.Screen.DisplayMatching(mygo.Rectangle{X: int(math.Round(source.X)), Y: int(math.Round(source.Y)), Width: int(math.Round(source.Width)), Height: int(math.Round(source.Height))})
		}
	}
	bounds := initialPinBounds(img.Width, img.Height, source, display)
	minWidth, minHeight := fitPinSize(img.Width, img.Height, display.WorkArea.Width-24, display.WorkArea.Height-24, 0)
	minWidth, minHeight = min(minWidth, bounds.Width), min(minHeight, bounds.Height)
	win := mygo.NewWindow(mygo.WindowOptions{
		Title: "ciip 贴图", Width: bounds.Width, Height: bounds.Height, MinWidth: minWidth, MinHeight: minHeight,
		Frameless: true, Panel: true, AlwaysOnTop: true, Hidden: true,
		Transparent: true, DisableMaximize: true, DisableFullScreen: true,
		X: bounds.X, Y: bounds.Y,
		Page: mygo.PageOptions{BackgroundThrottling: mygo.ThrottlingOff},
	})
	win.SetBounds(bounds)
	p := &pinnedImage{window: win, dataURL: img.DataURL, documentJSON: documentJSON, width: img.Width, height: img.Height}
	s.mu.Lock()
	s.pins[id] = p
	s.mu.Unlock()
	input := newPinMagnifyQueue(func(factor float64) {
		s.mu.Lock()
		valid := s.pins[id] == p && !p.hiddenForEdit
		s.mu.Unlock()
		if valid {
			_ = s.ResizePin(id, factor)
		}
	})
	stopInput, nativePinch := installPinMagnify(win, img.Width, img.Height, input.enqueue)
	win.OnClosed(func() {
		input.close()
		stopInput()
		s.mu.Lock()
		delete(s.pins, id)
		s.mu.Unlock()
		go s.emit("ciip:pin-closed", map[string]string{"pinID": id})
	})
	win.OnReadyToShow(func() { win.Show() })
	win.OnFocus(func() { go s.emitWindow(win, "ciip:pin-focus", nil) })
	initial, _ := json.Marshal(map[string]any{"id": id, "dataURL": img.DataURL, "nativePinch": nativePinch})
	win.Page().LoadHTML(fmt.Sprintf(pinHTML, tokensCSS, pinScript, string(initial)), "")
	return id, nil
}

func (s *CaptureService) GetPin(id string) (PinData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.pins[id]
	if !ok {
		return PinData{}, errors.New("这张贴图已经关闭")
	}
	return PinData{DataURL: p.dataURL, DocumentJSON: p.documentJSON, PinID: id}, nil
}

func (s *CaptureService) RefreshPinShadow(ctx context.Context, id string) error {
	caller := mygo.CallerWindow(ctx)
	s.mu.Lock()
	p := s.pins[id]
	valid := caller != nil && p != nil && p.window == caller
	s.mu.Unlock()
	if !valid {
		return errors.New("贴图已关闭，或调用窗口不匹配")
	}
	refreshPinShadow(caller)
	return nil
}

func (s *CaptureService) UpdatePin(id, dataURL, documentJSON string) error {
	_, img, err := decodeImageURL(dataURL)
	if err != nil {
		return err
	}
	if err = validDocument(documentJSON); err != nil {
		return err
	}
	s.mu.Lock()
	p, ok := s.pins[id]
	if !ok {
		s.mu.Unlock()
		return errors.New("这张贴图已经关闭，请重新贴图")
	}
	p.dataURL = img.DataURL
	p.documentJSON = documentJSON
	p.width = img.Width
	p.height = img.Height
	win := p.window
	s.mu.Unlock()
	value, _ := json.Marshal(img.DataURL)
	updatePinMagnify(win, img.Width, img.Height)
	_, err = win.Page().Eval("document.getElementById('image').src=" + string(value))
	if err != nil {
		return err
	}
	display := mygo.Screen.DisplayMatching(win.Bounds())
	minWidth, minHeight := fitPinSize(img.Width, img.Height, display.WorkArea.Width-24, display.WorkArea.Height-24, 0)
	minWidth, minHeight = min(minWidth, win.Bounds().Width), min(minHeight, win.Bounds().Height)
	win.SetMinimumSize(minWidth, minHeight)
	if err := s.ResizePin(id, 1); err != nil {
		return err
	}
	s.mu.Lock()
	p.hiddenForEdit = false
	s.mu.Unlock()
	win.Show()
	win.Focus()
	return nil
}

func (s *CaptureService) EditPin(id string) error {
	if s.hasQuickEditor() {
		s.focusQuickEditor()
		err := errors.New("请先完成当前快捷编辑，或按 Esc 关闭后再编辑贴图")
		s.report(err)
		return err
	}
	p, err := s.GetPin(id)
	if err != nil {
		return err
	}
	s.showEditor()
	s.emit("ciip:document", map[string]string{"documentJSON": p.DocumentJSON, "pinID": p.PinID})
	return nil
}

func (s *CaptureService) HidePin(id string) {
	s.mu.Lock()
	p := s.pins[id]
	if p != nil {
		p.hiddenForEdit = true
	}
	s.mu.Unlock()
	if p != nil {
		p.window.Hide()
	}
}

func (s *CaptureService) RestorePin(id string) {
	s.mu.Lock()
	p := s.pins[id]
	if p != nil {
		p.hiddenForEdit = false
	}
	s.mu.Unlock()
	if p != nil {
		p.window.ShowInactive()
	}
}

func (s *CaptureService) restoreEditingPins() {
	s.mu.Lock()
	var windows []*mygo.Window
	for _, p := range s.pins {
		if p.hiddenForEdit {
			p.hiddenForEdit = false
			windows = append(windows, p.window)
		}
	}
	s.mu.Unlock()
	for _, win := range windows {
		win.ShowInactive()
	}
}

func (s *CaptureService) ClosePin(id string) {
	s.mu.Lock()
	p := s.pins[id]
	delete(s.pins, id)
	s.mu.Unlock()
	if p != nil {
		p.window.Close()
	}
}

func (s *CaptureService) ResizePin(id string, factor float64) error {
	if math.IsNaN(factor) || math.IsInf(factor, 0) || factor < 0.5 || factor > 2 {
		return errors.New("缩放参数无效")
	}
	s.mu.Lock()
	p, ok := s.pins[id]
	if !ok {
		s.mu.Unlock()
		return errors.New("这张贴图已经关闭")
	}
	win := p.window
	s.mu.Unlock()
	p.resizeMu.Lock()
	defer p.resizeMu.Unlock()
	bounds := win.Bounds()
	display := mygo.Screen.DisplayMatching(bounds)
	s.mu.Lock()
	if s.pins[id] != p {
		s.mu.Unlock()
		return errors.New("这张贴图已经关闭")
	}
	next := p.zoom.resize(bounds, display.WorkArea, p.width, p.height, factor)
	s.mu.Unlock()
	if next != bounds {
		win.SetBounds(next)
	}
	return nil
}

func fitPinScale(width, height, maxWidth, maxHeight int, scale float64) float64 {
	maxWidth = max(1, maxWidth)
	maxHeight = max(1, maxHeight)
	maximum := math.Min(float64(maxWidth)/float64(width), float64(maxHeight)/float64(height))
	minimum := math.Min(120/float64(width), 120/float64(height))
	return math.Max(math.Min(minimum, maximum), math.Min(scale, maximum))
}

func fitPinSize(width, height, maxWidth, maxHeight int, scale float64) (int, int) {
	scale = fitPinScale(width, height, maxWidth, maxHeight, scale)
	return pinSizeAtScale(width, height, scale)
}

func pinSizeAtScale(width, height int, scale float64) (int, int) {
	return max(1, int(math.Round(float64(width)*scale))), max(1, int(math.Round(float64(height)*scale)))
}

func initialPinBounds(width, height int, source *ScreenRect, display mygo.Display) mygo.Rectangle {
	if validScreenRect(source) {
		work := display.WorkArea
		scale := math.Min(source.Width/float64(width), source.Height/float64(height))
		maximum := math.Min(float64(max(1, work.Width-24))/float64(width), float64(max(1, work.Height-24))/float64(height))
		w, h := pinSizeAtScale(width, height, math.Min(scale, maximum))
		x := int(math.Round(source.X + (source.Width-float64(w))/2))
		y := int(math.Round(source.Y + (source.Height-float64(h))/2))
		return mygo.Rectangle{X: max(work.X, min(x, work.X+work.Width-w)), Y: max(work.Y, min(y, work.Y+work.Height-h)), Width: w, Height: h}
	}
	deviceScale := display.ScaleFactor
	if math.IsNaN(deviceScale) || math.IsInf(deviceScale, 0) || deviceScale <= 0 {
		deviceScale = 1
	}
	scale := math.Max(1/deviceScale, 220/float64(width))
	w, h := fitPinSize(width, height, min(640, display.WorkArea.Width-60), display.WorkArea.Height-60, scale)
	return mygo.Rectangle{X: display.WorkArea.X + (display.WorkArea.Width-w)/2, Y: display.WorkArea.Y + (display.WorkArea.Height-h)/2, Width: w, Height: h}
}
