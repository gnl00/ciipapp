package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func tesseractPath() (string, error) {
	if path, err := exec.LookPath("tesseract"); err == nil {
		return path, nil
	}
	for _, path := range []string{"/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "/usr/bin/tesseract"} {
		if stat, err := os.Stat(path); err == nil && !stat.IsDir() && stat.Mode()&0111 != 0 {
			return path, nil
		}
	}
	return "", errors.New("本机未安装 Tesseract，请选择 Apple Vision 或安装 Tesseract 后重试")
}

type boundedOutput struct {
	buffer bytes.Buffer
	limit  int
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.buffer.Len() {
		return 0, errors.New("识别输出过大")
	}
	return b.buffer.Write(p)
}
func (b *boundedOutput) Bytes() []byte  { return b.buffer.Bytes() }
func (b *boundedOutput) String() string { return b.buffer.String() }
func tesseractLanguages(ctx context.Context, path string) (string, error) {
	cmd := exec.CommandContext(ctx, path, "--list-langs")
	var out boundedOutput
	out.limit = 64 << 10
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("无法读取 Tesseract 语言包：%w", err)
	}
	available := map[string]bool{}
	for _, line := range strings.Fields(out.String()) {
		available[line] = true
	}
	var languages []string
	for _, language := range []string{"chi_sim", "chi_tra", "eng"} {
		if available[language] {
			languages = append(languages, language)
		}
	}
	if len(languages) == 0 {
		return "", errors.New("Tesseract 未安装可用语言包，需要 eng、chi_sim 或 chi_tra")
	}
	return strings.Join(languages, "+"), nil
}
func recognizeTextTesseract(raw []byte, width, height int) (*OCRResult, error) {
	path, err := tesseractPath()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	languages, err := tesseractLanguages(ctx, path)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, path, "stdin", "stdout", "-l", languages, "--psm", "3", "tsv")
	cmd.Stdin = bytes.NewReader(raw)
	var output, stderr boundedOutput
	output.limit = 4 << 20
	stderr.limit = 64 << 10
	cmd.Stdout = &output
	cmd.Stderr = &stderr
	if err = cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("Tesseract 识别超时，请先缩小或裁剪图片")
		}
		if detail := strings.TrimSpace(stderr.String()); detail != "" {
			return nil, fmt.Errorf("Tesseract 识别失败：%s", detail)
		}
		return nil, fmt.Errorf("Tesseract 识别失败：%w", err)
	}
	return parseTesseractTSV(output.Bytes(), width, height)
}
func parseTesseractTSV(data []byte, width, height int) (*OCRResult, error) {
	result := &OCRResult{Width: width, Height: height, Lines: []OCRLine{}}
	if width < 1 || height < 1 {
		return nil, errors.New("识别图片尺寸无效")
	}
	// Tesseract emits literal symbol text, with no CSV quoting or escaping.
	rows := strings.Split(string(data), "\n")
	header := strings.Split(strings.TrimSuffix(rows[0], "\r"), "\t")
	if len(header) != 12 || header[0] != "level" || header[11] != "text" {
		return nil, errors.New("Tesseract 输出格式无效")
	}
	var keys []string
	groups := map[string]*OCRLine{}
	for _, raw := range rows[1:] {
		raw = strings.TrimSuffix(raw, "\r")
		if raw == "" {
			continue
		}
		row := strings.SplitN(raw, "\t", 12)
		if len(row) != 12 {
			return nil, errors.New("Tesseract 文字行无效")
		}
		if row[0] != "5" {
			continue
		}
		text := strings.TrimSpace(row[11])
		if text == "" {
			continue
		}
		values := [4]int{}
		for i := 0; i < 4; i++ {
			n, e := strconv.Atoi(row[6+i])
			if e != nil || n < 0 {
				return nil, errors.New("Tesseract 坐标无效")
			}
			values[i] = n
		}
		x, y, w, h := values[0], values[1], values[2], values[3]
		if w == 0 || h == 0 || x >= width || y >= height {
			continue
		}
		right := x + min(width-x, w)
		bottom := y + min(height-y, h)
		key := strings.Join(row[1:5], ":")
		line, ok := groups[key]
		if !ok {
			line = &OCRLine{X: float64(x), Y: float64(y), W: float64(right - x), H: float64(bottom - y)}
			groups[key] = line
			keys = append(keys, key)
		} else {
			oldRight, oldBottom := line.X+line.W, line.Y+line.H
			line.X = min(line.X, float64(x))
			line.Y = min(line.Y, float64(y))
			line.W = max(oldRight, float64(right)) - line.X
			line.H = max(oldBottom, float64(bottom)) - line.Y
		}
		if line.Text != "" {
			line.Text += " "
		}
		line.Text += text
	}
	var text []string
	for _, key := range keys {
		result.Lines = append(result.Lines, *groups[key])
		text = append(text, groups[key].Text)
	}
	result.Text = strings.Join(text, "\n")
	return result, nil
}
