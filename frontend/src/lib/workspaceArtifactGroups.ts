export const ARTIFACT_DIR_ORDER = ["dashboard", "downloads", "output"] as const;

export type WorkspaceFileEntry = {
  path: string;
  name: string;
  size?: number;
  is_dir?: boolean;
  modified_at?: string | null;
};

export type ArtifactDirName = (typeof ARTIFACT_DIR_ORDER)[number];

export type WorkspaceFileGroup = {
  key: string;
  label: string;
  entries: WorkspaceFileEntry[];
};

export type ArtifactPathGroup<T extends { path: string }> = {
  key: string;
  label: string;
  items: T[];
};

export function artifactDirLabel(name: string): string {
  if (name === "dashboard") return "dashboard · 页面";
  if (name === "downloads") return "downloads · 下载";
  if (name === "output") return "output · 报告";
  if (name === "根目录") return "根目录";
  return name;
}

export function isUserVisibleArtifact(path: string): boolean {
  const normalized = path.trim();
  if (!normalized || normalized.startsWith(".evotown/")) return false;
  if (normalized === ".mcp.json" || normalized === "CLAUDE.md") return false;
  return true;
}

export function isHtmlArtifactPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

function entrySortKey(entry: WorkspaceFileEntry): string {
  return entry.path.toLowerCase();
}

export function sortWorkspaceEntries(entries: WorkspaceFileEntry[]): WorkspaceFileEntry[] {
  const artifactRank = (entry: WorkspaceFileEntry): number => {
    if (entry.is_dir && ARTIFACT_DIR_ORDER.includes(entry.name as ArtifactDirName)) {
      return ARTIFACT_DIR_ORDER.indexOf(entry.name as ArtifactDirName);
    }
    if (entry.is_dir) return ARTIFACT_DIR_ORDER.length + 1;
    return ARTIFACT_DIR_ORDER.length + 2;
  };

  return [...entries].sort((a, b) => {
    const rankDiff = artifactRank(a) - artifactRank(b);
    if (rankDiff !== 0) return rankDiff;
    if (Boolean(a.is_dir) !== Boolean(b.is_dir)) return a.is_dir ? -1 : 1;
    return entrySortKey(a).localeCompare(entrySortKey(b));
  });
}

export function groupWorkspaceEntries(entries: WorkspaceFileEntry[]): WorkspaceFileGroup[] {
  const artifactDirs = new Map<string, WorkspaceFileEntry>();
  const otherDirs: WorkspaceFileEntry[] = [];
  const rootFiles: WorkspaceFileEntry[] = [];

  for (const entry of entries) {
    if (entry.is_dir) {
      if (ARTIFACT_DIR_ORDER.includes(entry.name as ArtifactDirName)) {
        artifactDirs.set(entry.name, entry);
      } else {
        otherDirs.push(entry);
      }
      continue;
    }
    rootFiles.push(entry);
  }

  const groups: WorkspaceFileGroup[] = [];
  for (const key of ARTIFACT_DIR_ORDER) {
    const dir = artifactDirs.get(key);
    if (dir) {
      groups.push({ key, label: artifactDirLabel(key), entries: [dir] });
    }
  }

  otherDirs.sort((a, b) => entrySortKey(a).localeCompare(entrySortKey(b)));
  if (otherDirs.length) {
    groups.push({ key: "__other_dirs__", label: "其他文件夹", entries: otherDirs });
  }

  rootFiles.sort((a, b) => entrySortKey(a).localeCompare(entrySortKey(b)));
  if (rootFiles.length) {
    groups.push({ key: "__root_files__", label: "根目录文件", entries: rootFiles });
  }

  return groups;
}

export function groupArtifacts<T extends { path: string }>(items: T[]): ArtifactPathGroup<T>[] {
  const filtered = items.filter((item) => isUserVisibleArtifact(item.path));
  const buckets = new Map<string, T[]>();

  for (const item of filtered) {
    const key = item.path.includes("/") ? item.path.split("/")[0] : "根目录";
    const bucket = buckets.get(key) || [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  const groups: ArtifactPathGroup<T>[] = [];
  const orderedKeys = [...ARTIFACT_DIR_ORDER, "根目录"];

  for (const key of orderedKeys) {
    const bucket = buckets.get(key);
    if (!bucket?.length) continue;
    bucket.sort((a, b) => a.path.localeCompare(b.path));
    groups.push({
      key,
      label: artifactDirLabel(key),
      items: bucket,
    });
    buckets.delete(key);
  }

  const remaining = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [key, bucket] of remaining) {
    bucket.sort((a, b) => a.path.localeCompare(b.path));
    groups.push({ key, label: artifactDirLabel(key), items: bucket });
  }

  return groups;
}

export function sortPathsForShare(paths: string[]): string[] {
  const rank = (path: string): number => {
    const top = path.includes("/") ? path.split("/")[0] : "";
    if (top === "dashboard") return 0;
    if (top === "downloads") return 1;
    if (top === "output") return 2;
    return 3;
  };

  return [...paths].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.localeCompare(b);
  });
}
