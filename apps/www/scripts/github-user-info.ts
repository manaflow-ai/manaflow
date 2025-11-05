import { env } from "@/lib/utils/www-env";
import { StackAdminApp } from "@stackframe/js";
import { Octokit } from "octokit";

// Admin app to act server-side and retrieve a user's connected provider tokens
const admin = new StackAdminApp({
  tokenStore: "memory",
  projectId: env.NEXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: env.STACK_SECRET_SERVER_KEY,
  superSecretAdminKey: env.STACK_SUPER_SECRET_ADMIN_KEY,
});

// Provide a user id via env or fallback to the known test id
const USER_ID =
  process.env.STACK_TEST_USER_ID || "487b5ddc-0da0-4f12-8834-f452863a83f5";

async function main() {
  const user = await admin.getUser(USER_ID);
  if (!user) throw new Error(`User not found: ${USER_ID}`);

  // Get user's GitHub connected account and its OAuth token
  const connected = await user.getConnectedAccount("github");
  if (!connected) throw new Error("No GitHub connected account");

  const raw = await connected.getAccessToken();
  type TokenLike =
    | string
    | { accessToken?: string; token?: string; value?: string; access_token?: string };
  const normalizeToken = (t: TokenLike | null | undefined): string | null => {
    if (!t) return null;
    if (typeof t === "string") return t;
    if (typeof t === "object") {
      return (
        (t.accessToken && String(t.accessToken)) ||
        (t.token && String(t.token)) ||
        (t.value && String(t.value)) ||
        (t.access_token && String(t.access_token)) ||
        null
      );
    }
    return null;
  };
  const token = normalizeToken(raw);
  if (!token) {
    console.error("Connected account token payload:", JSON.stringify(raw));
    throw new Error("No GitHub access token (unexpected shape)");
  }

  const octokit = new Octokit({ auth: token });

  // Fetch id/login
  const u = await octokit.request("GET /user");
  const id: number = u.data.id as number;
  const login: string = String(u.data.login);
  const derivedNoreply = `${id}+${login}@users.noreply.github.com`;

  // Attempt to read emails (requires user:email scope)
  let emails: string[] = [];
  let primaryEmail: string | null = null;
  let canReadEmails = false;
  try {
    const e = await octokit.request("GET /user/emails");
    type EmailRec = { email: string; primary?: boolean; verified?: boolean; visibility?: string | null };
    const list = e.data as unknown as EmailRec[];
    if (Array.isArray(list)) {
      emails = list.map((rec) => String(rec.email));
      const primary = list.find((rec) => rec.primary);
      primaryEmail = primary ? String(primary.email) : null;
      canReadEmails = true;
    }
  } catch (_err) {
    console.error("[apps/www/scripts/github-user-info.ts] Caught error", _err);

    // Token might not have user:email; ignore
  }

  console.log(
    JSON.stringify(
      { id, login, derivedNoreply, emails, primaryEmail, canReadEmails },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
