import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { setCookie } from "hono/cookie";
import { stackServerApp } from "@/lib/utils/stack";
import { env } from "@/lib/utils/www-env";

export const authAnonymousRouter = new OpenAPIHono();

const AnonymousSignUpResponse = z
  .object({
    success: z.boolean(),
    userId: z.string().optional(),
    teamId: z.string().optional(),
    teams: z
      .array(
        z.object({
          id: z.string(),
          display_name: z.string(),
          profile_image_url: z.string().nullable(),
        })
      )
      .optional(),
    message: z.string().optional(),
  })
  .openapi("AnonymousSignUpResponse");

authAnonymousRouter.openapi(
  createRoute({
    method: "post",
    path: "/auth/anonymous/sign-up",
    tags: ["Auth"],
    summary: "Create an anonymous user for public repo access",
    responses: {
      200: {
        description: "Anonymous user created successfully",
        content: {
          "application/json": {
            schema: AnonymousSignUpResponse,
          },
        },
      },
      400: { description: "Bad request" },
      500: { description: "Server error" },
    },
  }),
  async (c) => {
    try {
      // Try to create anonymous user using Stack Auth API
      const response = await fetch("https://api.stack-auth.com/api/v1/auth/anonymous/sign-up", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stack-project-id": env.NEXT_PUBLIC_STACK_PROJECT_ID,
          "x-stack-publishable-client-key": env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
          "x-stack-secret-server-key": env.STACK_SECRET_SERVER_KEY,
          "x-stack-access-type": "server",
        },
        body: JSON.stringify({}),
      });

      const responseText = await response.text();
      console.log("[authAnonymous] Stack API response status:", response.status);
      console.log("[authAnonymous] Stack API response:", responseText);

      if (!response.ok) {
        let errorData: { code?: string; message?: string } = {};
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = { message: responseText };
        }

        // If anonymous accounts aren't enabled, return a clear error
        if (errorData.code === "ANONYMOUS_ACCOUNTS_NOT_ENABLED" || response.status === 403) {
          return c.json(
            {
              success: false,
              message: "Anonymous accounts are not enabled for this project",
            },
            400
          );
        }

        console.error("[authAnonymous] Failed to create anonymous user:", errorData);
        return c.json(
          {
            success: false,
            message: errorData.message || "Failed to create anonymous user",
          }
        );
      }

      const data = JSON.parse(responseText);

      // Set the Stack Auth cookies with proper format using Hono's cookie helper
      if (data.access_token && data.refresh_token) {
        // Stack Auth cookie format: stack-access (no project ID) and stack-refresh-{projectId}
        const projectId = env.NEXT_PUBLIC_STACK_PROJECT_ID;

        const cookieOptions = {
          path: "/",
          maxAge: 31536000, // 1 year
          sameSite: "Lax" as const,
          secure: process.env.NODE_ENV === "production",
          httpOnly: false, // Stack Auth needs client-side access
        };

        // Set access token cookie - format: stack-access (no project ID!)
        console.log("[authAnonymous] Setting stack-access cookie");
        setCookie(c, "stack-access", data.access_token, cookieOptions);

        // Set refresh token cookie - format: stack-refresh-{projectId}
        console.log("[authAnonymous] Setting stack-refresh cookie");
        setCookie(c, `stack-refresh-${projectId}`, data.refresh_token, cookieOptions);

        // Set the HTTPS indicator cookie (required by Stack Auth)
        console.log("[authAnonymous] Setting stack-is-https cookie");
        setCookie(c, "stack-is-https", "true", cookieOptions);

        // Fetch teams for the specific anonymous user
        try {
          console.log("[authAnonymous] Fetching teams for anonymous user:", data.user_id);

          // Get the user object from Stack Auth
          const user = await stackServerApp.getUser(data.user_id);

          // Get teams for this specific user
          const teams = await user.listTeams();
          console.log("[authAnonymous] User teams:", teams);

          const userTeams = teams.map(team => ({
            id: team.id,
            display_name: team.displayName,
            profile_image_url: team.profileImageUrl,
          }));

          console.log("[authAnonymous] Anonymous user created successfully", {
            success: true,
            userId: data.user_id,
            teamId: userTeams?.[0].id,
            teams: userTeams,
            message: "Anonymous user created successfully",
          });

          return c.json({
            success: true,
            userId: data.user_id,
            teamId: userTeams?.[0]?.id,
            teams: userTeams,
            message: "Anonymous user created successfully",
          });
        } catch (teamsErr) {
          console.error("[authAnonymous] Failed to fetch teams:", teamsErr);
          // Still return success for user creation even if team fetch fails
          return c.json({
            success: true,
            userId: data.user_id,
            teamId: undefined,
            teams: [],
            message: "Anonymous user created successfully (teams fetch failed)",
          });
        }
      }

      return c.json(
        {
          success: false,
          message: "No tokens received from Stack Auth",
        },
        500
      );
    } catch (error) {
      console.error("[authAnonymous] Error creating anonymous user:", error);
      return c.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Internal server error",
        },
        500
      );
    }
  }
);
