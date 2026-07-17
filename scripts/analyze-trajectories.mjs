#!/usr/bin/env node
/**
 * Offline trajectory analyzer — enriches a dataset bundle with LLM-written sidecars the
 * explorer renders in cinema mode (per-turn phase + note, a run summary, a review hint).
 *
 * The explorer itself NEVER calls a model (see AGENTS.md: disk is the only source). This
 * script runs out-of-band, against a LiteLLM proxy, and writes one JSON per trial to
 * `<bundle>/out/analysis/<trialId>.json` — after which the sidecars are just files the
 * loader picks up. Re-runs skip trials whose sidecar already exists (delete to redo).
 *
 * Usage:
 *   LITELLM_BASE_URL=https://proxy.example/v1 LITELLM_API_KEY=sk-… \
 *     node scripts/analyze-trajectories.mjs <bundle-dir> [slug …] [--model m] [--limit n] [--force]
 *
 * Defaults: model gemini/gemini-3.5-flash (cheap + fast), all slugs, no limit.
 * Trial IDs match the explorer's: sha1(relPath) truncated to 12 hex chars.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const BASE_URL = (process.env.LITELLM_BASE_URL ?? "").replace(/\/$/, "");
const API_KEY = process.env.LITELLM_API_KEY ?? "";

function parseArgs(argv) {
  const args = { bundle: null, slugs: [], model: "gemini/gemini-3.5-flash", limit: Infinity, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") args.model = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--force") args.force = true;
    else if (!args.bundle) args.bundle = a;
    else args.slugs.push(a);
  }
  return args;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** Walk out/jobs for trial dirs (result.json with trial_name + task_checksum). */
async function findTrials(bundle) {
  const out = [];
  async function walk(dir) {
    const result = await readJson(path.join(dir, "result.json"));
    if (result?.trial_name && result?.task_checksum) {
      out.push({ dir, result });
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory()) await walk(path.join(dir, e.name));
  }
  const jobsRoot = path.join(bundle, "out", "jobs");
  let jobs;
  try {
    jobs = await fs.readdir(jobsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const j of jobs) if (j.isDirectory()) await walk(path.join(jobsRoot, j.name));
  return out;
}

function slugOf(result) {
  const fromPath = result?.task_id?.path;
  if (typeof fromPath === "string") return fromPath.replace(/^dataset\//, "");
  const name = result?.task_name;
  return typeof name === "string" ? name.replace(/^[^/]+\//, "") : null;
}

/** Compact an ATIF trajectory into a token-frugal turn list for the prompt. */
function compactTurns(atif) {
  const steps = (atif?.steps ?? []).filter((s) => s?.source === "agent");
  return steps.map((s, i) => {
    let thought = s.message ?? "";
    const m = /"analysis"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(thought);
    if (m) thought = m[1];
    thought = thought.replace(/^Analysis:\s*/i, "").replace(/\s+/g, " ").slice(0, 400);
    let tools = s.tool_calls ?? [];
    if (typeof tools === "string") {
      try {
        tools = JSON.parse(tools.replace(/'/g, '"'));
      } catch {
        tools = [];
      }
    }
    const cmds = tools
      .map((t) => String(t?.arguments?.cmd ?? t?.arguments?.keystrokes ?? t?.function_name ?? ""))
      .map((c) => c.replace(/\s+/g, " ").trim().slice(0, 160));
    return { index: i, thought: thought || undefined, commands: cmds.length ? cmds : undefined };
  });
}

const SYSTEM_PROMPT = `You annotate agent trajectories (terminal-task solving runs) for human reviewers.
Given a compacted turn list (index, thought excerpt, commands), return STRICT JSON:
{
  "summary": "<2-3 sentences: what the agent tried, the key decision(s), how it ended>",
  "reviewHint": "<1-2 sentences: what a human reviewer should look at in THIS run — the decisive turn(s), a suspicious shortcut, a wrong assumption, or 'routine run, nothing stands out'>",
  "turns": [{"index": <int>, "phase": "<plan|explore|implement|verify|debug|conclude>", "note": "<≤15 words, only for turns worth a note — pivotal decisions, mistakes, discoveries; omit for routine turns>"}]
}
Every turn index MUST get a phase. Notes are sparse (aim ≤ 1/4 of turns). No markdown, JSON only.`;

async function analyzeOne(model, taskSlug, passed, turns) {
  const user = `Task: ${taskSlug}\nFinal verdict: ${passed ? "PASSED" : "FAILED"}\nTurns:\n${JSON.stringify(turns)}`;
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().then((t) => t.slice(0, 300))}`);
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty completion");
  return JSON.parse(content.replace(/^```json?\s*|\s*```$/g, ""));
}

async function main() {
  const { bundle, slugs, model, limit, force } = parseArgs(process.argv.slice(2));
  if (!bundle) {
    console.error("usage: analyze-trajectories.mjs <bundle-dir> [slug …] [--model m] [--limit n] [--force]");
    process.exit(1);
  }
  if (!BASE_URL || !API_KEY) {
    console.error("LITELLM_BASE_URL and LITELLM_API_KEY are required (LiteLLM proxy only — never a provider key).");
    process.exit(1);
  }

  const analysisDir = path.join(bundle, "out", "analysis");
  await fs.mkdir(analysisDir, { recursive: true });

  const all = await findTrials(bundle);
  const wanted = all.filter((t) => {
    const slug = slugOf(t.result);
    return slug && (slugs.length === 0 || slugs.includes(slug));
  });
  console.log(`${wanted.length} trials matched (of ${all.length} in bundle)`);

  let done = 0;
  for (const { dir, result } of wanted) {
    if (done >= limit) break;
    const relPath = path.relative(bundle, dir);
    const trialId = createHash("sha1").update(relPath).digest("hex").slice(0, 12);
    const outFile = path.join(analysisDir, `${trialId}.json`);
    if (!force && (await fs.stat(outFile).catch(() => null))) continue;

    const atif = await readJson(path.join(dir, "agent", "trajectory.json"));
    if (!atif) continue;
    const turns = compactTurns(atif);
    if (turns.length === 0) continue;

    const slug = slugOf(result);
    const passed = (result?.verifier_result?.rewards?.reward ?? 0) >= 1;
    process.stdout.write(`${slug} ${trialId} (${turns.length} turns) … `);
    try {
      const raw = await analyzeOne(model, slug, passed, turns);
      const sidecar = {
        version: 1,
        trialId,
        analyzedBy: model,
        summary: typeof raw.summary === "string" ? raw.summary : undefined,
        reviewHint: typeof raw.reviewHint === "string" ? raw.reviewHint : undefined,
        turns: Array.isArray(raw.turns) ? raw.turns : undefined,
      };
      await fs.writeFile(outFile, JSON.stringify(sidecar, null, 2));
      done++;
      console.log("ok");
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }
  console.log(`wrote ${done} sidecars to ${analysisDir}`);
}

main();
