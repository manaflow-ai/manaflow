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

// =============================================================================
// TWITTER SEARCH API (via Grok)
// =============================================================================
// Grok has access to real-time X/Twitter data through the xAI API
// We use Grok to search and retrieve relevant tweets

export type Tweet = {
  id: string;
  text: string;
  authorUsername: string;
  authorName: string;
  authorProfileImageUrl?: string;
  createdAt: string;
  metrics?: {
    likes: number;
    retweets: number;
    replies: number;
    views?: number;
  };
  mediaUrls?: string[];
  quotedTweet?: {
    id: string;
    text: string;
    authorUsername: string;
  };
};

export type TweetSearchResult = {
  success: true;
  tweets: Tweet[];
} | {
  success: false;
  error: string;
};

// =============================================================================
// TWITTER SEARCH API (via X API v2)
// =============================================================================
// Uses the X API v2 to search for recent tweets
// Reference: https://docs.x.com/x-api/posts/search-recent-posts

export type SearchTweetsParams = {
  query: string;
  maxResults?: number; // 10-100, default 10
  bearerToken: string;
};

export type SearchTweetsResponse = {
  success: true;
  tweets: Tweet[];
} | {
  success: false;
  error: string;
};

/**
 * Search recent tweets using X API v2
 * Reference: GET https://api.x.com/2/tweets/search/recent
 */
export async function searchRecentTweets(params: SearchTweetsParams): Promise<SearchTweetsResponse> {
  const { query, maxResults = 10, bearerToken } = params;

  try {
    const searchParams = new URLSearchParams({
      query,
      max_results: String(Math.min(Math.max(maxResults, 10), 100)),
      "tweet.fields": "created_at,public_metrics,entities",
      "expansions": "author_id,attachments.media_keys",
      "user.fields": "username,name,profile_image_url",
      "media.fields": "url,preview_image_url",
    });

    const response = await fetch(
      `https://api.x.com/2/tweets/search/recent?${searchParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[twitterApi] Search error:", response.status, errorText);
      return {
        success: false,
        error: `X API error: ${response.status} - ${errorText}`,
      };
    }

    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        text: string;
        author_id: string;
        created_at?: string;
        public_metrics?: {
          like_count: number;
          retweet_count: number;
          reply_count: number;
          impression_count?: number;
        };
        attachments?: {
          media_keys?: string[];
        };
      }>;
      includes?: {
        users?: Array<{
          id: string;
          username: string;
          name: string;
          profile_image_url?: string;
        }>;
        media?: Array<{
          media_key: string;
          url?: string;
          preview_image_url?: string;
        }>;
      };
      meta?: {
        result_count: number;
      };
      errors?: Array<{ message: string }>;
    };

    if (!data.data || data.data.length === 0) {
      return {
        success: true,
        tweets: [],
      };
    }

    // Build lookup maps for users and media
    const usersMap = new Map<string, { username: string; name: string; profile_image_url?: string }>();
    if (data.includes?.users) {
      for (const user of data.includes.users) {
        usersMap.set(user.id, {
          username: user.username,
          name: user.name,
          profile_image_url: user.profile_image_url,
        });
      }
    }

    const mediaMap = new Map<string, string>();
    if (data.includes?.media) {
      for (const media of data.includes.media) {
        const url = media.url || media.preview_image_url;
        if (url) {
          mediaMap.set(media.media_key, url);
        }
      }
    }

    // Transform tweets to our format
    const tweets: Tweet[] = data.data.map((tweet) => {
      const user = usersMap.get(tweet.author_id);
      const mediaUrls: string[] = [];
      if (tweet.attachments?.media_keys) {
        for (const key of tweet.attachments.media_keys) {
          const url = mediaMap.get(key);
          if (url) mediaUrls.push(url);
        }
      }

      return {
        id: tweet.id,
        text: tweet.text,
        authorUsername: user?.username || "unknown",
        authorName: user?.name || "Unknown",
        authorProfileImageUrl: user?.profile_image_url,
        createdAt: tweet.created_at || new Date().toISOString(),
        metrics: tweet.public_metrics ? {
          likes: tweet.public_metrics.like_count,
          retweets: tweet.public_metrics.retweet_count,
          replies: tweet.public_metrics.reply_count,
          views: tweet.public_metrics.impression_count,
        } : undefined,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
      };
    });

    return {
      success: true,
      tweets,
    };
  } catch (error) {
    console.error("[twitterApi] Search exception:", error);
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
