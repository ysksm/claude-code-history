-- Load normalized NDJSON tables (relative paths resolve to the data dir).
-- Explicit column types make loading robust even when a file is empty.

CREATE OR REPLACE TABLE sessions AS
SELECT * FROM read_json('sessions.ndjson', format='newline_delimited', columns={
  'session_id':'VARCHAR','project_slug':'VARCHAR','project_path':'VARCHAR',
  'project':'VARCHAR','file':'VARCHAR','ai_title':'VARCHAR'});

CREATE OR REPLACE TABLE messages AS
SELECT * FROM read_json('messages.ndjson', format='newline_delimited', columns={
  'uuid':'VARCHAR','parent_uuid':'VARCHAR','session_id':'VARCHAR','project_slug':'VARCHAR',
  'ts':'VARCHAR','ts_ms':'BIGINT','type':'VARCHAR','role':'VARCHAR','model':'VARCHAR',
  'input_tokens':'BIGINT','output_tokens':'BIGINT','cache_read':'BIGINT','cache_creation':'BIGINT',
  'total_tokens':'BIGINT','service_tier':'VARCHAR','web_search':'BIGINT','web_fetch':'BIGINT',
  'n_tool_use':'BIGINT','n_thinking':'BIGINT','text_len':'BIGINT','is_sidechain':'BOOLEAN',
  'git_branch':'VARCHAR','version':'VARCHAR'});

CREATE OR REPLACE TABLE tool_calls AS
SELECT * FROM read_json('tool_calls.ndjson', format='newline_delimited', columns={
  'id':'VARCHAR','session_id':'VARCHAR','project_slug':'VARCHAR','ts':'VARCHAR','ts_ms':'BIGINT',
  'assistant_uuid':'VARCHAR','name':'VARCHAR','category':'VARCHAR','plugin':'VARCHAR',
  'mcp_server':'VARCHAR','skill':'VARCHAR','subagent':'VARCHAR','is_sidechain':'BOOLEAN',
  'input_len':'BIGINT','detail':'VARCHAR','in_lines':'BIGINT','del_lines':'BIGINT','model':'VARCHAR'});

CREATE OR REPLACE TABLE tool_results AS
SELECT * FROM read_json('tool_results.ndjson', format='newline_delimited', columns={
  'tool_use_id':'VARCHAR','session_id':'VARCHAR','project_slug':'VARCHAR','ts':'VARCHAR',
  'ts_ms':'BIGINT','is_error':'BOOLEAN','output_len':'BIGINT','is_sidechain':'BOOLEAN'});

CREATE OR REPLACE TABLE prompts AS
SELECT * FROM read_json('prompts.ndjson', format='newline_delimited', columns={
  'session_id':'VARCHAR','project_slug':'VARCHAR','ts':'VARCHAR','ts_ms':'BIGINT',
  'kind':'VARCHAR','command':'VARCHAR','text_len':'BIGINT','source':'VARCHAR','is_sidechain':'BOOLEAN'});

CREATE OR REPLACE TABLE plugins AS
SELECT * FROM read_json('plugins.ndjson', format='newline_delimited', columns={
  'name':'VARCHAR','marketplace':'VARCHAR','enabled':'BOOLEAN'});

CREATE OR REPLACE TABLE meta AS
SELECT * FROM read_json('meta.ndjson', format='newline_delimited', columns={
  'generated_at':'VARCHAR','model':'VARCHAR','effort_level':'VARCHAR','default_mode':'VARCHAR',
  'n_sessions':'BIGINT','n_projects':'BIGINT','claude_home':'VARCHAR'});
