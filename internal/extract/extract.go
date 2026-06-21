// Package extract walks Claude Code data and writes normalized, flat NDJSON
// tables that DuckDB then loads.
package extract

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ysksm/claude-code-history/internal/parse"
	"github.com/ysksm/claude-code-history/internal/source"
)

// Result summarizes an extraction run.
type Result struct {
	Sessions int
	Projects int
	Messages int
	Tools    int
	Files    int
}

// Run reads everything under paths.ClaudeHome and writes NDJSON tables to
// paths.DataDir. The set of installed plugin names is read first so MCP tool
// names can be split correctly.
func Run(paths source.Paths) (Result, error) {
	if err := os.MkdirAll(paths.DataDir, 0o755); err != nil {
		return Result{}, err
	}
	pluginNames, plugins := loadPlugins(paths)
	settings := loadSettings(paths)

	w, err := newWriters(paths.DataDir)
	if err != nil {
		return Result{}, err
	}
	defer w.close()

	entries, _ := os.ReadDir(paths.ProjectsDir())
	var res Result
	projectsSeen := map[string]bool{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		slug := e.Name()
		projectDir := filepath.Join(paths.ProjectsDir(), slug)
		// Walk recursively: subagent transcripts live in
		// <session>/subagents/*.jsonl and must roll up to the parent session.
		filepath.WalkDir(projectDir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".jsonl") {
				return nil
			}
			projectsSeen[slug] = true
			res.Files++
			fi := fileContext(path, projectDir)
			if err := processFile(path, slug, fi, pluginNames, w, &res); err != nil {
				fmt.Fprintf(os.Stderr, "warn: %s: %v\n", path, err)
			}
			return nil
		})
	}
	res.Projects = len(projectsSeen)

	// Config + meta tables.
	for _, p := range plugins {
		w.write("plugins", p)
	}
	w.write("meta", map[string]any{
		"generated_at": time.Now().UTC().Format(time.RFC3339),
		"model":        settings.Model,
		"effort_level": settings.EffortLevel,
		"default_mode": settings.DefaultMode,
		"n_sessions":   res.Sessions,
		"n_projects":   res.Projects,
		"claude_home":  paths.ClaudeHome,
	})
	return res, w.err
}

// fileCtx describes how a transcript file maps to a session.
type fileCtx struct {
	sessionID   string // session this file's records belong to
	isSubagent  bool   // true for <session>/subagents/*.jsonl
	skipSessRow bool   // don't emit a sessions row (subagent rolls up to parent)
}

// fileContext derives the session id and subagent status from a file path.
func fileContext(path, projectDir string) fileCtx {
	base := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	rel, _ := filepath.Rel(projectDir, path)
	parts := strings.Split(rel, string(filepath.Separator))
	for i, p := range parts {
		if p == "subagents" && i > 0 {
			// parent session is the UUID dir just before "subagents".
			return fileCtx{sessionID: parts[i-1], isSubagent: true, skipSessRow: true}
		}
	}
	return fileCtx{sessionID: base}
}

func processFile(path, slug string, fc fileCtx, pluginNames []string, w *writers, res *Result) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 64*1024*1024)

	projectPath := source.DecodeProjectSlug(slug)
	sess := sessionMeta{
		SessionID:   fc.sessionID,
		ProjectSlug: slug,
		ProjectPath: projectPath,
		Project:     source.ShortProject(projectPath),
		File:        path,
	}
	hasSession := false

	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var r parse.Record
		if err := json.Unmarshal(line, &r); err != nil {
			continue
		}
		// Subagent records roll up to the parent session and are flagged
		// sidechain regardless of the record's own field.
		if !fc.isSubagent && r.SessionID != "" {
			sess.SessionID = r.SessionID
		}
		// Prefer the real cwd from records over the lossy slug decode
		// (the slug turns dashes inside names into path separators, which
		// collapses e.g. go-jira and rs-jira both to "jira").
		if r.CWD != "" && sess.CWDSet == false {
			sess.ProjectPath = r.CWD
			sess.Project = source.ShortProject(r.CWD)
			sess.CWDSet = true
		}
		if fc.isSubagent {
			r.IsSidechain = true
		}
		switch r.Type {
		case "ai-title":
			if r.AITitle != "" {
				sess.AITitle = r.AITitle
			}
		case "assistant":
			hasSession = true
			processAssistant(r, &sess, pluginNames, w, res)
		case "user":
			hasSession = true
			processUser(r, &sess, w)
		}
	}
	if hasSession && !fc.skipSessRow {
		w.write("sessions", sess)
		res.Sessions++
	}
	return sc.Err()
}

