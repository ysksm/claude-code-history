import { useMemo, useState } from "react";

export type Period = "all" | "today" | "week" | "month" | "custom";

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Resolve a preset period into a {from,to} date range (empty = unbounded).
export function presetRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    const d = new Date(now);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow);
    return { from: ymd(d), to: today };
  }
  if (period === "month") {
    return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  return { from: "", to: "" };
}

// usePeriodFilter owns the period state and returns the current {from,to} range
// plus a `control` element to render. Shared by Overview / Projects / Sessions.
export function usePeriodFilter() {
  const [period, setPeriod] = useState<Period>("all");
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");

  const { from, to } = useMemo(
    () => (period === "custom" ? { from: cFrom, to: cTo } : presetRange(period)),
    [period, cFrom, cTo],
  );

  const Btn = ({ p, label }: { p: Period; label: string }) => (
    <button className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>{label}</button>
  );

  const control = (
    <span className="period-filter">
      <span className="seg">
        <Btn p="all" label="All" />
        <Btn p="today" label="Today" />
        <Btn p="week" label="This week" />
        <Btn p="month" label="This month" />
        <Btn p="custom" label="Custom" />
      </span>
      {period === "custom" && (
        <span className="filt-group">
          <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
          <span className="muted">→</span>
          <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} />
        </span>
      )}
      {(from || to) && <span className="muted">{from || "…"} → {to || "…"}</span>}
    </span>
  );

  return { from, to, control };
}
