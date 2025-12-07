import { NextRequest, NextResponse } from "next/server";

/**
 * Test X API connection by fetching the authenticated user's profile.
 * This is a server-side proxy to avoid CORS issues with the X API.
 *
 * Reference: https://docs.x.com/x-api/users/lookup/api-reference/get-users-me
 */
export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json();

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "No access token provided" },
        { status: 400 }
      );
    }

    // Call X API to get current user
    const response = await fetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          success: false,
          error: `X API error: ${response.status} - ${errorText}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (data.data) {
      return NextResponse.json({
        success: true,
        user: {
          id: data.data.id,
          username: data.data.username,
          name: data.data.name,
          profile_image_url: data.data.profile_image_url,
        },
      });
    } else {
      return NextResponse.json(
        { success: false, error: "No user data returned from X API" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[X API Test] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
