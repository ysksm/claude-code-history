-- Analysis views over the loaded tables.
-- ts_ms is epoch milliseconds; to_timestamp expects seconds.

-- Enriched messages with wall-clock timestamp, day, and per-session latency.
CREATE OR REPLACE VIEW v_messages AS
SELECT
  m.*,
  to_timestamp(ts_ms / 1000.0)                               AS t,
  CAST(to_timestamp(ts_ms / 1000.0) AS DATE)                 AS day,
  date_trunc('hour', to_timestamp(ts_ms / 1000.0))           AS hour,
  ts_ms - lag(ts_ms) OVER (PARTITION BY session_id ORDER BY ts_ms) AS step_ms
FROM messages m;

-- Per-tool execution time: match each call to its result by id.
CREATE OR REPLACE VIEW v_tool_timing AS
SELECT
  c.id, c.session_id, c.project_slug, c.name, c.category, c.plugin,
  c.mcp_server, c.skill, c.subagent, c.is_sidechain, c.model,
  c.detail, c.in_lines, c.del_lines,
  c.ts_ms AS call_ms, r.ts_ms AS result_ms,
  (r.ts_ms - c.ts_ms) AS duration_ms,
  r.is_error, r.output_len
FROM tool_calls c
LEFT JOIN tool_results r ON r.tool_use_id = c.id;

-- Per-session rollup.
CREATE OR REPLACE VIEW v_session_rollup AS
SELECT
  s.session_id, s.project, s.project_slug, s.ai_title,
  min(m.ts_ms) AS first_ms, max(m.ts_ms) AS last_ms,
  (max(m.ts_ms) - min(m.ts_ms)) / 1000.0 AS duration_sec,
  CAST(to_timestamp(min(m.ts_ms)/1000.0) AS DATE) AS day,
  count(*) FILTER (WHERE m.type='user' AND NOT m.is_sidechain)      AS n_user,
  count(*) FILTER (WHERE m.type='assistant' AND NOT m.is_sidechain) AS n_assistant,
  count(*) FILTER (WHERE m.type='assistant' AND m.is_sidechain)     AS n_subagent_msgs,
  coalesce(sum(m.n_tool_use),0)    AS n_tool_use,
  coalesce(sum(m.input_tokens),0)  AS input_tokens,
  coalesce(sum(m.output_tokens),0) AS output_tokens,
  coalesce(sum(m.cache_read),0)    AS cache_read,
  coalesce(sum(m.cache_creation),0) AS cache_creation,
  coalesce(sum(m.total_tokens),0)  AS total_tokens,
  string_agg(DISTINCT m.model, ', ') FILTER (WHERE m.model IS NOT NULL AND m.model<>'') AS models
FROM sessions s
LEFT JOIN messages m ON m.session_id = s.session_id
GROUP BY 1,2,3,4;

-- Per-project rollup.
CREATE OR REPLACE VIEW v_project_rollup AS
SELECT
  project,
  count(DISTINCT session_id) AS sessions,
  sum(n_user)        AS prompts,
  sum(n_tool_use)    AS tool_calls,
  sum(input_tokens)  AS input_tokens,
  sum(output_tokens) AS output_tokens,
  sum(cache_read)    AS cache_read,
  sum(total_tokens)  AS total_tokens,
  round(sum(duration_sec)/3600.0, 2) AS active_hours
FROM v_session_rollup
GROUP BY 1
ORDER BY total_tokens DESC;

-- Daily trends.
CREATE OR REPLACE VIEW v_daily AS
SELECT
  day,
  count(DISTINCT session_id)                       AS sessions,
  count(*) FILTER (WHERE type='user' AND NOT is_sidechain) AS prompts,
  coalesce(sum(n_tool_use),0)                       AS tool_calls,
  coalesce(sum(input_tokens),0)                     AS input_tokens,
  coalesce(sum(output_tokens),0)                    AS output_tokens,
  coalesce(sum(cache_read),0)                       AS cache_read,
  coalesce(sum(total_tokens),0)                     AS total_tokens
FROM v_messages
WHERE day IS NOT NULL
GROUP BY 1
ORDER BY 1;

-- Token usage by model.
CREATE OR REPLACE VIEW v_model_usage AS
SELECT
  coalesce(nullif(model,''),'(none)') AS model,
  count(*) FILTER (WHERE type='assistant') AS turns,
  sum(input_tokens)  AS input_tokens,
  sum(output_tokens) AS output_tokens,
  sum(cache_read)    AS cache_read,
  sum(cache_creation) AS cache_creation,
  sum(total_tokens)  AS total_tokens
FROM messages
WHERE type='assistant'
GROUP BY 1
ORDER BY total_tokens DESC;

-- Tool usage with timing.
CREATE OR REPLACE VIEW v_tool_usage AS
SELECT
  name, any_value(category) AS category,
  count(*) AS calls,
  count(*) FILTER (WHERE is_error) AS errors,
  round(100.0 * count(*) FILTER (WHERE is_error) / count(*), 1) AS error_pct,
  count(DISTINCT session_id) AS sessions,
  round(avg(duration_ms) FILTER (WHERE duration_ms >= 0)) AS avg_ms,
  round(quantile_cont(duration_ms, 0.5) FILTER (WHERE duration_ms >= 0)) AS p50_ms,
  round(quantile_cont(duration_ms, 0.95) FILTER (WHERE duration_ms >= 0)) AS p95_ms,
  coalesce(sum(output_len),0) AS total_output_bytes
