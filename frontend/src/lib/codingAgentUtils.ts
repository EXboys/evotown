export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function fileMeta(path: string): { icon: string; label: string } {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return { icon: "🧾", label: "JSON" };
  if (lower.endsWith(".md")) return { icon: "📄", label: "Markdown" };
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return { icon: "🌐", label: "HTML" };
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
    return { icon: "🖼️", label: "Image" };
  }
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return { icon: "📃", label: "Text" };
  if (lower.endsWith(".py") || lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js")) {
    return { icon: "💻", label: "Code" };
  }
  return { icon: "📁", label: "File" };
}

const PREVIEWABLE_TEXT_EXTS = new Set([
  ".txt", ".log", ".json", ".md", ".csv",
  ".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".scss", ".less",
  ".yaml", ".yml", ".xml", ".toml", ".ini", ".cfg", ".conf",
  ".sh", ".bash", ".zsh", ".fish",
  ".html", ".htm",
]);

const PREVIEWABLE_IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif",
]);

export function isPreviewableFile(path: string): boolean {
  const lower = path.toLowerCase();
  return PREVIEWABLE_TEXT_EXTS.has(lower.slice(lower.lastIndexOf("."))) ||
    PREVIEWABLE_IMAGE_EXTS.has(lower.slice(lower.lastIndexOf(".")));
}

export function isPreviewableHtml(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

export function isPreviewableImage(path: string): boolean {
  const lower = path.toLowerCase();
  return PREVIEWABLE_IMAGE_EXTS.has(lower.slice(lower.lastIndexOf(".")));
}
