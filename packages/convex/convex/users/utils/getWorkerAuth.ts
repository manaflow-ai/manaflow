import {
  verifyTaskRunToken,
  type TaskRunTokenPayload,
} from "@cmux/shared/convex-safe";
import { env } from "../../../_shared/convex-env";

export type WorkerAuthContext = {
  token: string;
  payload: TaskRunTokenPayload;
};

type GetWorkerAuthOptions = {
  loggerPrefix?: string;
};

export async function getWorkerAuth(
  req: Request,
  options?: GetWorkerAuthOptions
): Promise<WorkerAuthContext | null> {
  const token = req.headers.get("x-cmux-token");
  const prefix = options?.loggerPrefix ?? "[convex.workerAuth]";

  if (!token) {
    return null;
  }

  // Debug logging to understand JWT validation issues
  const tokenLength = token.length;
  const tokenParts = token.split(".");
  const tokenPreview = token.slice(0, 50);
  console.log(`${prefix} JWT debug:`, {
    length: tokenLength,
    parts: tokenParts.length,
    preview: tokenPreview,
    endsCorrectly: token.slice(-20),
  });

  try {
    const payload = await verifyTaskRunToken(
      token,
      env.CMUX_TASK_RUN_JWT_SECRET
    );
    return { token, payload };
  } catch (error) {
    console.error(`${prefix} Failed to verify task run token`, error);
    return null;
  }
}
