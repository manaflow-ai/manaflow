import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Evaluation, FailureCategory } from "./evaluation-criteria";

type StoredComment = {
  type: "issue_comment" | "review_comment" | "review";
  id: number;
  prNumber: number;
  botLogin: string;
  body: string;
  commitSha: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  path?: string;
  diffHunk?: string;
  position?: number | null;
  reviewState?: string;
};

type StoredPR = {
  number: number;
  title: string;
  state: "open" | "closed";
  htmlUrl: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  createdAt: string;
  updatedAt: string;
  diff: string;
  comments: StoredComment[];
};

type StoredEvaluation = {
  commentId: number;
  prNumber: number;
  evaluation: Evaluation;
  evaluatedAt: string;
  model: string;
};

type Theme = "light" | "dark";

const RATING_EMOJI: Record<string, string> = {
  excellent: "✅",
  good: "👍",
  acceptable: "🔶",
  poor: "⚠️",
  failed: "❌",
};

const RATING_COLORS: Record<string, string> = {
  excellent: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
  good: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
  acceptable: "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300",
  poor: "bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300",
  failed: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
};

type ViewMode = "prs" | "evaluations";

export default function App() {
  const [prs, setPrs] = useState<StoredPR[]>([]);
  const [evaluations, setEvaluations] = useState<Map<number, StoredEvaluation>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPR, setSelectedPR] = useState<StoredPR | null>(null);
  const [selectedComment, setSelectedComment] = useState<StoredComment | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [botFilter, setBotFilter] = useState<string>("all");
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "rating">("date");
  const [viewMode, setViewMode] = useState<ViewMode>("evaluations");
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme") as Theme | null;
      if (stored) return stored;
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    async function loadData() {
      try {
        // Load PRs
        const prResponse = await fetch("/data/bot-comments.jsonl");
        if (!prResponse.ok) {
          throw new Error(`Failed to load data: ${prResponse.status}`);
        }
        const prText = await prResponse.text();
        const prLines = prText.trim().split("\n").filter(Boolean);
        const data = prLines.map((line) => JSON.parse(line) as StoredPR);
        setPrs(data);

        // Load evaluations (may not exist yet)
        try {
          const evalResponse = await fetch("/data/evaluations-openai.jsonl");
          if (evalResponse.ok) {
            const evalText = await evalResponse.text();
            const evalLines = evalText.trim().split("\n").filter(Boolean);
            const evalData = evalLines.map(
              (line) => JSON.parse(line) as StoredEvaluation
            );
            const evalMap = new Map<number, StoredEvaluation>();
            for (const e of evalData) {
              evalMap.set(e.commentId, e);
            }
            setEvaluations(evalMap);
          }
        } catch {
          // Evaluations file doesn't exist yet, that's fine
        }

        if (data.length > 0) {
          setSelectedPR(data[0]);
          if (data[0].comments.length > 0) {
            setSelectedComment(data[0].comments[0]);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  const bots = useMemo(() => {
    const botSet = new Set<string>();
    for (const pr of prs) {
      for (const comment of pr.comments) {
        botSet.add(comment.botLogin);
      }
    }
    return Array.from(botSet).sort();
  }, [prs]);

  const filteredPRs = useMemo(() => {
    return prs.filter((pr) => {
      const matchesSearch =
        searchQuery === "" ||
        pr.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pr.number.toString().includes(searchQuery);

      const matchesBot =
        botFilter === "all" ||
        pr.comments.some((c) => c.botLogin === botFilter);

      const matchesRating =
        ratingFilter === "all" ||
        ratingFilter === "unevaluated"
          ? pr.comments.some((c) => !evaluations.has(c.id))
          : pr.comments.some((c) => {
              const evaluation = evaluations.get(c.id);
              return evaluation?.evaluation.rating === ratingFilter;
            });

      return matchesSearch && matchesBot && matchesRating;
    });
  }, [prs, searchQuery, botFilter, ratingFilter, evaluations]);

  const handleSelectPR = useCallback((pr: StoredPR) => {
    setSelectedPR(pr);
    if (pr.comments.length > 0) {
      setSelectedComment(pr.comments[0]);
    } else {
      setSelectedComment(null);
    }
  }, []);

  const totalComments = useMemo(() => {
    return prs.reduce((sum, pr) => sum + pr.comments.length, 0);
  }, [prs]);

  // Build a flat list of evaluated comments with their PR info
  const evaluatedComments = useMemo(() => {
    const result: { pr: StoredPR; comment: StoredComment; evaluation: StoredEvaluation }[] = [];
    for (const pr of prs) {
      for (const comment of pr.comments) {
        const evaluation = evaluations.get(comment.id);
        if (evaluation) {
          result.push({ pr, comment, evaluation });
        }
      }
    }
    // Sort by evaluation date (newest first)
    result.sort((a, b) =>
      new Date(b.evaluation.evaluatedAt).getTime() - new Date(a.evaluation.evaluatedAt).getTime()
    );
    return result;
  }, [prs, evaluations]);

  // Rating sort order (worst first for easier review)
  const ratingOrder: Record<string, number> = {
    failed: 0,
    poor: 1,
    acceptable: 2,
    good: 3,
    excellent: 4,
  };

  // Filter and sort evaluated comments
  const filteredEvaluatedComments = useMemo(() => {
    const filtered = evaluatedComments.filter(({ pr, comment, evaluation }) => {
      const matchesSearch =
        searchQuery === "" ||
        pr.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pr.number.toString().includes(searchQuery);

      const matchesBot =
        botFilter === "all" || comment.botLogin === botFilter;

      const matchesRating =
        ratingFilter === "all" ||
        ratingFilter === "unevaluated" ||
        evaluation.evaluation.rating === ratingFilter;

      return matchesSearch && matchesBot && matchesRating;
    });

    // Apply sorting
    if (sortBy === "rating") {
      filtered.sort((a, b) => {
        const aOrder = ratingOrder[a.evaluation.evaluation.rating] ?? 5;
        const bOrder = ratingOrder[b.evaluation.evaluation.rating] ?? 5;
        return aOrder - bOrder; // Worst (failed) first
      });
    } else {
      // Sort by date (newest first) - already sorted by evaluatedComments
      filtered.sort((a, b) =>
        new Date(b.evaluation.evaluatedAt).getTime() - new Date(a.evaluation.evaluatedAt).getTime()
      );
    }

    return filtered;
  }, [evaluatedComments, searchQuery, botFilter, ratingFilter, sortBy]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const handleSelectEvaluatedComment = useCallback(
    (pr: StoredPR, comment: StoredComment) => {
      setSelectedPR(pr);
      setSelectedComment(comment);
    },
    []
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
        <div className="text-lg">Loading bot comments...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
        <div className="text-red-600 dark:text-red-400 mb-4">Error: {error}</div>
        <div className="text-neutral-500 text-sm">
          Make sure to run{" "}
          <code className="bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded">
            bun run fetch
          </code>{" "}
          first
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">Bot Comments Viewer</h1>
          <div className="flex rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("evaluations")}
              className={`px-3 py-1 text-sm transition-colors ${
                viewMode === "evaluations"
                  ? "bg-neutral-200 dark:bg-neutral-700 font-medium"
                  : "bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              Evaluations ({evaluations.size})
            </button>
            <button
              type="button"
              onClick={() => setViewMode("prs")}
              className={`px-3 py-1 text-sm border-l border-neutral-300 dark:border-neutral-700 transition-colors ${
                viewMode === "prs"
                  ? "bg-neutral-200 dark:bg-neutral-700 font-medium"
                  : "bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              All PRs ({prs.length})
            </button>
          </div>
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            {totalComments} comments
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search PRs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:border-neutral-400 dark:focus:border-neutral-500 focus:outline-none"
          />
          <select
            value={botFilter}
            onChange={(e) => setBotFilter(e.target.value)}
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus:border-neutral-400 dark:focus:border-neutral-500 focus:outline-none"
          >
            <option value="all">All bots</option>
            {bots.map((bot) => (
              <option key={bot} value={bot}>
                {bot}
              </option>
            ))}
          </select>
          <select
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value)}
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus:border-neutral-400 dark:focus:border-neutral-500 focus:outline-none"
          >
            <option value="all">All ratings</option>
            <option value="unevaluated">Unevaluated</option>
            <option value="excellent">✅ Excellent</option>
            <option value="good">👍 Good</option>
            <option value="acceptable">🔶 Acceptable</option>
            <option value="poor">⚠️ Poor</option>
            <option value="failed">❌ Failed</option>
          </select>
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - changes based on view mode */}
        {viewMode === "prs" ? (
          /* PR list */
          <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-neutral-200 dark:border-neutral-800">
            {filteredPRs.map((pr) => (
              <button
                key={pr.number}
                type="button"
                onClick={() => handleSelectPR(pr)}
                className={`w-full border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 text-left transition-colors ${
                  selectedPR?.number === pr.number
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    #{pr.number}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      pr.state === "open"
                        ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                        : "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
                    }`}
                  >
                    {pr.state}
                  </span>
                </div>
                <div className="mt-1 truncate text-sm text-neutral-900 dark:text-neutral-100">
                  {pr.title}
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {pr.comments.length} comment
                  {pr.comments.length !== 1 ? "s" : ""}
                </div>
              </button>
            ))}
          </div>
        ) : (
          /* Evaluations list */
          <div className="w-80 flex-shrink-0 overflow-y-auto border-r border-neutral-200 dark:border-neutral-800">
            <div className="sticky top-0 bg-white dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 z-10">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Evaluated ({filteredEvaluatedComments.length})
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as "date" | "rating")}
                  className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-0.5 text-xs text-neutral-900 dark:text-neutral-100 focus:border-neutral-400 dark:focus:border-neutral-500 focus:outline-none"
                >
                  <option value="date">By Date</option>
                  <option value="rating">By Rating</option>
                </select>
              </div>
            </div>
            {filteredEvaluatedComments.map(({ pr, comment, evaluation }) => (
              <button
                key={comment.id}
                type="button"
                onClick={() => handleSelectEvaluatedComment(pr, comment)}
                className={`w-full border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 text-left transition-colors ${
                  selectedComment?.id === comment.id
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      RATING_COLORS[evaluation.evaluation.rating] ?? ""
                    }`}
                  >
                    {RATING_EMOJI[evaluation.evaluation.rating]}{" "}
                    {evaluation.evaluation.rating}
                  </span>
                  <span className="text-xs text-neutral-500">
                    PR #{pr.number}
                  </span>
                </div>
                <div className="truncate text-sm text-neutral-900 dark:text-neutral-100">
                  {pr.title}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(() => {
                    const eval_ = evaluation.evaluation as Record<string, unknown>;
                    const cats = eval_.failureCategories ?? eval_.failure_categories ?? eval_.failure_modes ?? [];
                    const catsArray = Array.isArray(cats) ? cats : [eval_.failure_category].filter(Boolean);
                    return (
                      <>
                        {catsArray.slice(0, 2).map((cat) => (
                          <span
                            key={String(cat)}
                            className="rounded px-1 py-0.5 text-[10px] bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300"
                          >
                            {String(cat).replace(/_/g, " ")}
                          </span>
                        ))}
                        {catsArray.length > 2 && (
                          <span className="text-[10px] text-neutral-500">
                            +{catsArray.length - 2} more
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-600">
                  {new Date(evaluation.evaluatedAt).toLocaleString()}
                </div>
              </button>
            ))}
            {filteredEvaluatedComments.length === 0 && (
              <div className="p-4 text-sm text-neutral-500 text-center">
                No evaluations match filters
              </div>
            )}
          </div>
        )}

        {/* Comment list - only show in PRs view mode */}
        {viewMode === "prs" && selectedPR && (
          <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-neutral-200 dark:border-neutral-800">
            <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-2">
              <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Comments ({selectedPR.comments.length})
              </div>
            </div>
            {selectedPR.comments.map((comment, index) => {
              const evaluation = evaluations.get(comment.id);
              return (
                <button
                  key={comment.id}
                  type="button"
                  onClick={() => setSelectedComment(comment)}
                  className={`w-full border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 text-left transition-colors ${
                    selectedComment?.id === comment.id
                      ? "bg-neutral-100 dark:bg-neutral-800"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-500">#{index + 1}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        comment.type === "issue_comment"
                          ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                          : comment.type === "review_comment"
                            ? "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300"
                            : "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                      }`}
                    >
                      {comment.type.replace("_", " ")}
                    </span>
                    {evaluation && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          RATING_COLORS[evaluation.evaluation.rating] ?? ""
                        }`}
                      >
                        {RATING_EMOJI[evaluation.evaluation.rating]}{" "}
                        {evaluation.evaluation.rating}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {comment.botLogin}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-neutral-700 dark:text-neutral-300">
                    {comment.body.slice(0, 100)}...
                  </div>
                  <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-600">
                    {new Date(comment.createdAt).toLocaleString()}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Detail panel - split view: markdown left, diff right */}
        {selectedPR && selectedComment && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* PR info bar */}
            <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 flex-shrink-0 bg-neutral-50 dark:bg-neutral-900/50">
              <div className="flex items-center gap-2 mb-1">
                <a
                  href={selectedPR.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  #{selectedPR.number}
                </a>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    selectedPR.state === "open"
                      ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                      : "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
                  }`}
                >
                  {selectedPR.state}
                </span>
              </div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                {selectedPR.title}
              </h2>
              <div className="flex items-center gap-4 text-xs">
                <a
                  href={selectedComment.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View Comment
                </a>
                <span className="text-neutral-500">
                  {selectedComment.botLogin}
                </span>
                <span className="text-neutral-500">
                  {new Date(selectedComment.createdAt).toLocaleString()}
                </span>
                {selectedComment.reviewState && (
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      selectedComment.reviewState === "APPROVED"
                        ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                        : selectedComment.reviewState === "CHANGES_REQUESTED"
                          ? "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300"
                          : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                    }`}
                  >
                    {selectedComment.reviewState}
                  </span>
                )}
                {selectedComment.path && (
                  <span className="text-neutral-500 truncate max-w-xs font-mono">
                    {selectedComment.path}
                  </span>
                )}
              </div>
            </div>

            {/* Split view */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left: Evaluation (in evaluations mode) + Markdown */}
              <div className="flex-1 overflow-y-auto p-6 border-r border-neutral-200 dark:border-neutral-800">
                {/* Show evaluation at top in evaluations view mode */}
                {viewMode === "evaluations" && (
                  <EvaluationPanel
                    evaluation={evaluations.get(selectedComment.id) ?? null}
                    showAtTop
                  />
                )}

                <article className="prose prose-neutral dark:prose-invert prose-sm max-w-none">
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {selectedComment.body}
                  </Markdown>
                </article>
                <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-500 font-mono">
                  Commit: {selectedComment.commitSha}
                </div>

                {/* Show evaluation at bottom in PRs view mode */}
                {viewMode === "prs" && (
                  <EvaluationPanel
                    evaluation={evaluations.get(selectedComment.id) ?? null}
                  />
                )}
              </div>

              {/* Right: Diff */}
              <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-neutral-900">
                <div className="sticky top-0 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 px-4 py-2 z-10">
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    PR Diff
                  </span>
                  <span className="ml-2 text-xs text-neutral-500">
                    ({selectedPR.diff.split("\n").length} lines)
                  </span>
                </div>
                <DiffViewer diff={selectedPR.diff} theme={theme} />
              </div>
            </div>
          </div>
        )}

        {selectedPR && !selectedComment && (
          <div className="flex flex-1 items-center justify-center text-neutral-500">
            Select a comment to view
          </div>
        )}

        {!selectedPR && (
          <div className="flex flex-1 items-center justify-center text-neutral-500">
            Select a PR to view comments
          </div>
        )}
      </div>
    </div>
  );
}

type FileInfo = {
  path: string;
  additions: number;
  deletions: number;
  startLine: number;
};

function parseFilesFromDiff(diff: string): FileInfo[] {
  const files: FileInfo[] = [];
  const lines = diff.split("\n");

  let currentFile: FileInfo | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git")) {
      if (currentFile) {
        files.push(currentFile);
      }
      // Extract file path from "diff --git a/path b/path"
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      const path = match ? match[2] : line;
      currentFile = { path, additions: 0, deletions: 0, startLine: i };
    } else if (currentFile) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentFile.additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentFile.deletions++;
      }
    }
  }

  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

type TreeNode = {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[];
  fileInfo?: FileInfo;
};

function buildFileTree(files: FileInfo[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");

      let existing = currentLevel.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          path,
          isFile,
          children: [],
          fileInfo: isFile ? file : undefined,
        };
        currentLevel.push(existing);
      }
      currentLevel = existing.children;
    }
  }

  // Collapse single-child folder chains into "a/b/c" format
  function collapseChains(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((node) => {
      if (node.isFile) {
        return node;
      }

      // First, recursively collapse children
      let collapsed = { ...node, children: collapseChains(node.children) };

      // If this folder has exactly one child and it's also a folder, merge them
      while (
        collapsed.children.length === 1 &&
        !collapsed.children[0].isFile
      ) {
        const child = collapsed.children[0];
        collapsed = {
          ...collapsed,
          name: `${collapsed.name}/${child.name}`,
          path: child.path,
          children: child.children,
        };
      }

      return collapsed;
    });
  }

  // Sort: folders first, then files, alphabetically
  function sortNodes(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .map((n) => ({ ...n, children: sortNodes(n.children) }))
      .sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }

  return sortNodes(collapseChains(root));
}

function FileTreeNode({
  node,
  depth,
  theme,
  onSelect,
  expanded,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  theme: Theme;
  onSelect: (lineNumber: number) => void;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isDark = theme === "dark";
  const isExpanded = expanded.has(node.path);

  if (node.isFile) {
    const info = node.fileInfo!;
    return (
      <button
        type="button"
        onClick={() => onSelect(info.startLine)}
        className={`w-full text-left px-2 py-1 text-xs flex items-center gap-2 ${
          isDark ? "hover:bg-neutral-800" : "hover:bg-neutral-200"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="text-neutral-500">📄</span>
        <span
          className={`truncate flex-1 ${
            isDark ? "text-neutral-300" : "text-neutral-700"
          }`}
        >
          {node.name}
        </span>
        {info.additions > 0 && (
          <span className="text-green-600 dark:text-green-400 text-[10px]">
            +{info.additions}
          </span>
        )}
        {info.deletions > 0 && (
          <span className="text-red-600 dark:text-red-400 text-[10px]">
            -{info.deletions}
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        className={`w-full text-left px-2 py-1 text-xs flex items-center gap-2 ${
          isDark ? "hover:bg-neutral-800" : "hover:bg-neutral-200"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="text-neutral-500">{isExpanded ? "📂" : "📁"}</span>
        <span
          className={`truncate ${
            isDark ? "text-neutral-300" : "text-neutral-700"
          }`}
        >
          {node.name}
        </span>
      </button>
      {isExpanded &&
        node.children.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            theme={theme}
            onSelect={onSelect}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
}

function DiffViewer({
  diff,
  theme,
}: {
  diff: string;
  theme: Theme;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const diffRef = useMemo(() => ({ current: null as HTMLPreElement | null }), []);

  const files = useMemo(() => parseFilesFromDiff(diff), [diff]);
  const fileTree = useMemo(() => buildFileTree(files), [files]);

  // Expand all folders by default
  useEffect(() => {
    const allFolders = new Set<string>();
    function collectFolders(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (!node.isFile) {
          allFolders.add(node.path);
          collectFolders(node.children);
        }
      }
    }
    collectFolders(fileTree);
    setExpanded(allFolders);
  }, [fileTree]);

  const handleToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelectFile = useCallback((lineNumber: number) => {
    setSelectedLine(lineNumber);
    // Scroll to the line
    setTimeout(() => {
      const element = document.getElementById(`diff-line-${lineNumber}`);
      element?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  if (!diff) {
    return (
      <div className="p-4 text-neutral-500 text-sm">No diff available</div>
    );
  }

  const lines = diff.split("\n");
  const isDark = theme === "dark";

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <div
        className={`w-56 flex-shrink-0 overflow-y-auto border-r ${
          isDark ? "border-neutral-700 bg-neutral-900" : "border-neutral-200 bg-neutral-50"
        }`}
      >
        <div
          className={`sticky top-0 px-3 py-2 text-xs font-medium border-b ${
            isDark
              ? "bg-neutral-800 border-neutral-700 text-neutral-300"
              : "bg-neutral-100 border-neutral-200 text-neutral-700"
          }`}
        >
          Files ({files.length})
        </div>
        <div className="py-1">
          {fileTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              theme={theme}
              onSelect={handleSelectFile}
              expanded={expanded}
              onToggle={handleToggle}
            />
          ))}
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-y-auto">
        <pre ref={(el) => { diffRef.current = el; }} className="text-xs font-mono p-0 m-0">
          {lines.map((line, index) => {
            let bgColor = "";
            let textColor = isDark ? "text-neutral-400" : "text-neutral-600";

            if (line.startsWith("+++") || line.startsWith("---")) {
              bgColor = isDark ? "bg-neutral-800" : "bg-neutral-200";
              textColor = isDark
                ? "text-neutral-300 font-medium"
                : "text-neutral-700 font-medium";
            } else if (line.startsWith("@@")) {
              bgColor = isDark ? "bg-blue-950" : "bg-blue-100";
              textColor = isDark ? "text-blue-300" : "text-blue-700";
            } else if (line.startsWith("+")) {
              bgColor = isDark ? "bg-green-950/50" : "bg-green-100";
              textColor = isDark ? "text-green-300" : "text-green-800";
            } else if (line.startsWith("-")) {
              bgColor = isDark ? "bg-red-950/50" : "bg-red-100";
              textColor = isDark ? "text-red-300" : "text-red-800";
            } else if (line.startsWith("diff --git")) {
              bgColor = isDark ? "bg-neutral-800" : "bg-neutral-200";
              textColor = isDark
                ? "text-neutral-200 font-medium"
                : "text-neutral-800 font-medium";
            }

            const isSelected = selectedLine === index;

            return (
              <div
                key={index}
                id={`diff-line-${index}`}
                className={`px-4 py-0.5 ${bgColor} ${textColor} whitespace-pre ${
                  isDark ? "hover:bg-neutral-700/30" : "hover:bg-neutral-200/50"
                } ${isSelected ? (isDark ? "ring-2 ring-blue-500" : "ring-2 ring-blue-400") : ""}`}
              >
                <span
                  className={`select-none w-12 inline-block text-right mr-4 ${
                    isDark ? "text-neutral-600" : "text-neutral-400"
                  }`}
                >
                  {index + 1}
                </span>
                {line}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

function EvaluationPanel({
  evaluation,
  showAtTop = false,
}: {
  evaluation: StoredEvaluation | null;
  showAtTop?: boolean;
}) {
  if (!evaluation) {
    if (showAtTop) {
      return null; // Don't show "not evaluated" message at top
    }
    return (
      <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
        <div className="text-sm text-neutral-500 dark:text-neutral-400 italic">
          Not evaluated yet
        </div>
      </div>
    );
  }

  const { evaluation: eval_ } = evaluation;

  // Normalize field names since LLM may return different variations
  const hasUIChanges = eval_.diffHasUIChanges ?? (eval_ as Record<string, unknown>).ui_change ?? (eval_ as Record<string, unknown>).ui_change_detected ?? (eval_ as Record<string, unknown>).ui_changes_in_diff ?? (eval_ as Record<string, unknown>).ui_change_detection;
  const hasScreenshots = eval_.hasScreenshots ?? (eval_ as Record<string, unknown>).screenshots_provided ?? (eval_ as Record<string, unknown>).screenshots_present;
  const screenshotsAccurate = eval_.screenshotsAccurate ?? (eval_ as Record<string, unknown>).screenshot_accuracy;
  const failureCategories = eval_.failureCategories ?? (eval_ as Record<string, unknown>).failure_categories ?? (eval_ as Record<string, unknown>).failure_modes ?? [];
  const failureCategoriesArray = Array.isArray(failureCategories) ? failureCategories : [(eval_ as Record<string, unknown>).failure_category].filter(Boolean);

  return (
    <div className={showAtTop ? "mb-6 pb-4 border-b border-neutral-200 dark:border-neutral-800" : "mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800"}>
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
        LLM Judge Evaluation
      </h3>

      {/* Rating and confidence */}
      <div className="flex items-center gap-3 mb-4">
        <span
          className={`rounded px-2 py-1 text-sm font-medium ${
            RATING_COLORS[eval_.rating] ?? ""
          }`}
        >
          {RATING_EMOJI[eval_.rating]} {eval_.rating}
        </span>
        {eval_.confidence !== undefined && (
          <span className="text-xs text-neutral-500">
            Confidence: {Math.round((eval_.confidence ?? 0) * 100)}%
          </span>
        )}
        <span className="text-xs text-neutral-500">
          Model: {evaluation.model}
        </span>
      </div>

      {/* Key flags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {hasUIChanges !== undefined && (
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              hasUIChanges
                ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
            }`}
          >
            {hasUIChanges ? "Has UI changes" : "No UI changes"}
          </span>
        )}
        {hasScreenshots !== undefined && (
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              hasScreenshots
                ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
            }`}
          >
            {hasScreenshots ? "Has screenshots" : "No screenshots"}
          </span>
        )}
        {screenshotsAccurate !== undefined && screenshotsAccurate !== null && (
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              screenshotsAccurate
                ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                : "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300"
            }`}
          >
            {screenshotsAccurate
              ? "Screenshots accurate"
              : "Screenshots inaccurate"}
          </span>
        )}
      </div>

      {/* Failure categories */}
      {failureCategoriesArray.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
            Failure Categories
          </div>
          <div className="flex flex-wrap gap-1">
            {failureCategoriesArray.map((cat: string) => (
              <span
                key={cat}
                className="rounded px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300"
              >
                {String(cat).replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Issues */}
      {eval_.issues && eval_.issues.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
            Issues
          </div>
          <ul className="list-disc list-inside text-xs text-neutral-600 dark:text-neutral-400 space-y-0.5">
            {eval_.issues.map((issue: string, i: number) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Strengths */}
      {eval_.strengths && eval_.strengths.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
            Strengths
          </div>
          <ul className="list-disc list-inside text-xs text-neutral-600 dark:text-neutral-400 space-y-0.5">
            {eval_.strengths.map((strength: string, i: number) => (
              <li key={i}>{strength}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      {eval_.suggestions && eval_.suggestions.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
            Suggestions
          </div>
          <ul className="list-disc list-inside text-xs text-neutral-600 dark:text-neutral-400 space-y-0.5">
            {eval_.suggestions.map((suggestion: string, i: number) => (
              <li key={i}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Additional failure case */}
      {eval_.additionalFailureCase && (
        <div className="mb-4">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
            Additional Failure Case
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            {eval_.additionalFailureCase}
          </p>
        </div>
      )}

      {/* Notes */}
      {eval_.notes && (
        <div className="mb-4">
          <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
            Notes
          </div>
          <div className="text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap leading-relaxed">
            {typeof eval_.notes === "object" ? (
              <div className="space-y-3">
                {Object.entries(eval_.notes as Record<string, unknown>).map(([key, value]) => (
                  <div key={key}>
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">
                      {key.replace(/_/g, " ")}:
                    </span>{" "}
                    {String(value)}
                  </div>
                ))}
              </div>
            ) : (
              eval_.notes
            )}
          </div>
        </div>
      )}

      <div className="text-xs text-neutral-400 dark:text-neutral-600">
        Evaluated: {new Date(evaluation.evaluatedAt).toLocaleString()}
      </div>
    </div>
  );
}
