# Computer Control Explorer

A self-contained, **read-only** web app for exploring a computer-control task dataset —
browse tasks by category, read each task's files and metadata, and inspect parsed agent
**trajectories** (the commands the agent ran), **test results**, and the oracle **solve
output**. It parses Harbor's **ATIF** trajectory format (terminus-2 and codex), so it
renders exactly what the eval harness produces.

It reads *only* the dataset — no database, no backend services — which makes it safe to
hand to anyone who wants to explore a shipped dataset. The architecture and build plan
live in [`PLAN.md`](PLAN.md); contributor guidance in [`AGENTS.md`](AGENTS.md).

## The data contract

Everything comes from one directory, given by the `DATASET_DIR` environment variable:

```
$DATASET_DIR/
  dataset/<slug>/        task.toml, instruction.md, README.md, rubric.txt,
                         solution/, tests/, environment/, …
  out/jobs/.../<trial>/  result.json, agent/trajectory.json (ATIF),
                         verifier/test-stdout.txt          (eval trials; optional)
```

Tasks come from `dataset/`; trials are discovered by walking `out/jobs/` for any
`result.json` that carries a `trial_name` + `task_checksum`. No other inputs.

## Running it

```bash
npm install
```

**Dev server** (reads the dataset at request time, hot reload):

```bash
DATASET_DIR=/path/to/bundle npm run dev
```

**Static export** — a self-contained `out/` with no runtime dependencies:

```bash
DATASET_DIR=/path/to/bundle npm run export   # → out/
```

The export uses trailing-slash routes (`/task/<slug>/index.html`), so it serves on any
static file server with no rewrite rules:

```bash
python3 -m http.server -d out 8080      # or: npx serve out
```

**Docker** — a dataset-agnostic server image; mount the bundle as a volume and it reads
it at request time. Pull the published image (CI builds & pushes it on each release tag):

```bash
docker run --rm -p 3000:3000 -v /path/to/bundle:/data:ro -e DATASET_DIR=/data \
  YOUR_DOCKERHUB_NAMESPACE/computer-control-explorer
```

…or build it locally:

```bash
docker build -t computer-control-explorer .
docker run --rm -p 3000:3000 -v /path/to/bundle:/data:ro -e DATASET_DIR=/data \
  computer-control-explorer
```

## What it shows

Per task: a collapsible **file tree** with syntax-highlighted file contents and metadata,
and a **Trials** tab with pass rate by run (model × task version × job folder), the oracle
solve, and every agent trial — each with its parsed + raw **trajectory** (ATIF; terminus-2
and codex), **test output**, and reward. Crashed runs surface their error inline.

## License

[MIT](LICENSE). (Repository is currently private; intended to be open-sourced.)
