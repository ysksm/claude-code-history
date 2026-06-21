# Dashboard Navigation Restructure — Design Spec

Date: 2026-06-21
Status: Design
Scope: Frontend only (`frontend/src`). No backend changes.

## Goal

Restructure the "cch" dashboard into a clear three-level information architecture
with progressive drilldown. The top navigation collapses to exactly three items —
**Overview / Projects / Sessions** — and each level drills into the next:

```
Overview (all projects, global summary)
  -> Projects (list of projects; multi-select)
       -> ProjectOverview (one project's summary + its sessions)            [single]
       -> ProjectsCompare (compare/aggregate over N selected projects)      [multi]
            -> SessionDetail (one session's overview + waterfall + events)  [history]
  -> Sessions (cross-project flat list)
       -> SessionDetail (same session history view)
```

The user can move from the global picture, down to a single or multiple projects,
into an individual session, and finally into that session's full event history.

## Routes (react-router v6 / react-router-dom)

| Path                              | Component        | Purpose                                                  |
| --------------------------------- | ---------------- | -------------------------------------------------------- |
| `/`                               | Overview         | Existing component; all-projects global summary.         |
| `/projects`                       | ProjectsList     | NEW. Project cards/table, multi-select + "compare selected". |
| `/projects/:slug`                 | ProjectOverview  | NEW. One project's summary + its sessions.               |
| `/projects/compare?slugs=a,b,c`   | ProjectsCompare  | NEW. Compare vs aggregate tabs over selected projects.   |
| `/sessions`                       | SessionList      | Existing; cross-project flat list.                       |
| `/sessions/:id`                   | SessionDetail    | Existing; session overview + waterfall + events.         |

The top nav renders three `<Link>`s pointing at `/`, `/projects`, and `/sessions`.
The active item is highlighted using the existing `active`/`tabs`/`topbar` CSS classes.

## Data Flow

All data is fetched through the existing `api` object in `frontend/src/api.ts`
via the `useAsync(loader, deps)` hook. The project filter parameter is the **slug**.

| Screen           | API calls                                                                 |
| ---------------- | ------------------------------------------------------------------------- |
| Overview         | `api.overview()` (no filter).                                             |
| ProjectsList     | `api.projects()` -> `ProjectRow[]` for the table/cards.                   |
| ProjectOverview  | `api.overview({ project: slug })` for the summary cards; `api.sessions({ project: slug })` for the session list. |
| ProjectsCompare  | N parallel `api.overview({ project: slug })` calls, one per selected slug (see below). |
| SessionList      | `api.sessions()` (existing behavior).                                     |
| SessionDetail    | `api.sessionMeta(id)`, `api.events(id, sidechain)`, `api.minutes(id)` (existing behavior). |

### Multi-project compare / aggregate (client-side)

There is no backend endpoint that aggregates multiple projects. ProjectsCompare
solves this entirely client-side:

1. Parse `slugs` from the `?slugs=a,b,c` query param (comma-separated).
2. Issue **N parallel** `api.overview({ project: slug })` calls via
   `Promise.all`, producing `Overview[]` (one row per slug, order preserved).
3. **Compare tab** renders the per-project `Overview` rows side by side
   (a table keyed by slug, one column/row per project).
4. **Aggregate tab** calls `aggregateOverviews(rows)` from
   `frontend/src/lib/aggregate.ts`, which **sums every numeric field** across the
   rows, except `projects`, which is set to the **count of selected slugs**.
   The result is a single synthetic `Overview` rendered through `<Cards>`.

This keeps the backend untouched; the only "join" logic is the pure
`aggregateOverviews` summation.

## Component Plan

### New components (`frontend/src/components/`)
- **ProjectsList.tsx** — loads `api.projects()`; renders a cards/table view with a
  selection checkbox per row, a "compare selected" action, and per-row `<Link>` to
  `/projects/:slug`. "Compare selected" navigates (via `useNavigate`) to
  `/projects/compare?slugs=...` built from the checked slugs.
- **ProjectOverview.tsx** — reads `:slug` via `useParams`; loads
  `api.overview({ project: slug })` for `<Cards>` and `api.sessions({ project: slug })`
  for a session table whose rows `<Link>` to `/sessions/:id`.
- **ProjectsCompare.tsx** — reads `slugs` via `useSearchParams`; fans out N
  `api.overview` calls; renders the existing `tabs`/`seg` UI with two tabs
  (Compare, Aggregate) as described above.

### New helpers
- **lib/aggregate.ts** — already created in the Foundation phase.
  `export aggregateOverviews(rows: Overview[]): Overview`. Pure function; sums
  numeric fields, sets `projects` to `rows.length` (count of selected). Suitable
  for isolated unit testing.
- **components/Breadcrumb.tsx** — small presentational component rendering a back
  trail (e.g. `Projects / <slug> / <session>`) using `<Link>`. Used by
  ProjectOverview, ProjectsCompare, and SessionDetail's wrapper for the drilldown
  "back" affordance.

### Wrapping existing components (unchanged source)
`Overview.tsx`, `SessionList.tsx`, and `SessionDetail.tsx` MUST remain unchanged.
They are wired into the router in **App.tsx** via thin **router adapters** —
small wrapper functions that pull route params (e.g. `useParams` for the session
`id`) and pass them as props to the existing component, so the existing component
never needs to know about the router.

### Bootstrap
**main.tsx** gains a single `<BrowserRouter>` wrapping `<App />`. App.tsx defines
the `<Routes>`/`<Route>` table and the three-item top nav. No other dependency is
added beyond `react-router-dom`.

## Error / Edge Cases
- **Invalid `:slug`** (ProjectOverview): the filtered `api.overview`/`api.sessions`
  return empty/zero data. Render an empty state ("No data for this project") plus a
  back `<Link>` to `/projects`. Network errors surface via `useAsync`'s `error`
  using the `error` CSS class.
- **Invalid `:id`** (SessionDetail wrapper): existing component already handles
  missing data; the wrapper adds a back `<Link>` to the originating list.
- **Compare with 0 slugs**: redirect to `/projects` (nothing to compare).
- **Compare with 1 slug**: redirect to `/projects/:slug` (ProjectOverview is the
  natural single-project view). Both redirects use `<Navigate replace>` so the
  degenerate compare URL does not pollute history.
- **Malformed `slugs` param** (empty entries after split/trim): filtered out before
  counting; if the resulting list is empty, treat as the 0-slug case.

## Testing
- **Type-check + build**: `tsc` (no type errors) and `vite build` must pass.
- **Unit test**: `aggregateOverviews` is a pure function — unit-tested directly by
  feeding sample `Overview[]` and asserting summed numeric fields and
  `projects === rows.length`. No DOM or network needed.
- Manual smoke: navigate the full drilldown
  Overview -> Projects -> (single) ProjectOverview -> SessionDetail, and
  Projects -> multi-select -> Compare (both tabs), verifying redirects on 0/1 slug.
