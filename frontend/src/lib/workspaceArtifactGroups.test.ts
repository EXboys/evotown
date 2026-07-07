import { describe, expect, it } from "vitest";

import {
  artifactDirLabel,
  groupArtifacts,
  groupWorkspaceEntries,
  isHtmlArtifactPath,
  isUserVisibleArtifact,
  sortPathsForShare,
  sortWorkspaceEntries,
} from "./workspaceArtifactGroups";

describe("workspaceArtifactGroups", () => {
  it("labels artifact directories", () => {
    expect(artifactDirLabel("dashboard")).toContain("页面");
    expect(artifactDirLabel("downloads")).toContain("下载");
  });

  it("groups workspace root entries with artifact dirs first", () => {
    const groups = groupWorkspaceEntries([
      { path: "notes.md", name: "notes.md", size: 1 },
      { path: "dashboard", name: "dashboard", size: 0, is_dir: true },
      { path: "downloads", name: "downloads", size: 0, is_dir: true },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["dashboard", "downloads", "__root_files__"]);
    expect(groups[0]?.entries[0]?.name).toBe("dashboard");
  });

  it("groups run artifacts by top-level folder", () => {
    const groups = groupArtifacts([
      { path: "downloads/data.pdf" },
      { path: "dashboard/index.html" },
      { path: "README.md" },
      { path: ".evotown/hidden.json" },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["dashboard", "downloads", "根目录"]);
    expect(groups[0]?.items[0]?.path).toBe("dashboard/index.html");
  });

  it("sorts share paths with dashboard and downloads first", () => {
    expect(sortPathsForShare(["notes.md", "downloads/a.pdf", "dashboard/a.html"])).toEqual([
      "dashboard/a.html",
      "downloads/a.pdf",
      "notes.md",
    ]);
  });

  it("detects html artifacts and hides internal files", () => {
    expect(isHtmlArtifactPath("dashboard/page.html")).toBe(true);
    expect(isUserVisibleArtifact(".evotown/context.json")).toBe(false);
    expect(isUserVisibleArtifact("dashboard/page.html")).toBe(true);
  });

  it("sorts flat entries for display", () => {
    const sorted = sortWorkspaceEntries([
      { path: "notes.md", name: "notes.md", size: 1 },
      { path: "output", name: "output", size: 0, is_dir: true },
      { path: "dashboard", name: "dashboard", size: 0, is_dir: true },
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["dashboard", "output", "notes.md"]);
  });
});
