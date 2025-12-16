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
  if (!token) {
    return null;
  }

  try {
    const payload = await verifyTaskRunToken(
      token,
      env.CMUX_TASK_RUN_JWT_SECRET
    );
    return { token, payload };
  } catch (error) {
    const prefix = options?.loggerPrefix ?? "[convex.workerAuth]";
    console.error(`${prefix} Failed to verify task run token`, error);
    return null;
  }
}
