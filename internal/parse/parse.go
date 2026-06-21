// Package parse decodes Claude Code session transcript records (JSONL) and
// classifies tool calls (file/bash/agent/mcp/skill/plugin/...).
package parse

import (
	"encoding/json"
	"strings"
	"time"
)

// Record is one line of a session .jsonl file. Only the fields we use are
// declared; everything else is ignored. message is kept raw so we can decode
// it differently per record type.
type Record struct {
	Type         string          `json:"type"`
	UUID         string          `json:"uuid"`
	ParentUUID   string          `json:"parentUuid"`
	SessionID    string          `json:"sessionId"`
	Timestamp    string          `json:"timestamp"`
	CWD          string          `json:"cwd"`
	GitBranch    string          `json:"gitBranch"`
	Version      string          `json:"version"`
	IsSidechain  bool            `json:"isSidechain"`
	UserType     string          `json:"userType"`
	PromptSource string          `json:"promptSource"`
	RequestID    string          `json:"requestId"`
	AITitle      string          `json:"aiTitle"`
	Message      json.RawMessage `json:"message"`
}

// Message is the inner assistant/user message payload.
type Message struct {
	Role    string          `json:"role"`
	Model   string          `json:"model"`
	Content json.RawMessage `json:"content"` // string OR []ContentBlock
	Usage   *Usage          `json:"usage"`
}

// Usage holds token accounting for an assistant turn.
type Usage struct {
	InputTokens         int    `json:"input_tokens"`
	OutputTokens        int    `json:"output_tokens"`
	CacheReadTokens     int    `json:"cache_read_input_tokens"`
	CacheCreationTokens int    `json:"cache_creation_input_tokens"`
	ServiceTier         string `json:"service_tier"`
	ServerToolUse       struct {
		WebSearch int `json:"web_search_requests"`
		WebFetch  int `json:"web_fetch_requests"`
	} `json:"server_tool_use"`
}

// ContentBlock is one element of a structured message content array.
type ContentBlock struct {
	Type      string          `json:"type"` // text|thinking|tool_use|tool_result
	Text      string          `json:"text"`
	Thinking  string          `json:"thinking"`
	ID        string          `json:"id"`    // tool_use id
	Name      string          `json:"name"`  // tool name
	Input     json.RawMessage `json:"input"` // tool input
	ToolUseID string          `json:"tool_use_id"`
	Content   json.RawMessage `json:"content"` // tool_result content (string OR array)
	IsError   bool            `json:"is_error"`
}

// ParseMessage decodes the raw message field.
func (r Record) ParseMessage() (*Message, error) {
	if len(r.Message) == 0 {
		return nil, nil
	}
	var m Message
	if err := json.Unmarshal(r.Message, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// AsString returns the message content if it is a bare string (a real user
// prompt or slash command), else ("", false).
func (m *Message) AsString() (string, bool) {
	if len(m.Content) == 0 || m.Content[0] != '"' {
		return "", false
	}
	var s string
	if err := json.Unmarshal(m.Content, &s); err != nil {
		return "", false
	}
	return s, true
}

// Blocks returns the message content as a slice of blocks (empty if it was a
// bare string).
func (m *Message) Blocks() []ContentBlock {
	if len(m.Content) == 0 || m.Content[0] != '[' {
		return nil
	}
	var blocks []ContentBlock
	if err := json.Unmarshal(m.Content, &blocks); err != nil {
		return nil
	}
	return blocks
}

// TimeMillis parses an ISO-8601 timestamp to epoch milliseconds (0 if empty
// or unparseable).
func TimeMillis(iso string) int64 {
	if iso == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		t, err = time.Parse(time.RFC3339, iso)
		if err != nil {
			return 0
		}
	}
	return t.UnixMilli()
}

// ResultText flattens a tool_result content (string or array of text blocks)
// to a plain string for length measurement.
func ResultText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	if raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
		return ""
	}
	var blocks []ContentBlock
	if json.Unmarshal(raw, &blocks) == nil {
		var sb strings.Builder
		for _, b := range blocks {
			sb.WriteString(b.Text)
		}
		return sb.String()
	}
	return ""
}

// SlashCommand extracts a "/name" from a user string that embeds
// <command-name>/name</command-name>, or from a plain "/name ..." prompt.
// Returns ("", false) if the text is an ordinary prompt.
func SlashCommand(text string) (string, bool) {
	if i := strings.Index(text, "<command-name>"); i >= 0 {
		rest := text[i+len("<command-name>"):]
		if j := strings.Index(rest, "</command-name>"); j >= 0 {
			name := strings.TrimSpace(rest[:j])
			name = strings.TrimPrefix(name, "/")
			return name, name != ""
		}
	}
	t := strings.TrimSpace(text)
	if strings.HasPrefix(t, "/") && !strings.ContainsAny(t, "\n") {
		f := strings.Fields(t[1:])
		if len(f) > 0 {
			return f[0], true
		}
	}
	return "", false
}
