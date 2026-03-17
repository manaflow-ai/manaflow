import type {
  ServerToWorkerEvents,
  WorkerToServerEvents,
  WorkerUploadFiles,
} from "@cmux/shared";
import type { Socket } from "@cmux/shared/socket";

export async function workerUploadFiles({
  workerSocket,
  payload,
  timeout = 60_000,
}: {
  workerSocket: Socket<WorkerToServerEvents, ServerToWorkerEvents>;
  payload: WorkerUploadFiles;
  timeout?: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      workerSocket
        .timeout(timeout)
        .emit("worker:upload-files", payload, (error, result) => {
          if (error) {
            if (
              error instanceof Error &&
              error.message === "operation has timed out"
            ) {
              console.error(
                `[workerUploadFiles] Socket timeout after ${timeout}ms`
              );
              reject(
                new Error(
                  `worker:upload-files timed out after ${timeout}ms`
                )
              );
            } else {
              reject(error);
            }
            return;
          }
          if (result.error) {
            reject(result.error);
            return;
          }
          resolve();
        });
    } catch (err) {
      console.error("[workerUploadFiles] Emit failed", err);
      reject(err);
    }
  });
}
