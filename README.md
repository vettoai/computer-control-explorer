# Computer Control Explorer

A self-contained, **read-only** web app for exploring a computer-control task dataset —
browse tasks by category, read each task's files and metadata, and inspect parsed agent
**trajectories** (the commands the agent ran), **test results**, and the oracle **solve
output**. It parses Harbor's **ATIF** trajectory format (terminus-2 and codex), so it
renders exactly what the eval harness produces.

It reads *only* the dataset — no database, no backend services — which makes it safe to
hand to anyone who wants to explore a shipped dataset.

> **Status:** early scaffold. The architecture and build plan live in `PLAN.md` (incoming).
> No application code yet.

## Intended ways to run

One Next.js app, three usages (sharing a single filesystem data layer):

1. **Static export** — build a self-contained static site for a specific dataset
   (`next build` with `output: 'export'`); ship the `out/` folder and open it via any
   static file server. No runtime dependencies.
2. **Docker** — `docker run` mounting a dataset volume; the server reads it dynamically.
3. **Local directory** — run the server pointed at a dataset directory on disk.

## What it reads

From a dataset bundle: each task's `instruction.md`, `README.md`, `rubric.txt`,
`task.toml`, `solution/`, `tests/`, `environment/`, plus — when present — agent
trajectories (`trajectory.json`) and verifier results from an eval run.

## License

[MIT](LICENSE). (Repository is currently private; intended to be open-sourced.)
