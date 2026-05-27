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
- eval runs = the **`export_results.sh`** output (a zip of `out/jobs/`, minus heavy agent
  internals — episodes, `.cast`, sqlite, panes — which we don't need). Per trial:
  `out/jobs/<job>/<trial>/{result.json, agent/trajectory.json (ATIF), verifier/…}`. We ship
  this `out/` alongside the bundle (which already carries `dataset/<slug>/`); `DATASET_DIR`
  points at the bundle root.
- **Oracle** runs usually aren't shipped. When present, an oracle trial is **just another
  trajectory** — agent = `oracle`, model N/A, plus its solve output. No special path; same
  renderer.

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

## 6. Display normalization (not sanitization)

The explorer is a **read-only helper over the data we ship** — and we ship the raw `out/`
alongside it — so it does **not** hide anything that's already in the files; masking in the
UI would be pointless theater. (Job-dir names, etc. aren't internal — they're just the data.)
The only normalization is **cosmetic**: render the model as a clean name by stripping the
`litellm_proxy/<provider>/` transport prefix (`litellm_proxy/vertex_ai/gemini-3.5-flash` →
`gemini-3.5-flash`) for readability. Token counts / cost are just data — show them or not as
a UI choice (often useful to a researcher). If there's ever something we don't want a
customer to have, that's an **export-time** decision (what goes into the bundled `out/`),
**not** the viewer's job.

---

## 6.5 Trials, versions & per-model stats

Researchers want **which model** ran a trajectory and **how models compare** — so we
surface model identity and per-model pass rates. Both keys are in every trial's
`result.json` (confirmed): `config.agent.model_name` (the model) and `task_checksum`
(the immutable-version hash); pass/fail is `verifier_result.rewards.reward`.

**Immutable grouping.** Trials are only comparable within one `task_checksum`. Easing
(hints edit `instruction.md`) and task bumps change content → a **new checksum**, so
**with-hints / no-hints / pre-bump / post-bump separate automatically**. This is the same
discipline curation enforces (COMMON_PITFALLS G2: never aggregate across checksums). The
loader groups trials by `task_checksum`; within a version it computes per-model pass rate
via the ported `run-result-utils`.

**UI.** We ship **k trials per task** (e.g. gemini-3.5-flash ×10), so **trial selection is
core**: the picker drills version (checksum) → model → trial. Each trial shows agent +
model; per-model pass rate is computed over its k trials. The task view gets a small
**stats table** — model × version → pass% (n=k).

**Version labels** (a checksum is opaque): attach a human label in order of preference —
(a) an `explorer.json` manifest in the dataset mapping checksum → label; (b) auto-derive
by matching the trial's instruction to `instruction_with_hints.md` / `instruction_no_hints.md`;
(c) the bucket subfolder name.

**Organization — both supported, no design change:**
- *Flat* `out/` → auto-group by `task_checksum`; one export shows all versions via the
  selector (the **dynamic** default — low magic, the checksum does the work).
- *Bucketed* subfolders (`out/pre-bump/`, `out/with-hints/`, …) → respected as explicit
  versions, **or** built as separate per-bucket exports if you prefer isolated explorers.

Recommendation: **dynamic / group-by-checksum** as default; separate-export as the trivial fallback.

---

## 7. Screens (detail)

- **A. Task list** — grid/list of the 20 (or N) tasks, **filter by category** (the one
  genuinely new screen; adapts `task-list-tabs`). Each card: slug, category, and pass-rate
  summary if runs present.
- **B. Task detail** — file browser (syntax-highlighted) + metadata panel (`task.toml`).
- **C. Trajectory view** — `TrajectoryViewer` (parsed commands + raw) + results
  (`run-result-utils`), with the **trial picker** (version → model → trial, **core** since
  k=10/task), the **model** shown per trial, and a per-task **stats table** (model ×
  version → pass%). Solve output shown for oracle trials when present.

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

## 10. Resolved decisions (was: open questions)

1. **Layout** — read the `export_results.sh` output: `out/jobs/<job>/<trial>/{result.json,
   agent/trajectory.json, verifier/}`, shipped alongside the bundle's `dataset/<slug>/`. ✅
2. **Oracle/solve** — oracle is just another trajectory (agent=`oracle`); solve output is a
   minor extra shown only when an oracle trial is present. Usually absent; low priority. ✅
3. **ATIF** — same harness (Harbor + terminus-2), so `parseAtifTrajectory` should parse our
   `trajectory.json` unchanged; verify the `entries` render while wiring M2. ✅
4. **k trials/task** — yes (gemini-3.5-flash ×10) → trial selection is **core**. ✅

**Still to pin while building:** version-label source (manifest vs. auto-derive vs.
subfolder) and whether hard20 ships flat `out/` (auto group-by-checksum) or flavor-bucketed
subfolders — confirm once the hard20 export is run.

---

## 11. Milestones

- **M0** — repo scaffold + Next 16/Tailwind/shadcn base, `DATASET_DIR` plumbing, mode flag. *(scaffold done)*
- **M1** — filesystem loader + **task list (category filter)** + **task detail** (files + metadata).
- **M2** — port `parseAtifTrajectory` + `TrajectoryViewer` + `run-result-utils`; **trajectory view** with the **trial picker** (group-by-`task_checksum` → model → trial), per-model **stats table**, and the cosmetic model-name cleanup.
- **M3** — **static export** build wired end-to-end against the hard20 `export_results.sh` output; produce a shippable static bundle.
- **M4** — **Docker** image (server mode) + the dataset `scripts/` run command.
- **Stretch** — npx distribution; public benchmark-site host; richer cross-task/model comparison views.
