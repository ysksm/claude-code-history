// Package server hosts the interactive dashboard: a static front-end (uPlot
// charts + filterable tables) backed by a small JSON API over DuckDB.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/ysksm/claude-code-history/internal/ddb"
	"github.com/ysksm/claude-code-history/internal/source"
	"github.com/ysksm/claude-code-history/internal/web"
)

// Serve starts the dashboard HTTP server (blocking).
func Serve(ctx context.Context, paths source.Paths, port int) error {
	sub, err := web.FS()
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/", spaHandler(sub))

	h := &api{paths: paths}
	mux.HandleFunc("/api/filters", h.handle(h.filters))
	mux.HandleFunc("/api/overview", h.handle(h.overview))
	mux.HandleFunc("/api/daily", h.handle(h.daily))
	mux.HandleFunc("/api/projects", h.handle(h.projects))
	mux.HandleFunc("/api/models", h.handle(h.models))
	mux.HandleFunc("/api/tools", h.handle(h.tools))
	mux.HandleFunc("/api/categories", h.handle(h.categories))
	mux.HandleFunc("/api/plugins", h.handle(h.plugins))
	mux.HandleFunc("/api/skills", h.handle(h.skills))
	mux.HandleFunc("/api/subagents", h.handle(h.subagents))
	mux.HandleFunc("/api/commands", h.handle(h.commands))
	mux.HandleFunc("/api/mcp", h.handle(h.mcp))
	mux.HandleFunc("/api/workflow", h.handle(h.workflow))
	mux.HandleFunc("/api/timing", h.handle(h.timing))
	mux.HandleFunc("/api/sessions", h.handle(h.sessions))
	mux.HandleFunc("/api/session", h.handle(h.session))
	mux.HandleFunc("/api/session_meta", h.handle(h.sessionMeta))
	mux.HandleFunc("/api/session_minutes", h.handle(h.sessionMinutes))
	mux.HandleFunc("/api/time_breakdown", h.handle(h.timeBreakdown))
	mux.HandleFunc("/api/time_daily", h.handle(h.timeDaily))
	mux.HandleFunc("/api/mcp_server", h.mcpServer)

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	fmt.Printf("Dashboard: http://%s\n", addr)
	srv := &http.Server{Addr: addr, Handler: mux}
	go func() { <-ctx.Done(); srv.Close() }()
	return srv.ListenAndServe()
}

// spaHandler serves embedded static assets, falling back to index.html for
// paths that don't map to a file (single-page app friendly).
func spaHandler(root fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			fileServer.ServeHTTP(w, r)
			return
		}
		if _, err := fs.Stat(root, p); err != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

type api struct{ paths source.Paths }

type queryFunc func(*http.Request) (string, error)

// timeBreakdown aggregates tool execution time grouped by a dimension:
// category (default), tool name, or bash command (detail). Answers "where does
// time go" — e.g. how much of the time `npm run lint` consumes.
func (a *api) timeBreakdown(r *http.Request) (string, error) {
	q := r.URL.Query()
	c := cond(q, "call_ms") // v_tool_timing has call_ms, project_slug, is_sidechain
	keyExpr, extra := "category", ""
	switch q.Get("dim") {
	case "tool":
		keyExpr = "name"
	case "command":
		keyExpr = "detail"
		extra = " AND category='bash' AND detail<>''"
	}
	return fmt.Sprintf(`SELECT %s AS key, count(*) AS calls,
	  coalesce(sum(duration_ms),0) AS total_ms,
	  round(coalesce(quantile_cont(duration_ms,0.5),0)) AS p50_ms,
	  count(*) FILTER (WHERE is_error) AS errors
	FROM v_tool_timing WHERE duration_ms>=0 AND %s%s
	GROUP BY 1 ORDER BY total_ms DESC LIMIT 50`, keyExpr, c, extra), nil
}

// timeDaily sums tool execution time per day (chronological view).
func (a *api) timeDaily(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "call_ms")
	return fmt.Sprintf(`SELECT CAST(to_timestamp(call_ms/1000.0) AS DATE) AS day,
	  count(*) AS calls, coalesce(sum(duration_ms),0) AS tool_ms
	FROM v_tool_timing WHERE duration_ms>=0 AND %s GROUP BY 1 ORDER BY 1`, c), nil
}

// mcpBinary returns the absolute path of the running cch executable, used to
// build the `claude mcp add` command.
func mcpBinary() string {
	if p, err := os.Executable(); err == nil {
		return p
	}
	return "cch"
}

