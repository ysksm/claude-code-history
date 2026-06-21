// Package ddb is a thin wrapper around the duckdb CLI. We shell out instead of
// using a CGO driver so the tool stays dependency-free and uses the user's
// already-installed duckdb.
package ddb

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/ysksm/claude-code-history/internal/source"
)

//go:embed schema.sql
var schemaSQL string

//go:embed views.sql
var viewsSQL string

// Available reports whether the duckdb CLI is on PATH.
func Available() bool {
	_, err := exec.LookPath("duckdb")
	return err == nil
}

// Build (re)creates the DuckDB database from the NDJSON tables in the data dir.
func Build(paths source.Paths) error {
	dbPath := paths.DBFile()
	_ = os.Remove(dbPath) // rebuild from scratch
	script := schemaSQL + "\n" + viewsSQL
	cmd := exec.Command("duckdb", "cch.duckdb")
	cmd.Dir = paths.DataDir // relative NDJSON + db paths resolve here
	cmd.Stdin = strings.NewReader(script)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("duckdb build: %v\n%s", err, stderr.String())
	}
	return nil
}

// Formatted runs a query and returns duckdb's own rendering in the given mode
// (box, markdown, csv, json, line).
func Formatted(paths source.Paths, sql, mode string) (string, error) {
	args := []string{"-readonly", "-" + mode, paths.DBFile(), "-c", sql}
	cmd := exec.Command("duckdb", args...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("query failed: %v\n%s", err, errb.String())
	}
	return out.String(), nil
}

// QueryJSON runs a query and decodes the JSON rows.
func QueryJSON(ctx context.Context, paths source.Paths, sql string) ([]map[string]any, error) {
	args := []string{"-readonly", "-json", paths.DBFile(), "-c", sql}
	cmd := exec.CommandContext(ctx, "duckdb", args...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("query failed: %v\n%s", err, errb.String())
	}
	trimmed := bytes.TrimSpace(out.Bytes())
	if len(trimmed) == 0 {
		return []map[string]any{}, nil
	}
	var rows []map[string]any
	if err := json.Unmarshal(trimmed, &rows); err != nil {
		return nil, fmt.Errorf("decode rows: %w", err)
	}
	return rows, nil
}
