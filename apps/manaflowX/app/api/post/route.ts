import { start } from "workflow/api";
import { handleCreatePost } from "@/workflows/create-post";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { content } = (await request.json()) as { content: string };
  await start(handleCreatePost, [content]);

  return NextResponse.json({
    message: "Post workflow started",
  });
}
