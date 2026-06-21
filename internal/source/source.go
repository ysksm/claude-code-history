// Package source locates Claude Code data on disk (~/.claude) and the
// derived working directory where this tool stores normalized data + the
// DuckDB database.
package source

import (
	"os"
	"path/filepath"
	"strings"
)

// Paths holds the resolved locations this tool reads from / writes to.
type Paths struct {
	ClaudeHome string // e.g. ~/.claude
	DataDir    string // working dir for NDJSON + duckdb file
}

// Resolve figures out the Claude home and data dir, honoring overrides
// (empty string means "use default").
func Resolve(claudeHome, dataDir string) (Paths, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Paths{}, err
	}
	if claudeHome == "" {
		claudeHome = os.Getenv("CLAUDE_HOME")
	}
	if claudeHome == "" {
		claudeHome = filepath.Join(home, ".claude")
	}
	if dataDir == "" {
		dataDir = os.Getenv("CCH_DATA")
	}
	if dataDir == "" {
		cache, err := os.UserCacheDir()
		if err != nil || cache == "" {
			cache = filepath.Join(home, ".cache")
		}
		dataDir = filepath.Join(cache, "cch")
	}
	return Paths{ClaudeHome: claudeHome, DataDir: dataDir}, nil
}

// ProjectsDir is where per-project session transcripts live.
func (p Paths) ProjectsDir() string { return filepath.Join(p.ClaudeHome, "projects") }

// SettingsFile is the user settings.json.
func (p Paths) SettingsFile() string { return filepath.Join(p.ClaudeHome, "settings.json") }

// PluginsDir holds installed plugins/marketplaces.
func (p Paths) PluginsDir() string { return filepath.Join(p.ClaudeHome, "plugins") }

// DBFile is the DuckDB database built by `ingest`.
func (p Paths) DBFile() string { return filepath.Join(p.DataDir, "cch.duckdb") }

// DecodeProjectSlug turns a project dir name like
// "-Users-kasamatsu-src-github-go-jira" back into a readable path.
// Claude encodes the absolute cwd by replacing '/' with '-'. The decode is
// lossy (dashes inside real names are indistinguishable from separators), so
// we return a best-effort path string used for display only.
func DecodeProjectSlug(slug string) string {
	s := strings.ReplaceAll(slug, "-", "/")
	if !strings.HasPrefix(s, "/") {
		s = "/" + s
	}
	return s
}

// ShortProject returns the trailing path segment for compact display.
func ShortProject(decoded string) string {
	decoded = strings.TrimRight(decoded, "/")
	if i := strings.LastIndex(decoded, "/"); i >= 0 {
		return decoded[i+1:]
	}
	return decoded
}
