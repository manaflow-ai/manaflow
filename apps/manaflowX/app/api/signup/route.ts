import { start } from "workflow/api";
import { handleUserSignup } from "@/workflows/user-signup";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { email } = (await request.json()) as { email: string };
  await start(handleUserSignup, [email]);

  return NextResponse.json({
    message: "User signup workflow started",
  });
}
