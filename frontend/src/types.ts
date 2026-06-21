export interface Overview {
  sessions: number;
  projects: number;
  prompts: number;
  slash_commands: number;
  tool_calls: number;
  plugin_tool_calls: number;
  subagent_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
}

export interface ProjectRow {
  project: string;
  project_slug: string;
  sessions: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  total_tokens: number;
}

export interface SessionRow {
  session_id: string;
  project: string;
  ai_title: string | null;
  duration_sec: number;
  prompts: number;
  tool_calls: number;
  total_tokens: number;
  day: string;
}

export interface SessionMeta {
  session_id: string;
  project: string;
  ai_title: string | null;
  duration_sec: number;
  first_ms: number;
  last_ms: number;
  prompts: number;
  turns: number;
  tools: number;
  n_subagent_msgs: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  total_tokens: number;
  models: string | null;
  day: string;
}

export interface EventRow {
  seq: number;
  ts_ms: number;
  offset_sec: number;
  kind: "prompt" | "assistant" | "tool";
  label: string;
  category: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number | null;
  is_error: boolean;
  size: number;
  cum_tokens: number;
}

export interface MinuteRow {
  minute: number;
  tool_calls: number;
  prompts: number;
  assistant_turns: number;
  tokens: number;
  out_tokens: number;
  in_tokens: number;
  tool_ms: number;
  cum_tokens: number;
}

export interface FilterRow {
  slug: string;
  name: string;
  min_day: string;
  max_day: string;
  models: string;
}
