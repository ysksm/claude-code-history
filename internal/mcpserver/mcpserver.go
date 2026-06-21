// Package mcpserver exposes the cch DuckDB analytics over the Model Context
// Protocol (MCP) on stdio, so an MCP client (e.g. Claude Code) can pull
// reports and the data needed for daily / session retrospectives.
//
// Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout. All diagnostics
// go to stderr — stdout is reserved for protocol messages.
package mcpserver

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/ysksm/claude-code-history/internal/ddb"
	"github.com/ysksm/claude-code-history/internal/report"
	"github.com/ysksm/claude-code-history/internal/source"
)

const protocolVersion = "2024-11-05"

// Serve runs the MCP stdio loop until stdin closes.
func Serve(ctx context.Context, paths source.Paths) error {
	s := &server{paths: paths, tools: buildTools(paths)}
	r := bufio.NewReaderSize(os.Stdin, 1<<20)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			if resp, ok := s.handle(ctx, line); ok {
				out.Write(resp)
				out.WriteByte('\n')
				out.Flush()
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

type server struct {
	paths source.Paths
	tools []tool
}

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcResp struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcErr         `json:"error,omitempty"`
}

type rpcErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// handle processes one JSON-RPC message; ok=false means "no response" (a
// notification or an unparseable line).
func (s *server) handle(ctx context.Context, line []byte) ([]byte, bool) {
	var req rpcReq
	if json.Unmarshal(line, &req) != nil || req.Method == "" {
		return nil, false
	}
	isNotification := len(req.ID) == 0 || string(req.ID) == "null"

	result, rerr := s.dispatch(ctx, req)
	if isNotification {
		return nil, false
	}
	resp := rpcResp{JSONRPC: "2.0", ID: req.ID, Result: result, Error: rerr}
	b, err := json.Marshal(resp)
	if err != nil {
		return nil, false
	}
	return b, true
}

func (s *server) dispatch(ctx context.Context, req rpcReq) (any, *rpcErr) {
	switch req.Method {
	case "initialize":
		return map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "cch", "version": "0.1.0"},
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": s.toolSpecs()}, nil
	case "tools/call":
		return s.callTool(ctx, req.Params)
	default:
		if strings.HasPrefix(req.Method, "notifications/") {
			return nil, nil // notifications need no result
		}
		return nil, &rpcErr{Code: -32601, Message: "method not found: " + req.Method}
	}
}

func (s *server) toolSpecs() []map[string]any {
	specs := make([]map[string]any, 0, len(s.tools))
	for _, t := range s.tools {
		var schema any
		json.Unmarshal([]byte(t.schema), &schema)
		specs = append(specs, map[string]any{
			"name": t.name, "description": t.desc, "inputSchema": schema,
		})
	}
	return specs
}

func (s *server) callTool(ctx context.Context, params json.RawMessage) (any, *rpcErr) {
	var p struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if json.Unmarshal(params, &p) != nil {
		return nil, &rpcErr{Code: -32602, Message: "invalid params"}
	}
	for _, t := range s.tools {
		if t.name == p.Name {
			data, err := t.run(ctx, p.Arguments)
			if err != nil {
				return toolText(fmt.Sprintf("error: %v", err), true), nil
			}
			b, _ := json.MarshalIndent(data, "", "  ")
			return toolText(string(b), false), nil
		}
	}
	return nil, &rpcErr{Code: -32602, Message: "unknown tool: " + p.Name}
}

func toolText(text string, isErr bool) map[string]any {
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": text}},
		"isError": isErr,
	}
}

type tool struct {
	name   string
	desc   string
	schema string // JSON Schema literal for inputSchema
	run    func(ctx context.Context, args map[string]any) (any, error)
}

// --- helpers -----------------------------------------------------------------

