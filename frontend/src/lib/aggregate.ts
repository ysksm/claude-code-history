import type { Overview } from "../types";

export function aggregateOverviews(rows: Overview[]): Overview {
  const sum: Overview = {
    sessions: 0,
    projects: rows.length,
    prompts: 0,
    slash_commands: 0,
    tool_calls: 0,
    plugin_tool_calls: 0,
    subagent_calls: 0,
    code_added: 0,
    code_removed: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
  };
  for (const r of rows) {
    sum.sessions += r.sessions;
    sum.prompts += r.prompts;
    sum.slash_commands += r.slash_commands;
    sum.tool_calls += r.tool_calls;
    sum.plugin_tool_calls += r.plugin_tool_calls;
    sum.subagent_calls += r.subagent_calls;
    sum.code_added += r.code_added;
    sum.code_removed += r.code_removed;
    sum.input_tokens += r.input_tokens;
    sum.output_tokens += r.output_tokens;
    sum.cache_read_tokens += r.cache_read_tokens;
    sum.total_tokens += r.total_tokens;
  }
  return sum;
}