// mcpServerStatus reports how to register the MCP server and whether it is
// currently registered in Claude Code (user scope).
func mcpServerStatus() map[string]any {
	bin := mcpBinary()
	available := false
	if _, err := exec.LookPath("claude"); err == nil {
		available = true
	}
	installed := false
	if available {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		installed = exec.CommandContext(ctx, "claude", "mcp", "get", "cch").Run() == nil
	}
	return map[string]any{
		"binary":           bin,
		"command":          "claude mcp add --scope user cch -- " + bin + " mcp",
		"remove_command":   "claude mcp remove --scope user cch",
		"claude_available": available,
		"installed":        installed,
	}
}

// mcpServer: GET reports registration status; POST {enabled} registers or
// removes the cch MCP server in Claude Code (user scope) via the claude CLI.
func (a *api) mcpServer(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var body struct {
			Enabled bool `json:"enabled"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		var args []string
		if body.Enabled {
			args = []string{"mcp", "add", "--scope", "user", "cch", "--", mcpBinary(), "mcp"}
		} else {
			args = []string{"mcp", "remove", "--scope", "user", "cch"}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, "claude", args...).CombinedOutput()
		status := mcpServerStatus()
		status["action_ok"] = err == nil
		status["action_output"] = strings.TrimSpace(string(out))
		if err != nil {
			status["action_error"] = err.Error()
		}
		writeObj(w, status)
		return
	}
	writeObj(w, mcpServerStatus())
}

func writeObj(w http.ResponseWriter, obj any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(obj)
}

// handle wraps a query-building func: build SQL, run it, emit JSON rows.
func (a *api) handle(qf queryFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sql, err := qf(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		rows, err := ddb.QueryJSON(ctx, a.paths, sql)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, rows)
	}
}

// cond builds a SQL boolean filter from query params, using tsCol as the
// epoch-millis column and "project_slug" for project scoping.
func cond(q url.Values, tsCol string) string {
	parts := []string{"TRUE"}
	if from := q.Get("from"); from != "" {
		if ms, ok := dayStartMs(from); ok {
			parts = append(parts, fmt.Sprintf("%s >= %d", tsCol, ms))
		}
	}
	if to := q.Get("to"); to != "" {
		if ms, ok := dayEndMs(to); ok {
			parts = append(parts, fmt.Sprintf("%s <= %d", tsCol, ms))
		}
	}
	if p := q.Get("project"); p != "" {
		parts = append(parts, "project_slug = "+lit(p))
	}
	if q.Get("sidechain") != "include" {
		parts = append(parts, "is_sidechain = FALSE")
	}
	return strings.Join(parts, " AND ")
}

func (a *api) filters(r *http.Request) (string, error) {
	// One row per project; date range + models are repeated as constant
	// columns so the client can read them off the first row. DuckDB's JSON
	// mode renders LIST/STRUCT as strings, so we avoid nested columns here.
	return `SELECT s.slug, s.name, m.min_day, m.max_day, m.models
	FROM (SELECT DISTINCT project_slug AS slug, project AS name FROM sessions) s
	CROSS JOIN (
	  SELECT min(CAST(to_timestamp(ts_ms/1000.0) AS DATE)) AS min_day,
	         max(CAST(to_timestamp(ts_ms/1000.0) AS DATE)) AS max_day,
	         string_agg(DISTINCT model, ',') FILTER (WHERE model IS NOT NULL AND model<>'') AS models
	  FROM messages) m
	ORDER BY s.name`, nil
}

func (a *api) overview(r *http.Request) (string, error) {
	q := r.URL.Query()
	cm := cond(q, "ts_ms")
	ct := cond(q, "ts_ms")
	return fmt.Sprintf(`SELECT
	  (SELECT count(DISTINCT session_id) FROM messages WHERE %[1]s)                       AS sessions,
	  (SELECT count(DISTINCT project_slug) FROM messages WHERE %[1]s)                     AS projects,
	  (SELECT count(*) FROM prompts WHERE kind='prompt' AND %[2]s)                        AS prompts,
	  (SELECT count(*) FROM prompts WHERE kind='command' AND %[2]s)                       AS slash_commands,
	  (SELECT count(*) FROM tool_calls WHERE %[2]s)                                       AS tool_calls,
	  (SELECT count(*) FROM tool_calls WHERE plugin IS NOT NULL AND plugin<>'' AND %[2]s) AS plugin_tool_calls,
	  (SELECT count(*) FROM tool_calls WHERE category='agent' AND %[2]s)                  AS subagent_calls,
	  (SELECT coalesce(sum(in_lines),0) FROM tool_calls WHERE category='file' AND %[2]s)  AS code_added,
	  (SELECT coalesce(sum(del_lines),0) FROM tool_calls WHERE category='file' AND %[2]s) AS code_removed,
	  (SELECT coalesce(sum(input_tokens),0) FROM messages WHERE %[1]s)                    AS input_tokens,
	  (SELECT coalesce(sum(output_tokens),0) FROM messages WHERE %[1]s)                   AS output_tokens,
	  (SELECT coalesce(sum(cache_read),0) FROM messages WHERE %[1]s)                      AS cache_read_tokens,
	  (SELECT coalesce(sum(total_tokens),0) FROM messages WHERE %[1]s)                    AS total_tokens`,
		cm, ct), nil
}

func (a *api) daily(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "ts_ms")
	return fmt.Sprintf(`SELECT
	  CAST(to_timestamp(ts_ms/1000.0) AS DATE) AS day,
	  coalesce(sum(input_tokens),0)  AS input_tokens,
	  coalesce(sum(output_tokens),0) AS output_tokens,
	  coalesce(sum(cache_read),0)    AS cache_read,
	  coalesce(sum(n_tool_use),0)    AS tool_calls,
	  count(*) FILTER (WHERE type='user') AS prompts,
	  count(DISTINCT session_id)     AS sessions
	FROM messages WHERE %s GROUP BY 1 ORDER BY 1`, c), nil
}

func (a *api) projects(r *http.Request) (string, error) {
	q := r.URL.Query()
	c := cond(q, "m.ts_ms")
	ct := cond(q, "ts_ms") // for tool_calls (has ts_ms, project_slug, is_sidechain)
	return fmt.Sprintf(`WITH code AS (
	    SELECT project_slug,
	      coalesce(sum(in_lines),0) AS code_added,
	      coalesce(sum(del_lines),0) AS code_removed
	    FROM tool_calls WHERE category='file' AND %s GROUP BY 1
	  )
	SELECT s.project, m.project_slug,
	  count(DISTINCT m.session_id) AS sessions,
	  coalesce(sum(m.n_tool_use),0)    AS tool_calls,
	  coalesce(max(code.code_added),0)   AS code_added,
	  coalesce(max(code.code_removed),0) AS code_removed,
	  coalesce(sum(m.input_tokens),0)  AS input_tokens,
	  coalesce(sum(m.output_tokens),0) AS output_tokens,
	  coalesce(sum(m.cache_read),0)    AS cache_read,
	  coalesce(sum(m.total_tokens),0)  AS total_tokens
	FROM messages m JOIN sessions s ON s.session_id=m.session_id
	LEFT JOIN code ON code.project_slug=m.project_slug
	WHERE %s GROUP BY 1,2 ORDER BY total_tokens DESC`, ct, replaceSlug(c, "m.")), nil
}

func (a *api) models(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "ts_ms")
	return fmt.Sprintf(`SELECT coalesce(nullif(model,''),'(none)') AS model,
	  count(*) FILTER (WHERE type='assistant') AS turns,
	  coalesce(sum(input_tokens),0)  AS input_tokens,
	  coalesce(sum(output_tokens),0) AS output_tokens,
	  coalesce(sum(cache_read),0)    AS cache_read,
	  coalesce(sum(total_tokens),0)  AS total_tokens
	FROM messages WHERE type='assistant' AND %s GROUP BY 1 ORDER BY total_tokens DESC`, c), nil
}

func (a *api) tools(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "call_ms")
	return fmt.Sprintf(`SELECT name, any_value(category) AS category,
	  count(*) AS calls,
	  count(*) FILTER (WHERE is_error) AS errors,
	  count(DISTINCT session_id) AS sessions,
	  round(avg(duration_ms) FILTER (WHERE duration_ms>=0)) AS avg_ms,
	  round(quantile_cont(duration_ms,0.95) FILTER (WHERE duration_ms>=0)) AS p95_ms
	FROM v_tool_timing WHERE %s GROUP BY name ORDER BY calls DESC LIMIT 50`, c), nil
}

func (a *api) categories(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "call_ms")
	return fmt.Sprintf(`SELECT category, count(*) AS calls,
	  count(DISTINCT session_id) AS sessions,
	  round(avg(duration_ms) FILTER (WHERE duration_ms>=0)) AS avg_ms
	FROM v_tool_timing WHERE %s GROUP BY category ORDER BY calls DESC`, c), nil
}

func (a *api) plugins(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "call_ms")
	return fmt.Sprintf(`SELECT p.name, p.enabled,
	  coalesce(count(t.id),0) AS calls,
	  count(DISTINCT t.session_id) AS sessions,
	  count(DISTINCT t.project_slug) AS projects,
	  count(t.id) FILTER (WHERE t.is_error) AS errors,
	  round(avg(t.duration_ms) FILTER (WHERE t.duration_ms>=0)) AS avg_ms
	FROM plugins p
	LEFT JOIN v_tool_timing t ON t.plugin=p.name AND %s
	GROUP BY p.name, p.enabled ORDER BY calls DESC, p.name`, c), nil
}

func (a *api) skills(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "ts_ms")
	return fmt.Sprintf(`SELECT skill, coalesce(nullif(plugin,''),'(builtin)') AS plugin,
	  count(*) AS calls, count(DISTINCT session_id) AS sessions
	FROM tool_calls WHERE category='skill' AND skill<>'' AND %s
	GROUP BY 1,2 ORDER BY calls DESC`, c), nil
}

func (a *api) subagents(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "ts_ms")
	return fmt.Sprintf(`SELECT coalesce(nullif(subagent,''),'(default)') AS subagent,
	  count(*) AS calls, count(DISTINCT session_id) AS sessions
	FROM tool_calls WHERE category='agent' AND %s GROUP BY 1 ORDER BY calls DESC`, c), nil
}

func (a *api) commands(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "ts_ms")
	return fmt.Sprintf(`SELECT command, count(*) AS uses,
	  count(DISTINCT session_id) AS sessions, count(DISTINCT project_slug) AS projects
	FROM prompts WHERE kind='command' AND command<>'' AND %s
	GROUP BY 1 ORDER BY uses DESC`, c), nil
}

func (a *api) mcp(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "ts_ms")
	return fmt.Sprintf(`SELECT coalesce(nullif(mcp_server,''),'(plugin-level)') AS mcp_server,
	  coalesce(nullif(plugin,''),'(user/global)') AS plugin,
	  count(*) AS calls, count(DISTINCT session_id) AS sessions
	FROM tool_calls WHERE category='mcp' AND %s GROUP BY 1,2 ORDER BY calls DESC`, c), nil
}

func (a *api) workflow(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "ts_ms")
	return fmt.Sprintf(`WITH seq AS (
	  SELECT session_id, category, ts_ms,
	    lag(category) OVER (PARTITION BY session_id ORDER BY ts_ms) AS prev
	  FROM tool_calls WHERE %s)
	SELECT prev AS from_category, category AS to_category, count(*) AS transitions
	FROM seq WHERE prev IS NOT NULL GROUP BY 1,2 ORDER BY transitions DESC LIMIT 40`, c), nil
}

func (a *api) timing(r *http.Request) (string, error) {
	q := r.URL.Query()
	cm := cond(q, "ts_ms")
	ct := cond(q, "call_ms")
	return fmt.Sprintf(`SELECT 'assistant_step' AS metric, count(*) AS n,
	  round(avg(step_ms)) AS avg_ms, round(quantile_cont(step_ms,0.5)) AS p50_ms,
	  round(quantile_cont(step_ms,0.95)) AS p95_ms, round(max(step_ms)) AS max_ms
	FROM v_messages WHERE type='assistant' AND step_ms>=0 AND %s
	UNION ALL
	SELECT 'tool_duration', count(*), round(avg(duration_ms)),
	  round(quantile_cont(duration_ms,0.5)), round(quantile_cont(duration_ms,0.95)), round(max(duration_ms))
	FROM v_tool_timing WHERE duration_ms>=0 AND %s`, cm, ct), nil
}

func (a *api) sessions(r *http.Request) (string, error) {
	c := cond(r.URL.Query(), "m.ts_ms")
	// par: max number of subagent dispatches (agent tool calls) running
	// concurrently within a session — a sweep line over [call_ms, result_ms].
	return fmt.Sprintf(`WITH iv AS (
	    SELECT session_id, call_ms AS s, result_ms AS e
	    FROM v_tool_timing
	    WHERE category='agent' AND call_ms IS NOT NULL AND result_ms IS NOT NULL AND result_ms > call_ms
	  ), ev AS (
	    SELECT session_id, s AS t, 1 AS d FROM iv
	    UNION ALL SELECT session_id, e AS t, -1 AS d FROM iv
	  ), run AS (
	    SELECT session_id, sum(d) OVER (PARTITION BY session_id ORDER BY t, d) AS cur FROM ev
	  ), par AS (
	    SELECT session_id, max(cur) AS max_parallel FROM run GROUP BY 1
	  ), code AS (
	    SELECT session_id, coalesce(sum(in_lines),0) AS code_added, coalesce(sum(del_lines),0) AS code_removed
	    FROM tool_calls WHERE category='file' GROUP BY 1
	  )
	SELECT m.session_id, s.project, s.ai_title,
	  round((max(m.ts_ms)-min(m.ts_ms))/1000.0) AS duration_sec,
	  count(*) FILTER (WHERE m.type='user') AS prompts,
	  coalesce(sum(m.n_tool_use),0) AS tool_calls,
	  coalesce(sum(m.total_tokens),0) AS total_tokens,
	  coalesce(max(par.max_parallel),1) AS max_parallel,
	  coalesce(max(code.code_added),0) AS code_added,
	  coalesce(max(code.code_removed),0) AS code_removed,
	  CAST(to_timestamp(min(m.ts_ms)/1000.0) AS DATE) AS day
	FROM messages m JOIN sessions s ON s.session_id=m.session_id
	LEFT JOIN par ON par.session_id=m.session_id
	LEFT JOIN code ON code.session_id=m.session_id
	WHERE %s GROUP BY 1,2,3 ORDER BY total_tokens DESC LIMIT 100`, replaceSlug(c, "m.")), nil
}

// scCond returns the sidechain filter fragment for session-detail endpoints.
func scCond(q url.Values) string {
	if q.Get("sidechain") == "include" {
		return ""
	}
	return " AND NOT is_sidechain"
}

func (a *api) session(r *http.Request) (string, error) {
	q := r.URL.Query()
	id := q.Get("id")
	if id == "" {
		return "", fmt.Errorf("missing id")
	}
	return fmt.Sprintf(`SELECT seq, ts_ms, offset_sec, kind, label, category, detail, in_lines, del_lines,
	  total_tokens, input_tokens, output_tokens, duration_ms, is_error, size, cum_tokens
	FROM v_events WHERE session_id=%s%s ORDER BY ts_ms, seq LIMIT 2000`,
		lit(id), scCond(q)), nil
}

func (a *api) sessionMeta(r *http.Request) (string, error) {
	id := r.URL.Query().Get("id")
	if id == "" {
		return "", fmt.Errorf("missing id")
	}
	return fmt.Sprintf(`SELECT session_id, project, ai_title, round(duration_sec) AS duration_sec,
	  first_ms, last_ms,
	  n_user AS prompts, n_assistant AS turns, n_tool_use AS tools, n_subagent_msgs,
	  (SELECT coalesce(sum(in_lines),0) FROM tool_calls WHERE category='file' AND session_id=%[1]s)  AS code_added,
	  (SELECT coalesce(sum(del_lines),0) FROM tool_calls WHERE category='file' AND session_id=%[1]s) AS code_removed,
	  input_tokens, output_tokens, cache_read, total_tokens, models, day
	FROM v_session_rollup WHERE session_id=%[1]s`, lit(id)), nil
}

func (a *api) sessionMinutes(r *http.Request) (string, error) {
	q := r.URL.Query()
	id := q.Get("id")
	if id == "" {
		return "", fmt.Errorf("missing id")
	}
	return fmt.Sprintf(`SELECT minute, tool_calls, prompts, assistant_turns, tokens,
	  out_tokens, in_tokens, tool_ms, cum_tokens
	FROM v_session_minutes WHERE session_id=%s ORDER BY minute`, lit(id)), nil
}

// replaceSlug qualifies the bare project_slug column with a table alias prefix
// when the query joins tables.
func replaceSlug(c, prefix string) string {
	return strings.ReplaceAll(c, "project_slug = ", prefix+"project_slug = ")
}

// ---- helpers ----

func lit(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func dayStartMs(d string) (int64, bool) {
	t, err := time.Parse("2006-01-02", d)
	if err != nil {
		return 0, false
	}
	return t.UnixMilli(), true
}

func dayEndMs(d string) (int64, bool) {
	t, err := time.Parse("2006-01-02", d)
	if err != nil {
		return 0, false
	}
	return t.Add(24*time.Hour - time.Millisecond).UnixMilli(), true
}

func writeJSON(w http.ResponseWriter, rows []map[string]any) {
	json.NewEncoder(w).Encode(rows)
}
