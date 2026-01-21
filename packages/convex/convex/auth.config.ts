// Use process.env directly to avoid triggering detection of all env vars from convex-env.ts
const STACK_PROJECT_ID = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
if (!STACK_PROJECT_ID) {
  throw new Error("NEXT_PUBLIC_STACK_PROJECT_ID environment variable is required");
}

export default {
  providers: [
    {
      type: "customJwt",
      applicationID: STACK_PROJECT_ID,
      issuer: `https://api.stack-auth.com/api/v1/projects/${STACK_PROJECT_ID}`,
      jwks: `https://api.stack-auth.com/api/v1/projects/${STACK_PROJECT_ID}/.well-known/jwks.json?include_anonymous=true`,
      algorithm: "ES256",
    },
    {
      type: "customJwt",
      applicationID: `${STACK_PROJECT_ID}:anon`,
      issuer: `https://api.stack-auth.com/api/v1/projects-anonymous-users/${STACK_PROJECT_ID}`,
      jwks: `https://api.stack-auth.com/api/v1/projects/${STACK_PROJECT_ID}/.well-known/jwks.json?include_anonymous=true`,
      algorithm: "ES256",
    },
  ],
};
