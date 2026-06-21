import type {
  Overview, ProjectRow, SessionRow, SessionMeta, EventRow, MinuteRow, FilterRow,
} from "./types";

type Params = Record<string, string | number | boolean | undefined>;

async function get<T>(path: string, params: Params = {}): Promise<T[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = `/api/${path}${qs.toString() ? "?" + qs : ""}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T[];
}

const one = async <T>(path: string, params?: Params): Promise<T | undefined> =>
  (await get<T>(path, params))[0];

export const api = {
  overview: (p?: Params) => one<Overview>("overview", { sidechain: "include", ...p }),
  projects: (p?: Params) => get<ProjectRow>("projects", { sidechain: "include", ...p }),
  filters: () => get<FilterRow>("filters"),
  sessions: (p?: Params) => get<SessionRow>("sessions", { sidechain: "include", ...p }),
  sessionMeta: (id: string) => one<SessionMeta>("session_meta", { id }),
  events: (id: string, sidechain: boolean) =>
    get<EventRow>("session", { id, sidechain: sidechain ? "include" : "" }),
  minutes: (id: string) => get<MinuteRow>("session_minutes", { id }),
};
