export type GithubUserInfo = {
  id: number;
  login: string;
  derivedNoreply: string;
  emails: string[];
  primaryEmail: string | null;
  canReadEmails: boolean;
};

export async function fetchGithubUserInfoForRequest(
  githubAccessToken: string
): Promise<GithubUserInfo | null> {
  const uRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${githubAccessToken}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!uRes.ok) return null;
  const u = (await uRes.json()) as { id: number; login: string };

  const derivedNoreply = `${u.id}+${u.login}@users.noreply.github.com`;

  // Try to fetch emails; may require user:email scope
  let emails: string[] = [];
  let primaryEmail: string | null = null;
  let canReadEmails = false;
  try {
    const eRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (eRes.ok) {
      type EmailRec = {
        email: string;
        primary?: boolean;
        verified?: boolean;
        visibility?: string | null;
      };
      const list = (await eRes.json()) as EmailRec[];
      if (Array.isArray(list)) {
        emails = list.map((r) => r.email);
        const primary = list.find((r) => r.primary);
        primaryEmail = primary ? primary.email : null;
        canReadEmails = true;
      }
    }
  } catch (error) {
    console.error(
      "[githubUserInfo] Failed to fetch user emails",
      error,
    );
    // Ignore; token may lack scope
  }

  return {
    id: u.id,
    login: u.login,
    derivedNoreply,
    emails,
    primaryEmail,
    canReadEmails,
  };
}
