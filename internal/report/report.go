// Package report defines the named analyses exposed by `cch report` and the
// dashboard API, each backed by a SQL query over the DuckDB views.
package report

// Report is a named analysis.
type Report struct {
	Key   string
	Title string
	Desc  string
	SQL   string
}

// All reports, in display order. `cch report all` runs them top to bottom.
var All = []Report{
	{"overview", "Overview", "Headline totals across all history",
		`SELECT * FROM v_overview`},

	{"tokens", "Token usage by model", "Input/output/cache tokens per model",
		`SELECT * FROM v_model_usage`},

	{"projects", "Projects", "Sessions, tool calls and tokens per project",
		`SELECT * FROM v_project_rollup`},

	{"daily", "Daily trend", "Activity and tokens per day",
		`SELECT * FROM v_daily`},

	{"tools", "Tool usage", "Calls, errors and timing per tool",
		`SELECT * FROM v_tool_usage LIMIT 40`},

	{"categories", "Tool categories", "Usage grouped by tool category",
		`SELECT * FROM v_category_usage`},

	{"plugins", "Plugin adoption", "Installed plugins vs. observed usage",
		`SELECT * FROM v_plugin_adoption`},

	{"skills", "Skill usage", "Built-in and plugin skill invocations",
		`SELECT * FROM v_skill_usage`},

	{"subagents", "Subagent usage", "Agent tool / subagent invocations",
		`SELECT * FROM v_subagent_usage`},

	{"commands", "Slash commands", "Slash command frequency",
		`SELECT * FROM v_command_usage`},

	{"mcp", "MCP servers", "MCP server usage (plugin and user/global)",
		`SELECT * FROM v_mcp_usage`},

	{"workflow", "Tool transitions", "Most common consecutive tool-category pairs",
		`SELECT * FROM v_tool_transitions LIMIT 30`},

	{"timing", "Timing summary", "Assistant step and tool-duration latencies (ms)",
		`SELECT * FROM v_timing_summary`},

	{"sessions", "Top sessions", "Largest sessions by total tokens",
		`SELECT session_id, project, ai_title, round(duration_sec) AS dur_sec,
		        n_user, n_tool_use, total_tokens
		 FROM v_session_rollup ORDER BY total_tokens DESC LIMIT 30`},
}

// Find returns the report with the given key.
func Find(key string) (Report, bool) {
	for _, r := range All {
		if r.Key == key {
			return r, true
		}
	}
	return Report{}, false
}

// Keys returns all report keys.
func Keys() []string {
	ks := make([]string, len(All))
	for i, r := range All {
		ks[i] = r.Key
	}
	return ks
}
