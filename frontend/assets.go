// Package frontend owns the compiled editor assets embedded by the desktop app.
package frontend

import (
 "embed"
 "io/fs"
)

//go:embed all:dist
var compiled embed.FS

// Files exposes the compiled editor at the native URL root.
var Files = func() fs.FS {
 files, err := fs.Sub(compiled, "dist")
 if err != nil { panic(err) }
 return files
}()

//go:embed dist/pin.template.html
var PinHTML string

//go:embed dist/pin.js
var PinScript string

//go:embed dist/tokens.css
var TokensCSS string
