import { promises as fs } from "node:fs";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import type { DatasetFile, TaskDetail, TaskMeta } from "./types";

/**
 * Disk-only dataset loader. The single source of truth is `DATASET_DIR`, a dataset
 * bundle laid out as:
 *   <DATASET_DIR>/dataset/<slug>/{instruction.md, README.md, rubric.txt, task.toml,
 *                                 solution/, tests/, environment/, …}
 *   <DATASET_DIR>/out/jobs/<job>/<trial>/…   (eval runs — consumed in M2)
 * No DB, no API, no network. See AGENTS.md.
 *
 * Loader functions take an explicit `dir` (defaulting to `datasetDir()`) so they are
 * trivially testable against a fixture.
 */

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".toml", ".sh", ".py", ".json", ".js", ".jsx", ".ts", ".tsx",
  ".yaml", ".yml", ".c", ".h", ".cpp", ".hpp", ".cc", ".go", ".rs", ".rb",
  ".java", ".sql", ".csv", ".tsv", ".cfg", ".ini", ".conf", ".env", ".html",
  ".css", ".scss", ".xml", ".proto", ".lock", ".gitignore", ".dockerignore",
  ".gitkeep", ".log", ".jsonl",
]);
const TEXT_FILENAMES = new Set(["Dockerfile", "Makefile", "LICENSE", "README"]);
const MAX_TEXT_BYTES = 512 * 1024;

/**
 * Resolve the dataset bundle root from the environment, or `null` if unset.
 * Returning `null` (rather than throwing) lets `npm run build` succeed with no dataset
 * mounted — CI builds an empty explorer; a real build sets `DATASET_DIR`.
 */
export function datasetDir(): string | null {
  return process.env.DATASET_DIR ?? null;
}

/** Reject slugs that could escape the dataset dir. */
function isSafeSlug(slug: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(slug) && slug !== "." && slug !== "..";
}

function isTextFile(filename: string): boolean {
  if (TEXT_FILENAMES.has(filename)) return true;
  return TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function taskSection(toml: Record<string, unknown>): Record<string, unknown> {
  const t = toml.task;
  return t && typeof t === "object" ? (t as Record<string, unknown>) : {};
}

function metaFromToml(slug: string, toml: Record<string, unknown>): TaskMeta {
  const task = taskSection(toml);
  const keywords = Array.isArray(task.keywords)
    ? (task.keywords as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  return {
    slug,
    name: typeof task.name === "string" ? task.name : slug,
    title: typeof task.description === "string" && task.description ? task.description : slug,
    category: keywords[0] ?? "Uncategorized",
    tags: keywords.slice(1),
    difficulty: typeof task.difficulty === "string" ? task.difficulty : null,
  };
}

async function readToml(file: string): Promise<Record<string, unknown>> {
  return parseToml(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

/** List all tasks (dirs under `dataset/` that contain a `task.toml`). Sorted by slug. */
export async function listTasks(dir: string | null = datasetDir()): Promise<TaskMeta[]> {
  if (!dir) return [];
  const root = path.join(dir, "dataset");
  let names: string[];
  try {
    names = (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
  const metas: TaskMeta[] = [];
  for (const slug of names) {
    if (!isSafeSlug(slug)) continue;
    try {
      metas.push(metaFromToml(slug, await readToml(path.join(root, slug, "task.toml"))));
    } catch {
      // Directory without a (valid) task.toml — not a task; skip.
    }
  }
  return metas;
}

/** Distinct categories present, sorted. */
export async function listCategories(dir: string | null = datasetDir()): Promise<string[]> {
  const tasks = await listTasks(dir);
  return [...new Set(tasks.map((t) => t.category))].sort((a, b) => a.localeCompare(b));
}

async function walkFiles(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = (await fs.readdir(path.join(root, rel), { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walkFiles(root, childRel)));
    else if (entry.isFile()) out.push(childRel);
  }
  return out;
}

/** Full detail for one task: metadata + the complete file tree with text content. */
export async function getTask(
  slug: string,
  dir: string | null = datasetDir(),
): Promise<TaskDetail | null> {
  if (!dir || !isSafeSlug(slug)) return null;
  const taskDir = path.join(dir, "dataset", slug);
  let toml: Record<string, unknown>;
  try {
    toml = await readToml(path.join(taskDir, "task.toml"));
  } catch {
    return null;
  }
  const files: DatasetFile[] = [];
  for (const rel of await walkFiles(taskDir)) {
    const abs = path.join(taskDir, rel);
    const { size } = await fs.stat(abs);
    const isText = isTextFile(path.basename(rel)) && size <= MAX_TEXT_BYTES;
    files.push({
      path: rel,
      size,
      content: isText ? await fs.readFile(abs, "utf8") : null,
    });
  }
  return { ...metaFromToml(slug, toml), toml, files };
}

export interface DatasetInfo {
  name: string; // org prefix stripped, e.g. "computer-control-202605-hard20"
  description: string | null;
}

/** Dataset name + description from `<dir>/dataset/dataset.toml`, or null if absent. */
export async function getDatasetInfo(
  dir: string | null = datasetDir(),
): Promise<DatasetInfo | null> {
  if (!dir) return null;
  let toml: Record<string, unknown>;
  try {
    toml = await readToml(path.join(dir, "dataset", "dataset.toml"));
  } catch {
    return null;
  }
  const ds = toml.dataset;
  const section = ds && typeof ds === "object" ? (ds as Record<string, unknown>) : {};
  const rawName = typeof section.name === "string" ? section.name : null;
  if (!rawName) return null;
  return {
    name: rawName.replace(/^[^/]+\//, ""),
    description: typeof section.description === "string" ? section.description : null,
  };
}
