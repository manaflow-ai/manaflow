import type { Doc } from "@cmux/convex/dataModel";
import type { TaskRunWithChildren } from "@/types/task";
import { ErrorBoundary } from "@sentry/react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "./mermaid-diagram";
import { FileText } from "lucide-react";
import type { Components } from "react-markdown";

export interface TaskRunSummaryPanelProps {
  task?: Doc<"tasks"> | null;
  selectedRun?: TaskRunWithChildren | null;
}

function TaskRunSummaryPanelErrorFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <FileText className="size-8 text-neutral-300 dark:text-neutral-600" />
      <div>
        <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
          Summary failed to render
        </p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Check the content format and try again.
        </p>
      </div>
    </div>
  );
}

function extractExecutionSummary(prDescription: string): string | null {
  // Try to extract "### Execution Summary" section
  const pattern = /###\s*Execution Summary[\s\S]*?(?=\n##[^#]|\n#[^#]|$)/i;
  const match = prDescription.match(pattern);
  if (match) {
    return match[0].trim();
  }
  // If no specific section, return the full description
  return prDescription.trim() || null;
}

function TaskRunSummaryPanelContent({
  task,
  selectedRun,
}: TaskRunSummaryPanelProps) {
  const prDescription = task?.pullRequestDescription;
  const runSummary = selectedRun?.summary;
  const content = prDescription
    ? extractExecutionSummary(prDescription)
    : runSummary || null;

  if (!content) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <FileText className="size-8 text-neutral-300 dark:text-neutral-600" />
        <div>
          <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
            No execution summary available yet
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Summary appears after the task completes.
          </p>
        </div>
      </div>
    );
  }

  const markdownComponents: Components = {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match?.[1];
      const codeString = String(children).replace(/\n$/, "");

      if (language === "mermaid") {
        return <MermaidDiagram chart={codeString} />;
      }

      // Inline code (no language class)
      if (!className) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }

      // Block code with language
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div
        className="prose prose-neutral dark:prose-invert prose-sm max-w-none
          prose-p:my-1.5 prose-p:leading-relaxed
          prose-headings:mt-4 prose-headings:mb-3 prose-headings:font-semibold
          prose-h1:text-xl prose-h1:mt-5 prose-h1:mb-3
          prose-h2:text-lg prose-h2:mt-4 prose-h2:mb-2.5
          prose-h3:text-base prose-h3:mt-3.5 prose-h3:mb-2
          prose-ul:my-2 prose-ul:list-disc prose-ul:pl-5
          prose-ol:my-2 prose-ol:list-decimal prose-ol:pl-5
          prose-li:my-0.5
          prose-blockquote:border-l-4 prose-blockquote:border-neutral-300 dark:prose-blockquote:border-neutral-600
          prose-blockquote:pl-4 prose-blockquote:py-0.5 prose-blockquote:my-2
          prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-neutral-200 dark:prose-code:bg-neutral-700
          prose-code:text-[13px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-neutral-900 dark:prose-pre:bg-neutral-800 prose-pre:text-neutral-100
          prose-pre:p-3 prose-pre:rounded-md prose-pre:my-2 prose-pre:overflow-x-auto
          prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline prose-a:break-words
          prose-table:my-2 prose-table:border prose-table:border-neutral-300 dark:prose-table:border-neutral-600
          prose-th:p-2 prose-th:bg-neutral-100 dark:prose-th:bg-neutral-800
          prose-td:p-2 prose-td:border prose-td:border-neutral-300 dark:prose-td:border-neutral-600
          prose-hr:my-3 prose-hr:border-neutral-300 dark:prose-hr:border-neutral-600
          prose-strong:font-semibold prose-strong:text-neutral-900 dark:prose-strong:text-neutral-100"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export function TaskRunSummaryPanel(props: TaskRunSummaryPanelProps) {
  return (
    <ErrorBoundary fallback={<TaskRunSummaryPanelErrorFallback />}>
      <TaskRunSummaryPanelContent {...props} />
    </ErrorBoundary>
  );
}
