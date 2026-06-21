// cch — Claude Code history analyzer.
//
// Pipeline: ingest (~/.claude → normalized NDJSON → DuckDB) then report / serve.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ysksm/claude-code-history/internal/ddb"
	"github.com/ysksm/claude-code-history/internal/extract"
	"github.com/ysksm/claude-code-history/internal/report"
	"github.com/ysksm/claude-code-history/internal/server"
	"github.com/ysksm/claude-code-history/internal/source"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "ingest":
		err = cmdIngest(os.Args[2:])
	case "report":
		err = cmdReport(os.Args[2:])
	case "export":
		err = cmdExport(os.Args[2:])
	case "serve":
		err = cmdServe(os.Args[2:])
	case "sql":
		err = cmdSQL(os.Args[2:])
	case "session", "timeline":
		err = cmdSession(os.Args[2:])
	case "-h", "--help", "help":
		usage()
		return
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `cch — Claude Code history analyzer

USAGE
  cch ingest [--claude DIR] [--data DIR]      Parse ~/.claude and build the DuckDB database
  cch report [NAME|all] [--format F] [--out F] Print an analysis (default: overview)
  cch export [--format F] [--out DIR]          Dump all views/tables (csv|json|parquet)
  cch serve  [--port N] [--data DIR]           Start the interactive dashboard
  cch session ID [--bucket SEC] [--format F]   Timeline of one session (events or time-slices)
  cch sql    "SELECT ..." [--format F]         Run an ad-hoc query

REPORTS
  `+strings.Join(report.Keys(), ", ")+`

FORMATS
  box (default), markdown, csv, json
`)
}

func mustDuckDB() error {
	if !ddb.Available() {
		return fmt.Errorf("duckdb CLI not found on PATH (install: brew install duckdb)")
	}
	return nil
}

func resolve(claudeHome, dataDir string) (source.Paths, error) {
	return source.Resolve(claudeHome, dataDir)
}

func dbReady(p source.Paths) error {
	if _, err := os.Stat(p.DBFile()); err != nil {
		return fmt.Errorf("no database at %s — run `cch ingest` first", p.DBFile())
	}
	return nil
}

func cmdIngest(args []string) error {
	fs := flag.NewFlagSet("ingest", flag.ExitOnError)
	claudeHome := fs.String("claude", "", "Claude home dir (default ~/.claude)")
	dataDir := fs.String("data", "", "working data dir (default ~/.cache/cch)")
	fs.Parse(args)
	if err := mustDuckDB(); err != nil {
		return err
	}
	p, err := resolve(*claudeHome, *dataDir)
	if err != nil {
		return err
	}
	fmt.Printf("Reading %s ...\n", p.ClaudeHome)
	res, err := extract.Run(p)
	if err != nil {
		return err
	}
	fmt.Printf("Extracted: %d sessions, %d projects, %d messages, %d tool calls (%d files)\n",
		res.Sessions, res.Projects, res.Messages, res.Tools, res.Files)
	fmt.Printf("Building DuckDB at %s ...\n", p.DBFile())
	if err := ddb.Build(p); err != nil {
		return err
	}
	fmt.Println("Done. Try:  cch report overview   |   cch serve")
	return nil
}

func cmdReport(args []string) error {
	// First positional arg may be a report name.
	name := "overview"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		name = args[0]
		args = args[1:]
	}
	fs := flag.NewFlagSet("report", flag.ExitOnError)
	format := fs.String("format", "box", "output format: box|markdown|csv|json")
	out := fs.String("out", "", "write to file instead of stdout")
	dataDir := fs.String("data", "", "working data dir")
	fs.Parse(args)
	if err := mustDuckDB(); err != nil {
		return err
	}
	p, err := resolve("", *dataDir)
	if err != nil {
		return err
	}
	if err := dbReady(p); err != nil {
		return err
	}

	var reports []report.Report
	if name == "all" {
		reports = report.All
	} else if r, ok := report.Find(name); ok {
		reports = []report.Report{r}
	} else {
		return fmt.Errorf("unknown report %q (have: %s)", name, strings.Join(report.Keys(), ", "))
	}

	var sb strings.Builder
	for _, r := range reports {
		rendered, err := ddb.Formatted(p, r.SQL, *format)
		if err != nil {
			return err
		}
		if *format == "markdown" {
			sb.WriteString("## " + r.Title + "\n\n")
			sb.WriteString(rendered)
			sb.WriteString("\n")
		} else if len(reports) > 1 {
			sb.WriteString("== " + r.Title + " ==\n")
			sb.WriteString(rendered)
			sb.WriteString("\n")
		} else {
			sb.WriteString(rendered)
		}
	}
	if *out != "" {
		if err := os.WriteFile(*out, []byte(sb.String()), 0o644); err != nil {
			return err
		}
		fmt.Printf("wrote %s\n", *out)
		return nil
	}
	fmt.Print(sb.String())
	return nil
}

