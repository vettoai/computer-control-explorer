# Computer Control Explorer — Architecture & Build Plan

Status: **draft for review.** Internal planning doc (this repo is private for now). It
references Vetto Arena internals; before any open-sourcing, the public tree must contain
only cleanly-extracted, relicensed components — see §9.

---

## 1. Goal & non-goals

**Goal.** A self-contained, **read-only** web app that lets someone explore a
computer-control task dataset — browse tasks by category; read each task's files and
metadata; and inspect, per eval trial, the **parsed agent trajectory** (the commands the
agent ran), the **test results**, and the **oracle solve output**. Customer-grade,
shippable as static files, and (eventually) open-source so labs can audit it.

**Non-goals (v1).**
- No terminal-session *replay* (asciinema). The `.cast` exists but we render the parsed
  ATIF trajectory, not a screencast. If terminal replay is ever wanted it's an
  Arena-level feature, not explorer-specific.
- No backend/database, no auth, no annotator/review/campaign tooling, no writes.
- No new trajectory visualization — we reuse Arena's, which already parses our format.

---

## 2. What it shows

Per **task**: the file tree (`instruction.md`, `README.md`, `rubric.txt`, `task.toml`,
`solution/solve.sh`, `tests/`, `environment/`) + a metadata side panel (category,
keywords, difficulty from `task.toml`).

Per **trial** (when an eval run is present): parsed trajectory (command groups + raw
toggle), test results (pass/fail, score, trials), and the solve/oracle output.

Screens: **(A) task list** filtered by category · **(B) task detail** (files + metadata)
· **(C) trajectory view** (parsed + raw + results + solve). A per-task **runs side panel**
(list trials, pick one) is a **stretch**.

---

## 3. Tech stack (match Arena for clean component porting)

Mirror `vetto-arena` so ported components drop in unchanged:
- **Next.js 16** (App Router), **React 19**
- **Tailwind v4**, **shadcn/ui** ("new-york"), **Radix UI**, **lucide-react**, **cva**
- **zod** for parsing/validating `task.toml`/`result.json`
- Path aliases: `@/components`, `@/components/ui`, `@/lib`, `@/hooks`, `@/lib/utils`

No `@tanstack/react-query` / `swr` needed — data is loaded server-side (build or request),
not fetched client-side.

---

## 4. The single filesystem data layer + three run modes

One codebase. A single data module reads the dataset from **`DATASET_DIR`** and produces
the shapes Arena's components already consume. The three modes differ only in *when* that
read happens and the route-rendering config — toggled by one build flag (`EXPLORER_MODE`).

| Mode | Use | `output` | Routes | Data read |
|------|-----|----------|--------|-----------|
| **Static export** (v1 priority) | we build per-dataset at publish; ship `out/`; customer serves the folder | `export` | `generateStaticParams` over tasks/trials | **build time** |
| **Docker** | `docker run -v <dataset>:/data`; reads live | `standalone` | `force-dynamic` | **request time** |
| **Local dir** | `node server` with `DATASET_DIR=<path>` | `standalone` | `force-dynamic` | request time |

Because the data module is just async filesystem reads inside **Server Components**, the
*same* code runs at build time (export) or per request (server). `generateStaticParams`
(export) enumerates tasks/trials by listing the dataset; `force-dynamic` (server) skips
pre-render and reads the mounted dir live. (npx distribution is deferred — needs an npm
publish; Docker + static export cover the cases.)

**`DATASET_DIR` contract.** Points at a dataset bundle (e.g.
`computer-control-202605-hard20/`). Reads:
- `dataset/<slug>/` → task files + `task.toml` (category = first keyword).
- eval runs (from the Harbor **export script** output we ship, or raw `out/jobs/`):
  per trial, `trajectory.json` (ATIF), `verifier/`-style `result.json`, solve/oracle
  output. Exact exported layout: **to confirm** (§10).

---

## 5. Component reuse map (the crux — this is mostly porting)

From `vetto-arena/project-types/terminal-task/components/user-facing/`:

**Port as-is (pure / presentational — no backend coupling):**
- `lib/parse-atif-trajectory.ts` — `parseAtifTrajectory(content: string): ParsedAtifResult`
  (`{ entries, agent{name,model}, metrics }`). Pure string→data; feed it our
  `trajectory.json` content directly. Harbor emits ATIF for both terminus-2 and codex, and
  our `trajectory.json` *is* ATIF, so this parses exactly what we generate.
- `phases/trajectory-viewer.tsx` — `TrajectoryViewer({ entries, rawContent, loading,
  error, folderPath, footer, onFetchRaw })`. Presentational: command groups + parsed/raw
  toggle. Data-in only.
