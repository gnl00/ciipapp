package frontend

import (
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"strings"
	"testing"
)

func TestBundledEditorResourcesResolve(t *testing.T) {
	patterns := map[string]*regexp.Regexp{
		".html": regexp.MustCompile(`(?:src|href)=["']([^"']+)["']`),
		".js":   regexp.MustCompile(`(?m)^\s*(?:import|export)\b[^;\n]*?["'](\.[^"']+)["']|import\(["'](\.[^"']+)["']\)`),
		".css":  regexp.MustCompile(`@import\s+(?:url\()?\s*["']([^"']+)["']`),
	}
	queue := []string{"index.html"}
	seen := map[string]bool{}
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		if seen[name] {
			continue
		}
		seen[name] = true
		data, err := fs.ReadFile(Files, name)
		if err != nil {
			t.Fatalf("editor reference %q is not bundled: %v", name, err)
		}
		pattern := patterns[path.Ext(name)]
		if pattern == nil {
			continue
		}
		for _, match := range pattern.FindAllStringSubmatch(string(data), -1) {
			ref := ""
			for _, candidate := range match[1:] {
				if candidate != "" {
					ref = candidate
					break
				}
			}
			if strings.Contains(ref, ":") || strings.HasPrefix(ref, "#") || strings.HasPrefix(ref, "//") {
				continue
			}
			ref = strings.SplitN(strings.SplitN(ref, "?", 2)[0], "#", 2)[0]
			queue = append(queue, path.Clean(path.Join(path.Dir(name), ref)))
		}
	}
	if len(seen) < 2 {
		t.Fatal("the editor did not reference its scripts or styles")
	}
	if err := fs.WalkDir(Files, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && (strings.Contains(name, ".test.") || strings.HasSuffix(name, ".mjs") || strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".map") || strings.Contains(name, "mock")) {
			t.Errorf("development asset leaked into the production frontend: %s", name)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPinPageEmbedsSharedTokensAndZoomWithoutFormattingArtifacts(t *testing.T) {
	if PinHTML == "" || TokensCSS == "" || PinScript == "" {
		t.Fatal("the pin page requires its template, shared tokens and zoom controller")
	}
	initial := `{"id":"test","dataURL":"data:image/png;base64,fixture"}`
	page := fmt.Sprintf(PinHTML, TokensCSS, PinScript, initial)
	if strings.Contains(page, "%!") {
		t.Fatal("pin page argument count or literal percent escaping is invalid")
	}
	for name, content := range map[string]string{"tokens": TokensCSS, "zoom": PinScript, "initial data": initial} {
		if !strings.Contains(page, content) {
			t.Fatalf("rendered pin page omitted its %s", name)
		}
	}
}
