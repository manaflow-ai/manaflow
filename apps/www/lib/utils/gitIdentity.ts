export type ConvexUserMinimal = {
  displayName?: string | null;
  primaryEmail?: string | null;
};

export type GithubUserMinimal = {
  login?: string;
  derivedNoreply?: string;
  primaryEmail?: string | null;
};

function sanitizeNameForEmailBase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "manaflow";
}

export function selectGitIdentity(
  who: ConvexUserMinimal | null | undefined,
  gh: GithubUserMinimal | null | undefined
): { name: string; email: string } {
  const name = (who?.displayName || gh?.login || "manaflow").trim();

  // Prefer GitHub noreply first; then fall back to Convex primary, then GitHub primary, then sanitized-name noreply
  let email = (gh?.derivedNoreply || "").trim();
  if (!email && who?.primaryEmail) email = who.primaryEmail.trim();
  if (!email && gh?.primaryEmail) email = gh.primaryEmail.trim();
  if (!email) email = `${sanitizeNameForEmailBase(name)}@users.noreply.github.com`;

  return { name, email };
}