func litStr(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func argStr(args map[string]any, key string) string {
	if v, ok := args[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func argInt(args map[string]any, key string, def int) int {
	if v, ok := args[key].(float64); ok {
		return int(v)
	}
	return def
}

// --- tools -------------------------------------------------------------------

func buildTools(paths source.Paths) []tool {
	q := func(ctx context.Context, sql string) ([]map[string]any, error) {
		ctx2, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		return ddb.QueryJSON(ctx2, paths, sql)
	}

	// resolveID expands a session-id prefix to the full id.
	resolveID := func(ctx context.Context, idArg string) (string, error) {
		if idArg == "" {
			return "", fmt.Errorf("session_id is required")
		}
		rows, err := q(ctx, "SELECT session_id FROM sessions WHERE session_id LIKE "+litStr(idArg+"%")+" LIMIT 1")
		if err != nil {
			return "", err
		}
		if len(rows) == 0 {
			return "", fmt.Errorf("no session matching %q", idArg)
		}
		return fmt.Sprint(rows[0]["session_id"]), nil
	}

	return []tool{
		{
			name: "overview",
			desc: "Headline totals across all Claude Code history (sessions, prompts, tool calls, tokens).",
			schema: `{"type":"object","properties":{},"additionalProperties":false}`,
			run: func(ctx context.Context, _ map[string]any) (any, error) {
				rows, err := q(ctx, "SELECT * FROM v_overview")
				if err != nil || len(rows) == 0 {
					return rows, err
				}
				return rows[0], nil
			},
		},
		{
			name: "list_projects",
			desc: "List all projects with sessions, tool calls and token totals (descending by total tokens).",
			schema: `{"type":"object","properties":{},"additionalProperties":false}`,
			run: func(ctx context.Context, _ map[string]any) (any, error) {
				return q(ctx, "SELECT * FROM v_project_rollup ORDER BY total_tokens DESC")
			},
		},
		{
			name: "list_sessions",
			desc: "List sessions, optionally filtered by project (display name) and/or day (YYYY-MM-DD). Use to find a session_id.",
			schema: `{"type":"object","properties":{
			  "project":{"type":"string","description":"project display name, e.g. my-app-builder"},
			  "day":{"type":"string","description":"YYYY-MM-DD"},
			  "limit":{"type":"integer","description":"max rows (default 30)"}},
			  "additionalProperties":false}`,
			run: func(ctx context.Context, args map[string]any) (any, error) {
				where := []string{"1=1"}
				if p := argStr(args, "project"); p != "" {
					where = append(where, "project = "+litStr(p))
				}
				if d := argStr(args, "day"); d != "" {
					where = append(where, "day = "+litStr(d))
				}
				limit := argInt(args, "limit", 30)
				sql := fmt.Sprintf(`SELECT session_id, project, ai_title, round(duration_sec) AS duration_sec,
				  day, n_user AS prompts, n_tool_use AS tool_calls, total_tokens
				FROM v_session_rollup WHERE %s ORDER BY total_tokens DESC LIMIT %d`,
					strings.Join(where, " AND "), limit)
				return q(ctx, sql)
			},
		},
		{
			name: "session_retrospective",
			desc: "Detailed data for reflecting on a single session: summary metrics, tool-category breakdown, errors, files written (with line counts), shell commands run, and skills/subagents used. session_id may be a prefix.",
			schema: `{"type":"object","properties":{
			  "session_id":{"type":"string","description":"session id or unique prefix"}},
			  "required":["session_id"],"additionalProperties":false}`,
			run: func(ctx context.Context, args map[string]any) (any, error) {
				id, err := resolveID(ctx, argStr(args, "session_id"))
				if err != nil {
					return nil, err
				}
				lid := litStr(id)
				out := map[string]any{"session_id": id}
				if r, err := q(ctx, "SELECT * FROM v_session_rollup WHERE session_id="+lid); err == nil && len(r) > 0 {
					out["summary"] = r[0]
				}
				out["tool_breakdown"], _ = q(ctx, "SELECT category, count(*) AS calls, count(*) FILTER (WHERE is_error) AS errors FROM v_tool_timing WHERE session_id="+lid+" GROUP BY 1 ORDER BY calls DESC")
				out["files_written"], _ = q(ctx, "SELECT detail AS file, sum(in_lines) AS added, sum(del_lines) AS removed, count(*) AS edits FROM v_tool_timing WHERE session_id="+lid+" AND category='file' AND (in_lines>0 OR del_lines>0) GROUP BY 1 ORDER BY added+removed DESC LIMIT 40")
				out["commands"], _ = q(ctx, "SELECT detail AS command, count(*) AS runs FROM v_tool_timing WHERE session_id="+lid+" AND category='bash' AND detail<>'' GROUP BY 1 ORDER BY runs DESC LIMIT 40")
				out["errors"], _ = q(ctx, "SELECT name, detail, count(*) AS n FROM v_tool_timing WHERE session_id="+lid+" AND is_error GROUP BY 1,2 ORDER BY n DESC LIMIT 40")
				out["skills_subagents"], _ = q(ctx, "SELECT category, coalesce(nullif(skill,''),nullif(subagent,''),name) AS what, count(*) AS calls FROM v_tool_timing WHERE session_id="+lid+" AND category IN ('skill','agent') GROUP BY 1,2 ORDER BY calls DESC")
				return out, nil
			},
		},
		{
			name: "daily_retrospective",
			desc: "Detailed data for reflecting on one day (YYYY-MM-DD): day totals, the sessions worked, tool-category breakdown, errors, and the files changed that day.",
			schema: `{"type":"object","properties":{
			  "day":{"type":"string","description":"YYYY-MM-DD"}},
			  "required":["day"],"additionalProperties":false}`,
			run: func(ctx context.Context, args map[string]any) (any, error) {
				day := argStr(args, "day")
				if day == "" {
					return nil, fmt.Errorf("day is required (YYYY-MM-DD)")
				}
				ld := litStr(day)
				dayExpr := "CAST(to_timestamp(call_ms/1000.0) AS DATE) = " + ld
				out := map[string]any{"day": day}
				if r, err := q(ctx, "SELECT * FROM v_daily WHERE day="+ld); err == nil && len(r) > 0 {
					out["totals"] = r[0]
				}
				out["sessions"], _ = q(ctx, "SELECT session_id, project, ai_title, round(duration_sec) AS duration_sec, n_user AS prompts, n_tool_use AS tool_calls, total_tokens FROM v_session_rollup WHERE day="+ld+" ORDER BY total_tokens DESC")
				out["tool_breakdown"], _ = q(ctx, "SELECT category, count(*) AS calls, count(*) FILTER (WHERE is_error) AS errors FROM v_tool_timing WHERE "+dayExpr+" GROUP BY 1 ORDER BY calls DESC")
				out["errors"], _ = q(ctx, "SELECT name, detail, count(*) AS n FROM v_tool_timing WHERE "+dayExpr+" AND is_error GROUP BY 1,2 ORDER BY n DESC LIMIT 40")
				out["files_changed"], _ = q(ctx, "SELECT detail AS file, sum(in_lines) AS added, sum(del_lines) AS removed, count(*) AS edits FROM v_tool_timing WHERE "+dayExpr+" AND category='file' AND (in_lines>0 OR del_lines>0) GROUP BY 1 ORDER BY added+removed DESC LIMIT 40")
				return out, nil
			},
		},
		{
			name: "report",
			desc: "Run a named analysis report and return its rows. Available reports: " + strings.Join(report.Keys(), ", ") + ".",
			schema: `{"type":"object","properties":{
			  "name":{"type":"string","description":"report name, e.g. overview, tokens, projects, daily, tools, plugins, timing"}},
			  "required":["name"],"additionalProperties":false}`,
			run: func(ctx context.Context, args map[string]any) (any, error) {
				name := argStr(args, "name")
				r, ok := report.Find(name)
				if !ok {
					return nil, fmt.Errorf("unknown report %q (have: %s)", name, strings.Join(report.Keys(), ", "))
				}
				return q(ctx, r.SQL)
			},
		},
	}
}