FROM v_tool_timing
GROUP BY name
ORDER BY calls DESC;

-- Tool usage by category.
CREATE OR REPLACE VIEW v_category_usage AS
SELECT
  category,
  count(*) AS calls,
  count(DISTINCT session_id) AS sessions,
  round(avg(duration_ms) FILTER (WHERE duration_ms >= 0)) AS avg_ms,
  round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct_of_calls
FROM v_tool_timing
GROUP BY category
ORDER BY calls DESC;

-- Plugin usage. A plugin "touch" is any tool_call whose plugin column is set
-- (MCP plugin tools and namespaced Skills).
CREATE OR REPLACE VIEW v_plugin_usage AS
SELECT
  t.plugin AS name,
  any_value(p.enabled) AS enabled,
  count(*) AS calls,
  count(DISTINCT t.session_id) AS sessions,
  count(DISTINCT t.project_slug) AS projects,
  count(*) FILTER (WHERE t.is_error) AS errors,
  round(avg(t.duration_ms) FILTER (WHERE t.duration_ms >= 0)) AS avg_ms,
  round(quantile_cont(t.duration_ms, 0.95) FILTER (WHERE t.duration_ms >= 0)) AS p95_ms,
  coalesce(sum(t.output_len),0) AS total_output_bytes
FROM v_tool_timing t
LEFT JOIN plugins p ON p.name = t.plugin
WHERE t.plugin IS NOT NULL AND t.plugin <> ''
GROUP BY t.plugin
ORDER BY calls DESC;

-- Installed plugins joined with observed usage (adoption view: shows enabled
-- plugins that are never actually used).
CREATE OR REPLACE VIEW v_plugin_adoption AS
SELECT
  p.name, p.marketplace, p.enabled,
  coalesce(u.calls,0) AS calls,
  coalesce(u.sessions,0) AS sessions,
  coalesce(u.projects,0) AS projects,
  u.avg_ms
FROM plugins p
LEFT JOIN v_plugin_usage u ON u.name = p.name
ORDER BY calls DESC, p.name;

-- Skill usage (built-in + plugin skills).
CREATE OR REPLACE VIEW v_skill_usage AS
SELECT
  skill,
  coalesce(nullif(plugin,''),'(builtin)') AS plugin,
  count(*) AS calls,
  count(DISTINCT session_id) AS sessions,
  count(DISTINCT project_slug) AS projects
FROM tool_calls
WHERE category='skill' AND skill IS NOT NULL AND skill <> ''
GROUP BY skill, plugin
ORDER BY calls DESC;

-- Subagent usage (Agent tool).
CREATE OR REPLACE VIEW v_subagent_usage AS
SELECT
  coalesce(nullif(subagent,''),'(default)') AS subagent,
  count(*) AS calls,
  count(DISTINCT session_id) AS sessions,
  count(DISTINCT project_slug) AS projects
FROM tool_calls
WHERE category='agent'
GROUP BY 1
ORDER BY calls DESC;

-- Slash command usage.
CREATE OR REPLACE VIEW v_command_usage AS
SELECT
  command,
  count(*) AS uses,
  count(DISTINCT session_id) AS sessions,
  count(DISTINCT project_slug) AS projects
FROM prompts
WHERE kind='command' AND command IS NOT NULL AND command <> '' AND NOT is_sidechain
GROUP BY command
ORDER BY uses DESC;

-- MCP server usage (plugin and non-plugin).
CREATE OR REPLACE VIEW v_mcp_usage AS
SELECT
  coalesce(nullif(mcp_server,''),'(plugin-level)') AS mcp_server,
  coalesce(nullif(plugin,''),'(user/global)') AS plugin,
  count(*) AS calls,
  count(DISTINCT session_id) AS sessions
FROM tool_calls
WHERE category='mcp'
GROUP BY 1,2
ORDER BY calls DESC;

-- Workflow: consecutive tool-category transitions within a session.
CREATE OR REPLACE VIEW v_tool_transitions AS
WITH seq AS (
  SELECT session_id, category, ts_ms,
    lag(category) OVER (PARTITION BY session_id ORDER BY ts_ms) AS prev
  FROM tool_calls
)
SELECT prev AS from_category, category AS to_category, count(*) AS transitions
FROM seq
WHERE prev IS NOT NULL
GROUP BY 1,2
ORDER BY transitions DESC;

-- Latency: assistant response gaps and tool durations, summarized.
CREATE OR REPLACE VIEW v_timing_summary AS
SELECT
  'assistant_step' AS metric, count(*) AS n,
  round(avg(step_ms)) AS avg_ms,
  round(quantile_cont(step_ms, 0.5)) AS p50_ms,
  round(quantile_cont(step_ms, 0.95)) AS p95_ms,
  round(max(step_ms)) AS max_ms
