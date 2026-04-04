import { MANAFLOW_DEPRECATED } from "@/lib/deprecation";
import { app } from "@/lib/hono-app";
import { handle } from "hono/vercel";
import { NextResponse } from "next/server";

function blocked() {
  return NextResponse.json(
    { error: "Manaflow is temporarily unavailable" },
    { status: 503 },
  );
}

const honoGet = handle(app);
const honoPost = handle(app);
const honoPut = handle(app);
const honoDelete = handle(app);
const honoPatch = handle(app);
const honoOptions = handle(app);

export const GET = MANAFLOW_DEPRECATED ? blocked : honoGet;
export const POST = MANAFLOW_DEPRECATED ? blocked : honoPost;
export const PUT = MANAFLOW_DEPRECATED ? blocked : honoPut;
export const DELETE = MANAFLOW_DEPRECATED ? blocked : honoDelete;
export const PATCH = MANAFLOW_DEPRECATED ? blocked : honoPatch;
export const OPTIONS = MANAFLOW_DEPRECATED ? blocked : honoOptions;
