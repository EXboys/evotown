import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownContentProps = {
  children: string;
  className?: string;
};

/** Agent 回复等 Markdown 正文（GFM 表格/列表 + Tailwind Typography）。 */
export function MarkdownContent({ children, className = "" }: MarkdownContentProps) {
  if (!children.trim()) return null;
  return (
    <div className={`prose prose-sm max-w-none prose-slate prose-table:text-sm ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