FROM v_messages
WHERE type='assistant' AND step_ms IS NOT NULL AND step_ms >= 0
UNION ALL
SELECT
  'tool_duration', count(*),
  round(avg(duration_ms)),
  round(quantile_cont(duration_ms, 0.5)),
  round(quantile_cont(duration_ms, 0.95)),
  round(max(duration_ms))
FROM v_tool_timing
WHERE duration_ms IS NOT NULL AND duration_ms >= 0;

-- Headline overview (single row).
CREATE OR REPLACE VIEW v_overview AS
SELECT
  (SELECT count(*) FROM sessions)                                   AS sessions,
  (SELECT count(DISTINCT project_slug) FROM sessions)              AS projects,
  (SELECT count(*) FROM prompts WHERE kind='prompt' AND NOT is_sidechain) AS prompts,
  (SELECT count(*) FROM prompts WHERE kind='command' AND NOT is_sidechain) AS slash_commands,
  (SELECT count(*) FROM tool_calls)                               AS tool_calls,
  (SELECT count(*) FROM tool_calls WHERE plugin IS NOT NULL AND plugin<>'') AS plugin_tool_calls,
  (SELECT count(*) FROM tool_calls WHERE category='agent')        AS subagent_calls,
  (SELECT coalesce(sum(input_tokens),0) FROM messages)            AS input_tokens,
  (SELECT coalesce(sum(output_tokens),0) FROM messages)           AS output_tokens,
  (SELECT coalesce(sum(cache_read),0) FROM messages)              AS cache_read_tokens,
  (SELECT coalesce(sum(total_tokens),0) FROM messages)            AS total_tokens,
  (SELECT round(sum(duration_sec)/3600.0,1) FROM v_session_rollup) AS active_hours;

-- Unified, chronological event stream per session: prompts, assistant turns and
-- tool calls interleaved on the timeline with tokens, duration and time offset.
CREATE OR REPLACE VIEW v_events AS
WITH ev AS (
  -- user prompts / slash commands
  SELECT session_id, ts_ms, 'prompt' AS kind,
    CASE WHEN kind='command' THEN '/'||command ELSE 'prompt' END AS label,
    'user' AS category, ''::VARCHAR AS detail, 0::BIGINT AS in_lines, 0::BIGINT AS del_lines,
    0::BIGINT AS input_tokens, 0::BIGINT AS output_tokens, 0::BIGINT AS cache_read,
    0::BIGINT AS total_tokens, NULL::BIGINT AS duration_ms, FALSE AS is_error,
    text_len AS size, is_sidechain, 0 AS ord
  FROM prompts
  UNION ALL
  -- assistant turns (carry the token accounting + the step latency in duration_ms)
  SELECT session_id, ts_ms, 'assistant' AS kind,
    coalesce(nullif(model,''),'assistant') AS label,
    'assistant' AS category, ''::VARCHAR AS detail, 0::BIGINT AS in_lines, 0::BIGINT AS del_lines,
    input_tokens, output_tokens, cache_read, total_tokens,
    step_ms AS duration_ms, FALSE AS is_error, text_len AS size, is_sidechain, 1 AS ord
  FROM v_messages WHERE type='assistant'
  UNION ALL
  -- tool calls (duration is wall-clock call->result)
  SELECT session_id, call_ms AS ts_ms, 'tool' AS kind,
    name AS label, category, detail, in_lines, del_lines,
    0,0,0,0, duration_ms, coalesce(is_error,FALSE), output_len AS size, is_sidechain, 2 AS ord
  FROM v_tool_timing
)
SELECT
  session_id, ts_ms, to_timestamp(ts_ms/1000.0) AS t,
  kind, label, category, detail, in_lines, del_lines,
  input_tokens, output_tokens, cache_read, total_tokens,
  duration_ms, is_error, size, is_sidechain,
  row_number() OVER w AS seq,
  round((ts_ms - min(ts_ms) OVER (PARTITION BY session_id)) / 1000.0, 1) AS offset_sec,
  sum(total_tokens) OVER w AS cum_tokens
FROM ev
WINDOW w AS (PARTITION BY session_id ORDER BY ts_ms, ord, kind);

-- Per-session, per-minute time slices: tokens and tool time bucketed by minute
-- since the session started.
CREATE OR REPLACE VIEW v_session_minutes AS
SELECT
  session_id,
  CAST(floor(offset_sec / 60.0) AS BIGINT) AS minute,
  count(*) FILTER (WHERE kind='tool')        AS tool_calls,
  count(*) FILTER (WHERE kind='prompt')      AS prompts,
  count(*) FILTER (WHERE kind='assistant')   AS assistant_turns,
  coalesce(sum(total_tokens),0)              AS tokens,
  coalesce(sum(output_tokens),0)             AS out_tokens,
  coalesce(sum(input_tokens),0)              AS in_tokens,
  coalesce(sum(duration_ms) FILTER (WHERE kind='tool' AND duration_ms>=0),0) AS tool_ms,
  max(cum_tokens)                            AS cum_tokens
FROM v_events
GROUP BY session_id, minute
ORDER BY session_id, minute;
