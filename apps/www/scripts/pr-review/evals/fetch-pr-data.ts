import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Octokit } from "octokit";
import { getGithubToken, parsePrUrl } from "../github";
import type { EvalPR } from "./dataset";

interface FetchedPRData {
  metadata: {
    owner: string;
    repo: string;
    number: number;
    language: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    title: string;
    body: string;
    state: string;
    createdAt: string;
    mergedAt: string | null;
  };
  diff: string;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>;
}

export async function fetchPRData(prUrl: string): Promise<FetchedPRData> {
  const parsed = parsePrUrl(prUrl);
  const token = getGithubToken();
  const octokit = new Octokit(token ? { auth: token } : {});

  const [prResponse, diffResponse, filesResponse] = await Promise.all([
    octokit.rest.pulls.get({
      owner: parsed.owner,
      repo: parsed.repo,
      pull_number: parsed.number,
    }),
    fetch(`https://patch-diff.githubusercontent.com/raw/${parsed.owner}/${parsed.repo}/pull/${parsed.number}.diff`),
    octokit.rest.pulls.listFiles({
      owner: parsed.owner,
      repo: parsed.repo,
      pull_number: parsed.number,
      per_page: 100,
    }),
  ]);

  if (!diffResponse.ok) {
    throw new Error(`Failed to fetch diff: ${diffResponse.status}`);
  }

  const diff = await diffResponse.text();
  const pr = prResponse.data;

  return {
    metadata: {
      owner: parsed.owner,
      repo: parsed.repo,
      number: parsed.number,
      language: pr.base.repo.language ?? "unknown",
      filesChanged: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      title: pr.title,
      body: pr.body ?? "",
      state: pr.state,
      createdAt: pr.created_at,
      mergedAt: pr.merged_at,
    },
    diff,
    files: filesResponse.data.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    })),
  };
}

export async function persistPRData(
  evalPR: EvalPR,
  data: FetchedPRData,
  outputDir: string
): Promise<void> {
  const prDir = join(outputDir, evalPR.id);
  await mkdir(prDir, { recursive: true });

  await writeFile(
    join(prDir, "metadata.json"),
    JSON.stringify(data.metadata, null, 2)
  );

  await writeFile(join(prDir, "full.diff"), data.diff);

  await writeFile(
    join(prDir, "files.json"),
    JSON.stringify(data.files, null, 2)
  );

  for (const file of data.files) {
    if (file.patch) {
      const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      await writeFile(join(prDir, `${safeName}.diff`), file.patch);
    }
  }

  const readmeContent = `# ${evalPR.title}

**URL**: ${evalPR.url}
**Description**: ${evalPR.description}
**Tags**: ${evalPR.tags.join(", ")}

## Metadata
- **Language**: ${data.metadata.language}
- **Files Changed**: ${data.metadata.filesChanged}
- **Additions**: +${data.metadata.additions}
- **Deletions**: -${data.metadata.deletions}
- **State**: ${data.metadata.state}
- **Created**: ${data.metadata.createdAt}
${data.metadata.mergedAt ? `- **Merged**: ${data.metadata.mergedAt}` : ""}

## Files
${data.files.map((f) => `- \`${f.filename}\` (${f.status}): +${f.additions} -${f.deletions}`).join("\n")}

## Expected Issues
${
  evalPR.expectedIssues && evalPR.expectedIssues.length > 0
    ? evalPR.expectedIssues
        .map(
          (issue, i) => `
### Issue ${i + 1}: ${issue.type} (${issue.severity})
**File**: \`${issue.file}\`
**Description**: ${issue.description}
${issue.snippet ? `**Snippet**:\n\`\`\`\n${issue.snippet}\n\`\`\`` : ""}
`
        )
        .join("\n")
    : "No expected issues defined yet."
}

## How to View
- Full diff: \`full.diff\`
- Individual file diffs: \`*.diff\`
- File metadata: \`files.json\`
`;

  await writeFile(join(prDir, "README.md"), readmeContent);
}
