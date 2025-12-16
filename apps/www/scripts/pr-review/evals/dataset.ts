export interface EvalPR {
  id: string;
  url: string;
  title: string;
  description: string;
  tags: string[];
  metadata: {
    owner: string;
    repo: string;
    number: number;
    language: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  expectedIssues?: ExpectedIssue[];
}

export interface ExpectedIssue {
  file: string;
  type: "bug" | "security" | "performance" | "style" | "maintainability" | "correctness";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  lineRange?: {
    start: number;
    end: number;
  };
  snippet?: string;
}

export interface EvalDataset {
  version: string;
  prs: EvalPR[];
}

export const EVAL_DATASET: EvalDataset = {
  version: "1.0.0",
  prs: [
    {
      id: "cmux-728",
      url: "https://github.com/manaflow-ai/cmux/pull/728/files",
      title: "Initial PR for eval dataset",
      description: "Base case PR from cmux repo",
      tags: ["typescript", "react", "baseline"],
      metadata: {
        owner: "manaflow-ai",
        repo: "cmux",
        number: 728,
        language: "typescript",
        filesChanged: 0, // Will be populated by fetch
        additions: 0,
        deletions: 0,
      },
      expectedIssues: [],
    },
    {
      id: "stack-auth-943",
      url: "https://github.com/stack-auth/stack-auth/pull/943/files",
      title: "Stack Auth PR #943",
      description: "User-suggested PR from stack-auth repository",
      tags: ["typescript", "auth", "user-suggested"],
      metadata: {
        owner: "stack-auth",
        repo: "stack-auth",
        number: 943,
        language: "typescript",
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      },
      expectedIssues: [],
    },
    {
      id: "pandas-56442",
      url: "https://github.com/pandas-dev/pandas/pull/56442/files",
      title: "BUG: merge not sorting for new string dtype",
      description: "Python/pandas bug - merge function not properly sorting with new string dtype",
      tags: ["python", "pandas", "bug-fix", "sorting"],
      metadata: {
        owner: "pandas-dev",
        repo: "pandas",
        number: 56442,
        language: "python",
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      },
      expectedIssues: [
        {
          file: "pandas/core/reshape/merge.py",
          type: "bug",
          severity: "medium",
          description: "Merge function not respecting sort parameter with new string dtype",
        },
      ],
    },
    {
      id: "nextjs-58297",
      url: "https://github.com/vercel/next.js/pull/58297/files",
      title: "Don't reset shallow URL updates on prefetch",
      description: "TypeScript/Next.js bug - shallow URL updates being reset incorrectly during prefetch",
      tags: ["typescript", "nextjs", "bug-fix", "routing"],
      metadata: {
        owner: "vercel",
        repo: "next.js",
        number: 58297,
        language: "typescript",
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      },
      expectedIssues: [
        {
          file: "packages/next/src/client/components/app-router.tsx",
          type: "bug",
          severity: "medium",
          description: "Shallow URL updates incorrectly reset when prefetching links",
        },
      ],
    },
    {
      id: "cargo-14966",
      url: "https://github.com/rust-lang/cargo/pull/14966/files",
      title: "Check dirtiness of path fields in manifest",
      description: "Rust/Cargo performance issue - potential slowdown with thousands of symlinks",
      tags: ["rust", "performance", "cargo"],
      metadata: {
        owner: "rust-lang",
        repo: "cargo",
        number: 14966,
        language: "rust",
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      },
      expectedIssues: [
        {
          file: "src/cargo/core/package.rs",
          type: "performance",
          severity: "medium",
          description: "May fire git status for each symlink, causing performance issues with many symlinks",
        },
      ],
    },
    {
      id: "sentry-python-1532",
      url: "https://github.com/getsentry/sentry-python/pull/1532/files",
      title: "Fix FastAPI issues",
      description: "Python bug fixes for FastAPI integration - infinite loop and exception handler patches",
      tags: ["python", "fastapi", "bug-fix", "integration"],
      metadata: {
        owner: "getsentry",
        repo: "sentry-python",
        number: 1532,
        language: "python",
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      },
      expectedIssues: [
        {
          file: "sentry_sdk/integrations/fastapi.py",
          type: "bug",
          severity: "high",
          description: "Infinite loop during form posts and exception handler patching issues",
        },
      ],
    },
    {
      id: "apollo-client-9599",
      url: "https://github.com/apollographql/apollo-client/pull/9599/files",
      title: "Fix extra useQuery result frames",
      description: "TypeScript/React bug - eliminating unnecessary render frames in useQuery hook",
      tags: ["typescript", "react", "apollo", "bug-fix", "performance"],
      metadata: {
        owner: "apollographql",
        repo: "apollo-client",
        number: 9599,
        language: "typescript",
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      },
      expectedIssues: [
        {
          file: "src/react/hooks/useQuery.ts",
          type: "bug",
          severity: "medium",
          description: "Extra render frames causing performance issues in useQuery hook",
        },
      ],
    },
  ],
};
