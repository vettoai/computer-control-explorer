/**
 * Build a nested folder tree from a flat list of file paths. Pure + client-safe
 * (no node deps) so the Files-tab tree component can use it directly.
 */

export interface TreeFile {
  type: "file";
  name: string;
  path: string;
  size: number;
}

export interface TreeDir {
  type: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeDir;

function sortNodes(nodes: TreeNode[]): void {
  // Directories first, then files; alphabetical within each group.
  nodes.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
  );
  for (const node of nodes) if (node.type === "dir") sortNodes(node.children);
}

export function buildFileTree(files: { path: string; size: number }[]): TreeNode[] {
  const root: TreeDir = { type: "dir", name: "", path: "", children: [] };
  const dirs = new Map<string, TreeDir>([["", root]]);

  function ensureDir(path: string): TreeDir {
    const existing = dirs.get(path);
    if (existing) return existing;
    const idx = path.lastIndexOf("/");
    const parent = ensureDir(idx === -1 ? "" : path.slice(0, idx));
    const dir: TreeDir = {
      type: "dir",
      name: idx === -1 ? path : path.slice(idx + 1),
      path,
      children: [],
    };
    parent.children.push(dir);
    dirs.set(path, dir);
    return dir;
  }

  for (const file of files) {
    const idx = file.path.lastIndexOf("/");
    const parent = ensureDir(idx === -1 ? "" : file.path.slice(0, idx));
    parent.children.push({
      type: "file",
      name: idx === -1 ? file.path : file.path.slice(idx + 1),
      path: file.path,
      size: file.size,
    });
  }

  sortNodes(root.children);
  return root.children;
}

/** Directory paths on the way to a file path, e.g. "a/b/c.txt" → ["a", "a/b"]. */
export function ancestorDirs(filePath: string): string[] {
  const parts = filePath.split("/");
  parts.pop(); // drop the file name
  const out: string[] = [];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.push(acc);
  }
  return out;
}
