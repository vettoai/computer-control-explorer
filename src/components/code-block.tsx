"use client";

import hljs from "highlight.js/lib/common";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import { useMemo } from "react";

// `common` covers python/bash/json/yaml/rust/sql/cpp/go/markdown/ini/… ; add Dockerfile.
hljs.registerLanguage("dockerfile", dockerfile);

const EXT_LANG: Record<string, string> = {
  py: "python",
  sh: "bash",
  bash: "bash",
  json: "json",
  jsonl: "json",
  toml: "ini", // hljs has no toml grammar; ini is the closest fit
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  go: "go",
  rb: "ruby",
  java: "java",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "xml",
  xml: "xml",
  diff: "diff",
  patch: "diff",
};

const NAME_LANG: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
};

/** hljs language id for a path, or null when we shouldn't highlight (plain text). */
export function languageForFilename(path: string): string | null {
  const base = path.split("/").pop() ?? path;
  if (NAME_LANG[base]) return NAME_LANG[base];
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext] ?? null;
}

export function CodeBlock({ content, filename }: { content: string; filename: string }) {
  const lang = languageForFilename(filename);
  const html = useMemo(() => {
    if (!lang || !hljs.getLanguage(lang)) return null;
    try {
      return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }, [content, lang]);

  return (
    <pre className="hljs max-h-[70vh] overflow-y-auto whitespace-pre-wrap break-words bg-transparent p-4 font-mono text-xs leading-relaxed">
      {html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{content}</code>}
    </pre>
  );
}
