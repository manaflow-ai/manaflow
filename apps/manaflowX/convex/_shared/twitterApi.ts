/**
 * Twitter/X API helper functions for OAuth 2.0 flow
 * Reference: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
 */

export type TwitterTokenResponse = {
  success: true;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope: string;
} | {
  success: false;
  error: string;
};

export type TwitterUserResponse = {
  success: true;
  user: {
    id: string;
    username: string;
    name: string;
    profile_image_url?: string;
  };
} | {
  success: false;
  error: string;
};

/**
 * Exchange authorization code for access token
 * Reference: POST https://api.x.com/2/oauth2/token
 */
export async function exchangeTwitterCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TwitterTokenResponse> {
  const { code, codeVerifier, clientId, clientSecret, redirectUri } = params;

  // Create Basic auth header for confidential clients
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  try {
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: body.toString(),
    });

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !data.access_token) {
      console.error("[twitterApi] Token exchange error:", data);
      return {
        success: false,
        error: data.error_description || data.error || "Token exchange failed",
      };
    }

    return {
      success: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type || "bearer",
      scope: data.scope || "",
    };
  } catch (error) {
    console.error("[twitterApi] Token exchange exception:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch authenticated user's profile
 * Reference: GET /2/users/me
 */
export async function fetchTwitterUser(accessToken: string): Promise<TwitterUserResponse> {
  try {
    const response = await fetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = (await response.json()) as {
      data?: {
        id: string;
        username: string;
        name: string;
        profile_image_url?: string;
      };
      errors?: Array<{ message: string }>;
    };

    if (!response.ok || !data.data) {
      console.error("[twitterApi] User fetch error:", data);
      return {
        success: false,
        error: data.errors?.[0]?.message || "Failed to fetch user",
      };
    }

    return {
      success: true,
      user: data.data,
    };
  } catch (error) {
    console.error("[twitterApi] User fetch exception:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Refresh access token using refresh token
 * Reference: POST https://api.x.com/2/oauth2/token with grant_type=refresh_token
 */
export async function refreshTwitterToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<TwitterTokenResponse> {
  const { refreshToken, clientId, clientSecret } = params;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  try {
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: body.toString(),
    });

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !data.access_token) {
      console.error("[twitterApi] Token refresh error:", data);
      return {
        success: false,
        error: data.error_description || data.error || "Token refresh failed",
      };
    }

    return {
      success: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type || "bearer",
      scope: data.scope || "",
    };
  } catch (error) {
    console.error("[twitterApi] Token refresh exception:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