func cmdExport(args []string) error {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	format := fs.String("format", "csv", "csv|json|parquet")
	out := fs.String("out", "cch-export", "output directory")
	dataDir := fs.String("data", "", "working data dir")
	fs.Parse(args)
	if err := mustDuckDB(); err != nil {
		return err
	}
	p, err := resolve("", *dataDir)
	if err != nil {
		return err
	}
	if err := dbReady(p); err != nil {
		return err
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		return err
	}
	ext := *format
	if ext == "parquet" {
		ext = "parquet"
	}
	copyOpt := map[string]string{
		"csv":     "(FORMAT csv, HEADER)",
		"json":    "(FORMAT json, ARRAY true)",
		"parquet": "(FORMAT parquet)",
	}[*format]
	if copyOpt == "" {
		return fmt.Errorf("bad format %q", *format)
	}
	for _, r := range report.All {
		file := filepath.Join(*out, r.Key+"."+ext)
		sql := fmt.Sprintf("COPY (%s) TO '%s' %s", r.SQL, file, copyOpt)
		if _, err := ddb.Formatted(p, sql, "csv"); err != nil {
			return fmt.Errorf("export %s: %w", r.Key, err)
		}
	}
	fmt.Printf("exported %d datasets to %s/\n", len(report.All), *out)
	return nil
}

func cmdServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	port := fs.Int("port", 8080, "listen port")
	dataDir := fs.String("data", "", "working data dir")
	fs.Parse(args)
	if err := mustDuckDB(); err != nil {
		return err
	}
	p, err := resolve("", *dataDir)
	if err != nil {
		return err
	}
	if err := dbReady(p); err != nil {
		return err
	}
	return server.Serve(context.Background(), p, *port)
}

func cmdSQL(args []string) error {
	fs := flag.NewFlagSet("sql", flag.ExitOnError)
	format := fs.String("format", "box", "box|markdown|csv|json")
	dataDir := fs.String("data", "", "working data dir")
	// allow query as first positional
	query := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		query = args[0]
		args = args[1:]
	}
	fs.Parse(args)
	if query == "" {
		return fmt.Errorf("usage: cch sql \"SELECT ...\"")
	}
	if err := mustDuckDB(); err != nil {
		return err
	}
	p, err := resolve("", *dataDir)
	if err != nil {
		return err
	}
	if err := dbReady(p); err != nil {
		return err
	}
	out, err := ddb.Formatted(p, query, *format)
	if err != nil {
		return err
	}
	fmt.Print(out)
	return nil
}

func cmdSession(args []string) error {
	id := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		id = args[0]
		args = args[1:]
	}
	fs := flag.NewFlagSet("session", flag.ExitOnError)
	format := fs.String("format", "box", "box|markdown|csv|json")
	bucket := fs.Int("bucket", 0, "if >0, aggregate into time-slices of N seconds instead of raw events")
	includeSC := fs.Bool("sidechain", false, "include subagent (sidechain) events")
	dataDir := fs.String("data", "", "working data dir")
	limit := fs.Int("limit", 400, "max raw events to show")
	fs.Parse(args)
	if id == "" {
		return fmt.Errorf("usage: cch session <session-id-or-prefix>  (list ids with: cch report sessions)")
	}
	if err := mustDuckDB(); err != nil {
		return err
	}
	p, err := resolve("", *dataDir)
	if err != nil {
		return err
	}
	if err := dbReady(p); err != nil {
		return err
	}

	// Resolve id by prefix.
	idLit := "'" + strings.ReplaceAll(id, "'", "''") + "%'"
	rows, err := ddb.QueryJSON(context.Background(), p,
		"SELECT session_id FROM sessions WHERE session_id LIKE "+idLit+" LIMIT 2")
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("no session matches %q", id)
	}
	full, _ := rows[0]["session_id"].(string)
	sid := "'" + strings.ReplaceAll(full, "'", "''") + "'"

	// Header.
	hdr, err := ddb.Formatted(p, `SELECT session_id, project, ai_title, round(duration_sec) AS dur_sec,
		n_user AS prompts, n_tool_use AS tools, total_tokens, models
		FROM v_session_rollup WHERE session_id=`+sid, *format)
	if err != nil {
		return err
	}
	fmt.Print(hdr)
	fmt.Println()

	scFilter := " AND NOT is_sidechain"
	if *includeSC {
		scFilter = ""
	}

	var body string
	if *bucket > 0 {
		body, err = ddb.Formatted(p, fmt.Sprintf(`SELECT
			CAST(floor(offset_sec/%d) AS BIGINT)*%d AS t_sec,
			count(*) FILTER (WHERE kind='tool') AS tools,
			count(*) FILTER (WHERE kind='prompt') AS prompts,
			count(*) FILTER (WHERE kind='assistant') AS turns,
			sum(total_tokens) AS tokens,
			sum(duration_ms) FILTER (WHERE kind='tool' AND duration_ms>=0) AS tool_ms,
			max(cum_tokens) AS cum_tokens
			FROM v_events WHERE session_id=%s%s
			GROUP BY 1 ORDER BY 1`, *bucket, *bucket, sid, scFilter), *format)
	} else {
		body, err = ddb.Formatted(p, fmt.Sprintf(`SELECT seq, round(offset_sec) AS t_sec, kind, label, category,
			CASE WHEN total_tokens>0 THEN total_tokens END AS tokens,
			duration_ms, is_error
			FROM v_events WHERE session_id=%s%s
			ORDER BY ts_ms, seq LIMIT %d`, sid, scFilter, *limit), *format)
	}
	if err != nil {
		return err
	}
	fmt.Print(body)
	return nil
}