type sessionMeta struct {
	SessionID   string `json:"session_id"`
	ProjectSlug string `json:"project_slug"`
	ProjectPath string `json:"project_path"`
	Project     string `json:"project"`
	File        string `json:"file"`
	AITitle     string `json:"ai_title"`
	CWDSet      bool   `json:"-"`
}

func processAssistant(r parse.Record, sess *sessionMeta, pluginNames []string, w *writers, res *Result) {
	m, err := r.ParseMessage()
	if err != nil || m == nil {
		return
	}
	tsMS := parse.TimeMillis(r.Timestamp)
	blocks := m.Blocks()
	nTool, nThink, textLen := 0, 0, 0
	for _, b := range blocks {
		switch b.Type {
		case "tool_use":
			nTool++
			ti := parse.Classify(b.Name, b.Input, pluginNames)
			w.write("tool_calls", map[string]any{
				"id":             b.ID,
				"session_id":     sess.SessionID,
				"project_slug":   sess.ProjectSlug,
				"ts":             r.Timestamp,
				"ts_ms":          tsMS,
				"assistant_uuid": r.UUID,
				"name":           b.Name,
				"category":       ti.Category,
				"plugin":         ti.Plugin,
				"mcp_server":     ti.MCPServer,
				"skill":          ti.Skill,
				"subagent":       ti.Subagent,
				"is_sidechain":   r.IsSidechain,
				"input_len":      len(b.Input),
				"model":          m.Model,
			})
			res.Tools++
		case "thinking":
			nThink++
			textLen += len(b.Thinking)
		case "text":
			textLen += len(b.Text)
		}
	}
	var u parse.Usage
	if m.Usage != nil {
		u = *m.Usage
	}
	w.write("messages", map[string]any{
		"uuid":           r.UUID,
		"parent_uuid":    r.ParentUUID,
		"session_id":     sess.SessionID,
		"project_slug":   sess.ProjectSlug,
		"ts":             r.Timestamp,
		"ts_ms":          tsMS,
		"type":           "assistant",
		"role":           "assistant",
		"model":          m.Model,
		"input_tokens":   u.InputTokens,
		"output_tokens":  u.OutputTokens,
		"cache_read":     u.CacheReadTokens,
		"cache_creation": u.CacheCreationTokens,
		"total_tokens":   u.InputTokens + u.OutputTokens + u.CacheReadTokens + u.CacheCreationTokens,
		"service_tier":   u.ServiceTier,
		"web_search":     u.ServerToolUse.WebSearch,
		"web_fetch":      u.ServerToolUse.WebFetch,
		"n_tool_use":     nTool,
		"n_thinking":     nThink,
		"text_len":       textLen,
		"is_sidechain":   r.IsSidechain,
		"git_branch":     r.GitBranch,
		"version":        r.Version,
	})
	res.Messages++
}

func processUser(r parse.Record, sess *sessionMeta, w *writers) {
	m, err := r.ParseMessage()
	if err != nil || m == nil {
		return
	}
	tsMS := parse.TimeMillis(r.Timestamp)

	if s, ok := m.AsString(); ok {
		kind, command := "prompt", ""
		if c, isCmd := parse.SlashCommand(s); isCmd {
			kind, command = "command", c
		}
		w.write("prompts", map[string]any{
			"session_id":   sess.SessionID,
			"project_slug": sess.ProjectSlug,
			"ts":           r.Timestamp,
			"ts_ms":        tsMS,
			"kind":         kind,
			"command":      command,
			"text_len":     len(s),
			"source":       r.PromptSource,
			"is_sidechain": r.IsSidechain,
		})
		w.write("messages", map[string]any{
			"uuid": r.UUID, "parent_uuid": r.ParentUUID,
			"session_id": sess.SessionID, "project_slug": sess.ProjectSlug,
			"ts": r.Timestamp, "ts_ms": tsMS, "type": "user", "role": "user",
			"text_len": len(s), "is_sidechain": r.IsSidechain,
			"git_branch": r.GitBranch, "version": r.Version,
		})
		return
	}

	// Structured user content = tool results (plus maybe text).
	for _, b := range m.Blocks() {
		if b.Type != "tool_result" {
			continue
		}
		w.write("tool_results", map[string]any{
			"tool_use_id":  b.ToolUseID,
			"session_id":   sess.SessionID,
			"project_slug": sess.ProjectSlug,
			"ts":           r.Timestamp,
			"ts_ms":        tsMS,
			"is_error":     b.IsError,
			"output_len":   len(parse.ResultText(b.Content)),
			"is_sidechain": r.IsSidechain,
		})
	}
}