- `phases/run-result-utils.ts` — pure: `parseJobResult → ParsedRunResult {passed, mean,
  passRate, errors, trials}`, `deriveOracleStatus`, `deriveTrialScore`, `deriveTrialCount`.
  Feed our `result.json`.
- shadcn `components/ui/*`, `lib/utils` (`cn`), Tailwind tokens/theme.

**Replace (the one backend-coupled piece):**
- `hooks/use-trajectory-data.ts` — currently `apiFetch(...)` to the Arena API. Swap for a
  **filesystem loader** that reads the trial's `trajectory.json` (+ raw) and `result.json`
  from `DATASET_DIR` and returns the same `TrajectoryData` shape, then calls
  `parseAtifTrajectory` / `parseJobResult`. In static/server mode this is a Server
  Component async read, not a client hook.

**Adapt:**
- `task-detail-page.tsx`, `task-list-tabs.tsx` — reuse layout/markup; repoint data from
  DB/API to the filesystem task index; add the **category filter**.

This keeps the heavy, demo-defining work (ATIF parse + command rendering + result parsing)
as a direct port; the only real engineering is the filesystem loader + the task index.

---

## 6. Sanitization (customer-facing)

The raw ATIF embeds internal bits: `agent.model = "litellm_proxy/vertex_ai/gemini-3.5-flash"`
and `metrics.total_cost_usd`. A small normalizer (applied in the loader) must: strip the
`litellm_proxy/<provider>/` prefix → show `gemini-3.5-flash`; hide our USD cost (keep
token counts if desired); drop internal job-dir names from any displayed path. Configurable
so an internal build can show everything.

---

## 7. Screens (detail)

- **A. Task list** — grid/list of the 20 (or N) tasks, **filter by category** (the one
  genuinely new screen; adapts `task-list-tabs`). Each card: slug, category, and pass-rate
  summary if runs present.
- **B. Task detail** — file browser (syntax-highlighted) + metadata panel (`task.toml`).
- **C. Trajectory view** — `TrajectoryViewer` (parsed commands + raw) + results
  (`run-result-utils`) + solve output. Runs side panel = stretch.

---

## 8. Packaging & shipping

- **Static export**: `EXPLORER_MODE=export DATASET_DIR=<bundle> next build` → `out/`. Ship
  `out/` inside the published dataset (or alongside it). Customer: "serve this folder"
  (`python -m http.server`, `npx serve`, or any static host) → explore. No Docker/Node app.
- **Docker**: a small image; `docker run -v <dataset>:/data -p 3000:3000 <image>`. The
  published dataset's `scripts/` can carry this one-liner.
- The static bundle doubles as the public "benchmark site" artifact.

---

## 9. Arena extraction & licensing

Arena is proprietary (Supabase, AI gateway, campaign/annotator code). For an eventually
public MIT repo we port **only** the cleanly-decoupled pieces above — all of which are
pure/presentational and free of backend deps once `use-trajectory-data` is replaced. The
filesystem rewrite forces that decoupling naturally. **Do not** copy API routes, DB repos,
auth, or campaign code. Treat ported files as a clean re-export (re-headered MIT), and
keep Arena-internal path references out of any public version of this doc.

---

## 10. Open questions / to confirm before/while building

1. **Exported-trajectory layout.** What the Harbor export script emits (dir structure,
   filenames) vs raw `out/jobs/.../agent/trajectory.json` + `verifier/`. The loader targets
   whichever we ship for hard20.
2. **Solve/oracle output location** in our runs (oracle trial stdout) and whether Arena's
   result view already sources it.
3. **ATIF schema match** — confirm our `trajectory.json` passes `parseAtifTrajectory`
   unchanged (it should; both are ATIF) and the `entries` render as expected.
4. **Multiple trials per task** — do we ship k trials per task (then we need trial
   selection / the runs panel) or one representative trial for the demo?

---

## 11. Milestones

- **M0** — repo scaffold + Next 16/Tailwind/shadcn base, `DATASET_DIR` plumbing, mode flag. *(scaffold done)*
- **M1** — filesystem loader + **task list (category filter)** + **task detail** (files + metadata).
- **M2** — port `parseAtifTrajectory` + `TrajectoryViewer` + `run-result-utils`; **trajectory view** (parsed + raw + results + solve), with sanitization.
- **M3** — **static export** build wired end-to-end against the hard20 exported trajectories; produce a shippable `out/`.
- **M4** — **Docker** image (server mode) + the dataset `scripts/` run command.
- **Stretch** — runs side panel (multi-trial), npx distribution, public benchmark-site host.
