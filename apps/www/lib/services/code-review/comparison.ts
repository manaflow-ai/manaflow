type ComparisonRefInput = {
  raw: string;
  defaultOwner: string;
  repoName: string;
};

export type ComparisonRefDetails = {
  owner: string;
  repo: string;
  ref: string;
  label: string;
};

export type ComparisonJobDetails = {
  slug: string;
  base: ComparisonRefDetails;
  head: ComparisonRefDetails;
  repoFullName: string;
  compareUrl: string;
};

export function parseComparisonRef({
  raw,
  defaultOwner,
  repoName,
}: ComparisonRefInput): ComparisonRefDetails {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Comparison ref cannot be empty");
  }

  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex === -1) {
    return {
      owner: defaultOwner,
      repo: repoName,
      ref: trimmed,
      label: trimmed,
    };
  }

  const owner = trimmed.slice(0, separatorIndex).trim();
  const ref = trimmed.slice(separatorIndex + 1).trim();
  if (owner.length === 0 || ref.length === 0) {
    throw new Error(`Invalid comparison ref: ${raw}`);
  }

  return {
    owner,
    repo: repoName,
    ref,
    label: trimmed,
  };
}

export function buildComparisonJobDetails({
  repoOwner,
  repoName,
  baseRef,
  headRef,
}: {
  repoOwner: string;
  repoName: string;
  baseRef: string;
  headRef: string;
}): ComparisonJobDetails {
  const base = parseComparisonRef({
    raw: baseRef,
    defaultOwner: repoOwner,
    repoName,
  });
  const head = parseComparisonRef({
    raw: headRef,
    defaultOwner: repoOwner,
    repoName,
  });

  const slug = `${base.label}...${head.label}`;
  const repoFullName = `${repoOwner}/${repoName}`;
  const compareUrl = `https://github.com/${repoFullName}/compare/${encodeURIComponent(
    base.label
  )}...${encodeURIComponent(head.label)}`;

  return {
    slug,
    base,
    head,
    repoFullName,
    compareUrl,
  };
}