// ---- writers ----

type writers struct {
	dir   string
	files map[string]*os.File
	bufs  map[string]*bufio.Writer
	err   error
}

func newWriters(dir string) (*writers, error) {
	w := &writers{dir: dir, files: map[string]*os.File{}, bufs: map[string]*bufio.Writer{}}
	for _, t := range []string{"sessions", "messages", "tool_calls", "tool_results", "prompts", "plugins", "meta"} {
		f, err := os.Create(filepath.Join(dir, t+".ndjson"))
		if err != nil {
			w.close()
			return nil, err
		}
		w.files[t] = f
		w.bufs[t] = bufio.NewWriterSize(f, 256*1024)
	}
	return w, nil
}

func (w *writers) write(table string, v any) {
	if w.err != nil {
		return
	}
	b, err := json.Marshal(v)
	if err != nil {
		w.err = err
		return
	}
	bw := w.bufs[table]
	bw.Write(b)
	bw.WriteByte('\n')
}

func (w *writers) close() {
	for _, b := range w.bufs {
		b.Flush()
	}
	for _, f := range w.files {
		f.Close()
	}
}

// ---- settings + plugins ----

type settings struct {
	Model       string `json:"model"`
	EffortLevel string `json:"effortLevel"`
	DefaultMode string `json:"-"`
}

func loadSettings(paths source.Paths) settings {
	var raw struct {
		Model       string `json:"model"`
		EffortLevel string `json:"effortLevel"`
		Permissions struct {
			DefaultMode string `json:"defaultMode"`
		} `json:"permissions"`
	}
	b, err := os.ReadFile(paths.SettingsFile())
	if err != nil {
		return settings{}
	}
	json.Unmarshal(b, &raw)
	return settings{Model: raw.Model, EffortLevel: raw.EffortLevel, DefaultMode: raw.Permissions.DefaultMode}
}

type pluginRow struct {
	Name        string `json:"name"`
	Marketplace string `json:"marketplace"`
	Enabled     bool   `json:"enabled"`
}

// loadPlugins returns the distinct plugin names plus rows describing each
// (enabled per settings, discovered from settings + plugins cache dir).
func loadPlugins(paths source.Paths) (names []string, rows []pluginRow) {
	seen := map[string]*pluginRow{}
	add := func(name, mp string, enabled bool) {
		if name == "" {
			return
		}
		if r, ok := seen[name]; ok {
			if enabled {
				r.Enabled = true
			}
			if r.Marketplace == "" {
				r.Marketplace = mp
			}
			return
		}
		seen[name] = &pluginRow{Name: name, Marketplace: mp, Enabled: enabled}
	}

	// settings.enabledPlugins: keys are "name@marketplace".
	var s struct {
		EnabledPlugins map[string]bool `json:"enabledPlugins"`
	}
	if b, err := os.ReadFile(paths.SettingsFile()); err == nil {
		json.Unmarshal(b, &s)
	}
	for key, enabled := range s.EnabledPlugins {
		name, mp := key, ""
		if i := strings.Index(key, "@"); i >= 0 {
			name, mp = key[:i], key[i+1:]
		}
		add(name, mp, enabled)
	}

	// plugins/cache/<marketplace>/<plugin> directories.
	cache := filepath.Join(paths.PluginsDir(), "cache")
	if mps, err := os.ReadDir(cache); err == nil {
		for _, mp := range mps {
			if !mp.IsDir() {
				continue
			}
			pls, _ := os.ReadDir(filepath.Join(cache, mp.Name()))
			for _, pl := range pls {
				if pl.IsDir() {
					add(pl.Name(), mp.Name(), false)
				}
			}
		}
	}

	for name, r := range seen {
		names = append(names, name)
		rows = append(rows, *r)
	}
	sort.Strings(names)
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
	return names, rows
}
