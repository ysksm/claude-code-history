export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

export function fmtDur(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "";
  if (sec >= 3600) return (sec / 3600).toFixed(1) + "h";
  if (sec >= 60) return (sec / 60).toFixed(1) + "m";
  return Math.round(sec) + "s";
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  if (ms >= 3600000) return (ms / 3600000).toFixed(1) + "h";
  if (ms >= 60000) return (ms / 60000).toFixed(1) + "m";
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms) + "ms";
}

// Epoch millis → local clock "HH:MM:SS".
export function fmtClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  return new Date(ms).toLocaleTimeString("ja-JP", { hour12: false });
}

// Epoch millis → local "YYYY-MM-DD HH:MM:SS".
export function fmtDateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Stable color per tool category.
export const CATEGORY_COLOR: Record<string, string> = {
  file: "#4493f8", bash: "#3fb950", mcp: "#d97757", agent: "#a371f7",
  task: "#d29922", search: "#56d4dd", assistant: "#6e7681", user: "#f778ba",
  web: "#db61a2", skill: "#e3b341", plan: "#bc8cff", toolsearch: "#39c5cf",
  interaction: "#f778ba", lsp: "#57ab5a", other: "#8b949e",
};

export const catColor = (c: string): string => CATEGORY_COLOR[c] ?? CATEGORY_COLOR.other;
