package parse

import (
	"encoding/json"
	"sort"
	"strings"
)

// ToolInfo is the classified shape of a single tool_use.
type ToolInfo struct {
	Category  string // file|search|bash|agent|skill|task|web|plan|mcp|lsp|toolsearch|interaction|other
	Plugin    string // owning plugin name, when known
	MCPServer string // mcp server name for mcp__ tools
	Skill     string // skill name for Skill tool
	Subagent  string // subagent_type for Agent tool
}

var toolCategory = map[string]string{
	"Read": "file", "Write": "file", "Edit": "file", "MultiEdit": "file", "NotebookEdit": "file",
	"Grep": "search", "Glob": "search", "LS": "search",
	"Bash": "bash", "BashOutput": "bash", "KillBash": "bash", "KillShell": "bash",
	"Agent":      "agent",
	"Skill":      "skill",
	"TaskCreate": "task", "TaskUpdate": "task", "TaskList": "task", "TaskGet": "task",
	"TaskOutput": "task", "TaskStop": "task",
	"WebSearch": "web", "WebFetch": "web",
	"ExitPlanMode": "plan", "EnterPlanMode": "plan",
	"EnterWorktree": "plan", "ExitWorktree": "plan",
	"ToolSearch":      "toolsearch",
	"AskUserQuestion": "interaction",
	"LSP":             "lsp",
	"Monitor":         "other", "Workflow": "agent",
}

// Classify inspects a tool name + input and returns its classification.
// pluginNames is the set of known installed plugin names (used to split the
// plugin segment out of mcp__plugin_<plugin>_<server>__<tool> names).
func Classify(name string, input json.RawMessage, pluginNames []string) ToolInfo {
	ti := ToolInfo{Category: "other"}
	if c, ok := toolCategory[name]; ok {
		ti.Category = c
	}

	switch {
	case name == "Agent" || name == "Workflow":
		ti.Subagent = strField(input, "subagent_type")
	case name == "Skill":
		ti.Skill = strField(input, "skill")
		if i := strings.Index(ti.Skill, ":"); i > 0 {
			ti.Plugin = ti.Skill[:i]
		}
	case strings.HasPrefix(name, "mcp__"):
		ti.Category = "mcp"
		ti.Plugin, ti.MCPServer = parseMCP(name, pluginNames)
	}
	return ti
}

// parseMCP splits an mcp tool name into (plugin, server). Plugin is "" for
// user/global MCP servers that are not provided by a plugin.
func parseMCP(name string, pluginNames []string) (plugin, server string) {
	body := strings.TrimPrefix(name, "mcp__")
	// body = "<server>__<tool>" ; server may be "plugin_<plugin>_<server>"
	serverPart := body
	if i := strings.Index(body, "__"); i >= 0 {
		serverPart = body[:i]
	}
	if !strings.HasPrefix(serverPart, "plugin_") {
		return "", serverPart
	}
	rest := strings.TrimPrefix(serverPart, "plugin_")
	// Longest plugin-name prefix match: "<plugin>_<server>".
	sorted := append([]string(nil), pluginNames...)
	sort.Slice(sorted, func(i, j int) bool { return len(sorted[i]) > len(sorted[j]) })
	for _, p := range sorted {
		if rest == p {
			return p, ""
		}
		if strings.HasPrefix(rest, p+"_") {
			return p, strings.TrimPrefix(rest, p+"_")
		}
	}
	// Unknown plugin: best-effort — treat the whole rest as plugin.
	return rest, ""
}

func strField(raw json.RawMessage, key string) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	v, ok := m[key]
	if !ok {
		return ""
	}
	var s string
	if json.Unmarshal(v, &s) == nil {
		return s
	}
	return ""
}
