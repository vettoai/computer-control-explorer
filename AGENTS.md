# Agent instructions — Computer Control Explorer

## 1. The data source is the DISK. Always. 🚨

The single source of truth is a dataset bundle **on disk** (`DATASET_DIR`). There is **no
database, no API, no network**. Every datum — task definitions, task files, `task.toml`
metadata, eval trials, trajectories, verifier results, solve output — is read from the
filesystem:

- `dataset/<slug>/` → `instruction.md`, `README.md`, `rubric.txt`, `task.toml`, `solution/`,
  `tests/`, `environment/`.
- `out/jobs/<job>/<trial>/` → `result.json`, `agent/trajectory.json` (ATIF), `verifier/`.

Never add a fetch to a backend, a DB client, or an env-configured API. If you want one, the
answer is a filesystem read.

## 2. Reuse from Vetto Arena: ONLY pure / presentational code

Arena is API/DB-driven and proprietary. Port only **pure functions** (the ATIF trajectory
parser, result parsers) and **presentational components** (props-in, no fetching) — and
re-header them for this MIT repo. **Never** port Arena's data layer, API routes, DB repos,
Supabase, auth, or campaign/annotator code. Arena's `use-trajectory-data` hook (which
`apiFetch`es) is explicitly **replaced** here by a filesystem loader.

## 3. The static export must keep working

`output: 'export'` (static HTML) is a first-class build target. Do not introduce features
incompatible with it: no API Routes, no SSR-on-request data, no Server Actions, no
runtime-only image optimization. Dynamic routes use `generateStaticParams`. Data is read in
Server Components — at build time for the static export, at request time for the Docker
server build — via the **same loader**, toggled by `EXPLORER_MODE`.

One sanctioned exception: `src/proxy.ts`, the optional `EXPLORER_PASSWORD` gate. It is
server-only by nature (export builds omit proxies with a warning, so the export stays
passwordless and fully working). Keep it that way: the proxy may only *gate access*, never
serve or transform data — no page may depend on it existing.

## 4. Quality bar

Every change must keep `npm run typecheck`, `npm run lint`, `npm run test`, and
`npm run build` green (CI enforces all four). Write tests for the data layer and pure
parsers. Work milestone-by-milestone (see `PLAN.md`); each milestone is its own branch + PR.
