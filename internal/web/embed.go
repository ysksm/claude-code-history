// Package web embeds the built React/TypeScript dashboard (frontend/ → dist).
// Run `npm --prefix frontend run build` before `go build` to refresh it.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS returns the built frontend rooted at the dist directory.
func FS() (fs.FS, error) {
	return fs.Sub(dist, "dist")
}
