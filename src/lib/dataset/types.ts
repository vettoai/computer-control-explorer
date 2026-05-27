/**
 * Types for the on-disk dataset bundle. The explorer's ONLY data source is the
 * filesystem (see AGENTS.md) — these model what we read from `DATASET_DIR`.
 */

/** Lightweight task summary, parsed from `dataset/<slug>/task.toml`. */
export interface TaskMeta {
  /** Directory name under `dataset/` — the canonical id used in routes. */
  slug: string;
  /** `[task].name`, e.g. "vettoai/duckdb-schema-collision". */
  name: string;
  /** `[task].description` — the human-readable title. */
  title: string;
  /** `keywords[0]` — the category (e.g. "Data Querying"). */
  category: string;
  /** `keywords[1..]` — finer-grained tags (language, framework, …). */
  tags: string[];
  /** `[task].difficulty`, if present. */
  difficulty: string | null;
}

/** A single file inside a task directory. */
export interface DatasetFile {
  /** Path relative to the task dir, e.g. "tests/test_outputs.py". */
  path: string;
  size: number;
  /** UTF-8 content for text files; `null` for binary or oversized files. */
  content: string | null;
}

/** Full task detail: metadata + the complete file tree (with text content). */
export interface TaskDetail extends TaskMeta {
  /** The full parsed `task.toml` (for the metadata panel). */
  toml: Record<string, unknown>;
  files: DatasetFile[];
}
