import type { Id } from "@cmux/convex/dataModel";
import type {
  ServerToWorkerEvents,
  WorkerSyncFiles,
  WorkerToServerEvents,
  WorkerUploadFiles,
} from "@cmux/shared";
import type { Socket } from "@cmux/shared/socket";
import chokidar, { type FSWatcher } from "chokidar";
import { createHash } from "node:crypto";
import ignore, { type Ignore } from "ignore";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { serverLogger } from "./utils/fileLogger";
import { workerUploadFiles } from "./utils/workerUploadFiles";
import { VSCodeInstance } from "./vscode/VSCodeInstance";

/**
 * Compute a fast content hash for change detection.
 * Using MD5 for speed - this is for change detection, not security.
 */
function computeContentHash(content: Buffer): string {
  return createHash("md5").update(content).digest("hex");
}

type WorkerSocket = Socket<WorkerToServerEvents, ServerToWorkerEvents>;
type SyncAction = "write" | "delete";

type PendingChange = {
  action: SyncAction;
  absolutePath: string;
  relativePath: string;
};

const DEFAULT_IGNORES = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  "out/",
  ".cache/",
  ".turbo/",
  ".parcel-cache/",
  ".idea/",
  ".vscode/",
  "**/*.log",
];

const MAX_BATCH_FILES = 200;
const MAX_BATCH_BYTES = 6 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024;

function normalizeRelativePath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

async function buildIgnoreMatcher(workspacePath: string): Promise<Ignore> {
  const ig = ignore();
  try {
    const giPath = path.join(workspacePath, ".gitignore");
    const contents = await fs.readFile(giPath, "utf8");
    ig.add(contents.split("\n"));
  } catch (error) {
    console.error("[localCloudSync] Failed to read .gitignore", error);
  }
  ig.add(DEFAULT_IGNORES);
  return ig;
}

async function collectWorkspaceFiles(
  workspacePath: string,
  ig: Ignore
): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [workspacePath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Array<{
      name: string;
      isFile: () => boolean;
      isDirectory: () => boolean;
      isSymbolicLink: () => boolean;
    }> = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      console.error(
        `[localCloudSync] Failed to read directory ${current}`,
        error
      );
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const rel = path.relative(workspacePath, absolutePath);
      if (!rel || rel.startsWith("..")) {
        continue;
      }
      const normalizedRel = normalizeRelativePath(rel);
      const ignorePath = entry.isDirectory()
        ? `${normalizedRel}/`
        : normalizedRel;
      if (ig.ignores(ignorePath)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  return files;
}

// Exponential backoff settings for lazy sync
const INITIAL_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30000;
const MAX_RETRY_ATTEMPTS = 5;

class LocalCloudSyncSession {
  private readonly localPath: string;
  private readonly cloudTaskRunId: Id<"taskRuns">;
  private readonly pending = new Map<string, PendingChange>();
  private readonly ignoreMatcher: Ignore;
  private watcher: FSWatcher | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private syncing = false;
  private needsFlush = false;
  private disposed = false;
  private instance: VSCodeInstance | null = null;
  private initialSyncQueued = false;
  private lastSyncTime: number | null = null;
  private lastSyncFileCount = 0;
  private lastSyncError: string | null = null;
  // Track files recently written by cloud sync to avoid echo loops (timing-based)
  private recentlySyncedFromCloud = new Set<string>();
  // Content-based echo prevention: track hash of last synced content per file
  private lastSyncedHashes = new Map<string, string>();
  // Lazy sync: track retry attempts for exponential backoff
  private retryAttempts = 0;
  private waitingForWorker = false;
  private readonly onWorkerConnected = () => {
    // Reset retry state when worker connects
    this.retryAttempts = 0;
    this.waitingForWorker = false;
    this.scheduleFlush(250);
  };
  private readonly onWorkerDisconnected = () => {
    this.scheduleFlush(2000);
  };

  constructor({
    localPath,
    cloudTaskRunId,
    ignoreMatcher,
  }: {
    localPath: string;
    cloudTaskRunId: Id<"taskRuns">;
    ignoreMatcher: Ignore;
  }) {
    this.localPath = localPath;
    this.cloudTaskRunId = cloudTaskRunId;
    this.ignoreMatcher = ignoreMatcher;
  }

  async start(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const ignoredFn = (p: string): boolean => {
      const rel = path.relative(this.localPath, p);
      if (rel.startsWith("..")) return true;
      if (rel === "") return false;
      const normalizedRel = normalizeRelativePath(rel);
      return this.ignoreMatcher.ignores(normalizedRel);
    };

    this.watcher = chokidar.watch(this.localPath, {
      ignored: ignoredFn,
      persistent: true,
      ignoreInitial: true,
      depth: 8,
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100,
      },
      followSymlinks: false,
      atomic: false,
    });

    this.watcher.on("error", (error) => {
      console.error("[localCloudSync] File watcher error", error);
      serverLogger.error("[localCloudSync] File watcher error", error);
    });

    this.watcher.on("add", (filePath) => {
      this.recordChange(filePath, "write");
    });

    this.watcher.on("change", (filePath) => {
      this.recordChange(filePath, "write");
    });

    this.watcher.on("unlink", (filePath) => {
      this.recordChange(filePath, "delete");
    });

    this.watcher.on("unlinkDir", (dirPath) => {
      this.recordChange(dirPath, "delete");
    });

    await this.queueInitialSync();
  }

  stop(): void {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.detachInstance();
    this.pending.clear();
  }

  getStatus(): {
    localPath: string;
    cloudTaskRunId: string;
    pendingCount: number;
    syncing: boolean;
    lastSyncTime: number | null;
    lastSyncFileCount: number;
    lastSyncError: string | null;
    workerConnected: boolean;
  } {
    return {
      localPath: this.localPath,
      cloudTaskRunId: this.cloudTaskRunId,
      pendingCount: this.pending.size,
      syncing: this.syncing,
      lastSyncTime: this.lastSyncTime,
      lastSyncFileCount: this.lastSyncFileCount,
      lastSyncError: this.lastSyncError,
      workerConnected: this.instance?.isWorkerConnected() ?? false,
    };
  }

  async triggerFullSync(): Promise<{ filesQueued: number; error?: string }> {
    if (this.disposed) {
      return { filesQueued: 0, error: "Session disposed" };
    }

    // Clear any pending changes
    this.pending.clear();

    try {
      const files = await collectWorkspaceFiles(
        this.localPath,
        this.ignoreMatcher
      );
      for (const absolutePath of files) {
        const rel = path.relative(this.localPath, absolutePath);
        if (!rel || rel.startsWith("..")) {
          continue;
        }
        const normalizedRel = normalizeRelativePath(rel);
        this.pending.set(normalizedRel, {
          action: "write",
          absolutePath,
          relativePath: normalizedRel,
        });
      }

      const filesQueued = this.pending.size;
      serverLogger.info(
        `[localCloudSync] Manual sync triggered: ${filesQueued} files queued for ${this.localPath} -> ${this.cloudTaskRunId}`
      );
      console.log(
        `[localCloudSync] Manual sync triggered: ${filesQueued} files queued`
      );

      // Immediately flush
      this.scheduleFlush(0);

      return { filesQueued };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[localCloudSync] Failed to trigger full sync", error);
      serverLogger.error("[localCloudSync] Failed to trigger full sync", error);
      return { filesQueued: 0, error: errorMsg };
    }
  }

  /**
   * Notify session that a VSCodeInstance is now available for its cloud task run.
   * Called by LocalCloudSyncManager when a new instance is registered.
   */
  notifyInstanceAvailable(instance: VSCodeInstance): void {
    if (this.disposed) {
      return;
    }
    console.log(
      `[localCloudSync] Instance became available for ${this.cloudTaskRunId}, attaching and flushing`
    );
    this.attachInstance(instance);
    // Reset retry state and trigger flush
    this.retryAttempts = 0;
    this.waitingForWorker = false;
    if (this.pending.size > 0) {
      this.scheduleFlush(100);
    }
  }

  getCloudTaskRunId(): Id<"taskRuns"> {
    return this.cloudTaskRunId;
  }

  /**
   * Mark a file as recently synced from cloud, so we don't echo it back.
   * Uses both timing-based and content-hash based detection.
   */
  markSyncedFromCloud(relativePath: string, contentHash?: string): void {
    const normalized = normalizeRelativePath(relativePath);
    // Timing-based: mark for 3 seconds
    this.recentlySyncedFromCloud.add(normalized);
    setTimeout(() => {
      this.recentlySyncedFromCloud.delete(normalized);
    }, 3000);
    // Content-based: store hash if provided
    if (contentHash) {
      this.lastSyncedHashes.set(normalized, contentHash);
    }
  }

  /**
   * Clear hash tracking for a deleted file.
   */
  clearSyncedHash(relativePath: string): void {
    const normalized = normalizeRelativePath(relativePath);
    this.lastSyncedHashes.delete(normalized);
  }

  private recordChange(filePath: string, action: SyncAction): void {
    if (this.disposed) {
      return;
    }
    const rel = path.relative(this.localPath, filePath);
    if (!rel || rel.startsWith("..")) {
      return;
    }
    const normalizedRel = normalizeRelativePath(rel);

    // Skip if this change was caused by cloud->local sync (avoid echo loop)
    if (this.recentlySyncedFromCloud.has(normalizedRel)) {
      serverLogger.debug(
        `[localCloudSync] Ignoring echo for ${normalizedRel} (recently synced from cloud)`
      );
      return;
    }

    const absolutePath = path.join(this.localPath, rel);
    this.pending.set(normalizedRel, {
      action,
      absolutePath,
      relativePath: normalizedRel,
    });
    this.scheduleFlush(500);
  }

  private async queueInitialSync(): Promise<void> {
    if (this.initialSyncQueued) {
      return;
    }
    this.initialSyncQueued = true;
    try {
      const files = await collectWorkspaceFiles(
        this.localPath,
        this.ignoreMatcher
      );
      for (const absolutePath of files) {
        const rel = path.relative(this.localPath, absolutePath);
        if (!rel || rel.startsWith("..")) {
          continue;
        }
        const normalizedRel = normalizeRelativePath(rel);
        this.pending.set(normalizedRel, {
          action: "write",
          absolutePath,
          relativePath: normalizedRel,
        });
      }
      this.scheduleFlush(0);
    } catch (error) {
      console.error("[localCloudSync] Failed to queue initial sync", error);
      serverLogger.error("[localCloudSync] Failed to queue initial sync", error);
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer || this.disposed) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delayMs);
  }

  private async flush(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.syncing) {
      this.needsFlush = true;
      return;
    }
    if (this.pending.size === 0) {
      return;
    }

    this.syncing = true;
    this.needsFlush = false;
    this.lastSyncError = null;

    const workerSocket = this.getWorkerSocket();
    if (!workerSocket) {
      this.syncing = false;
      this.lastSyncError = "Worker socket not connected";

      // Lazy sync: use exponential backoff, then stop retrying and wait for worker
      if (this.retryAttempts < MAX_RETRY_ATTEMPTS) {
        const delay = Math.min(
          INITIAL_RETRY_DELAY_MS * Math.pow(2, this.retryAttempts),
          MAX_RETRY_DELAY_MS
        );
        this.retryAttempts++;
        console.log(
          `[localCloudSync] No worker socket for ${this.cloudTaskRunId}, retry ${this.retryAttempts}/${MAX_RETRY_ATTEMPTS} in ${delay}ms`
        );
        this.scheduleFlush(delay);
      } else if (!this.waitingForWorker) {
        // Max retries reached - stop retrying, wait for worker to connect
        this.waitingForWorker = true;
        console.log(
          `[localCloudSync] Max retries reached for ${this.cloudTaskRunId}, waiting for worker connection (${this.pending.size} files pending)`
        );
        serverLogger.info(
          `[localCloudSync] Entering lazy sync mode for ${this.cloudTaskRunId} - will flush when worker connects`
        );
      }
      return;
    }

    // Worker connected - reset retry state
    this.retryAttempts = 0;
    this.waitingForWorker = false;

    const entries = Array.from(this.pending.values());
    this.pending.clear();

    console.log(
      `[localCloudSync] Syncing ${entries.length} files to ${this.cloudTaskRunId}`
    );

    try {
      await this.applyChanges(workerSocket, entries);
      this.lastSyncTime = Date.now();
      this.lastSyncFileCount = entries.length;
      console.log(
        `[localCloudSync] Successfully synced ${entries.length} files`
      );
      serverLogger.info(
        `[localCloudSync] Synced ${entries.length} files to ${this.cloudTaskRunId}`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.lastSyncError = errorMsg;
      console.error("[localCloudSync] Failed to sync changes", error);
      serverLogger.error("[localCloudSync] Failed to sync changes", error);
      for (const entry of entries) {
        this.pending.set(entry.relativePath, entry);
      }
      this.scheduleFlush(2000);
    } finally {
      this.syncing = false;
      if (this.needsFlush && this.pending.size > 0) {
        this.scheduleFlush(250);
      }
    }
  }

  private getWorkerSocket(): WorkerSocket | null {
    if (!this.instance) {
      const instance = VSCodeInstance.getInstance(this.cloudTaskRunId);
      if (instance) {
        this.attachInstance(instance);
      }
    }

    if (!this.instance || !this.instance.isWorkerConnected()) {
      return null;
    }

    try {
      return this.instance.getWorkerSocket();
    } catch (error) {
      console.error("[localCloudSync] Failed to access worker socket", error);
      return null;
    }
  }

  private attachInstance(instance: VSCodeInstance): void {
    if (this.instance === instance) {
      return;
    }
    this.detachInstance();
    this.instance = instance;
    instance.on("worker-connected", this.onWorkerConnected);
    instance.on("worker-disconnected", this.onWorkerDisconnected);
  }

  private detachInstance(): void {
    if (!this.instance) {
      return;
    }
    this.instance.off("worker-connected", this.onWorkerConnected);
    this.instance.off("worker-disconnected", this.onWorkerDisconnected);
    this.instance = null;
  }

  private async applyChanges(
    workerSocket: WorkerSocket,
    entries: PendingChange[]
  ): Promise<void> {
    let batch: WorkerUploadFiles["files"] = [];
    let batchBytes = 0;

    const flushBatch = async (): Promise<void> => {
      if (batch.length === 0) {
        return;
      }
      const payload: WorkerUploadFiles = {
        files: batch,
      };
      await workerUploadFiles({ workerSocket, payload });
      batch = [];
      batchBytes = 0;
    };

    for (const entry of entries) {
      const action = entry.action;
      if (action === "delete") {
        const payload: WorkerUploadFiles["files"][number] = {
          destinationPath: entry.relativePath,
          action: "delete",
        };
        batch.push(payload);
        if (batch.length >= MAX_BATCH_FILES) {
          await flushBatch();
        }
        continue;
      }

      let stats;
      try {
        stats = await fs.lstat(entry.absolutePath);
      } catch (error) {
        console.error(
          `[localCloudSync] Failed to stat ${entry.absolutePath}`,
          error
        );
        const payload: WorkerUploadFiles["files"][number] = {
          destinationPath: entry.relativePath,
          action: "delete",
        };
        batch.push(payload);
        if (batch.length >= MAX_BATCH_FILES) {
          await flushBatch();
        }
        continue;
      }

      if (stats.isSymbolicLink() || !stats.isFile()) {
        continue;
      }

      if (stats.size > MAX_SINGLE_FILE_BYTES) {
        console.error(
          `[localCloudSync] Skipping large file (${stats.size} bytes): ${entry.absolutePath}`
        );
        continue;
      }

      let content: Buffer;
      try {
        content = await fs.readFile(entry.absolutePath);
      } catch (readError) {
        // File may have been deleted or become unreadable between lstat and readFile
        console.error(
          `[localCloudSync] Failed to read file ${entry.absolutePath}, treating as delete`,
          readError
        );
        batch.push({
          destinationPath: entry.relativePath,
          action: "delete",
        });
        this.lastSyncedHashes.delete(entry.relativePath);
        if (batch.length >= MAX_BATCH_FILES) {
          await flushBatch();
        }
        continue;
      }

      // Content-based echo prevention: skip if content hash matches what we received from cloud
      const contentHash = computeContentHash(content);
      const lastHash = this.lastSyncedHashes.get(entry.relativePath);
      if (lastHash === contentHash) {
        serverLogger.debug(
          `[localCloudSync] Skipping ${entry.relativePath} - content unchanged (hash: ${contentHash.slice(0, 8)})`
        );
        continue;
      }

      const estimatedSize = stats.size;
      if (
        batch.length > 0 &&
        (batch.length >= MAX_BATCH_FILES ||
          batchBytes + estimatedSize > MAX_BATCH_BYTES)
      ) {
        await flushBatch();
      }

      batch.push({
        sourcePath: entry.absolutePath,
        destinationPath: entry.relativePath,
        action: "write",
        contentBase64: content.toString("base64"),
        mode: (stats.mode & 0o777).toString(8),
      });
      batchBytes += estimatedSize;

      // Update the hash to track what we're sending
      this.lastSyncedHashes.set(entry.relativePath, contentHash);
    }

    await flushBatch();
  }
}

export class LocalCloudSyncManager {
  private sessions = new Map<string, LocalCloudSyncSession>();
  // Reverse lookup: cloudTaskRunId -> localPath
  private cloudToLocalMap = new Map<string, string>();

  async startSync({
    localWorkspacePath,
    cloudTaskRunId,
  }: {
    localWorkspacePath: string;
    cloudTaskRunId: Id<"taskRuns">;
  }): Promise<void> {
    const resolvedPath = path.resolve(localWorkspacePath);
    if (this.sessions.has(resolvedPath)) {
      return;
    }

    let ignoreMatcher: Ignore;
    try {
      ignoreMatcher = await buildIgnoreMatcher(resolvedPath);
    } catch (error) {
      console.error(
        "[localCloudSync] Failed to initialize ignore matcher",
        error
      );
      ignoreMatcher = ignore();
      ignoreMatcher.add(DEFAULT_IGNORES);
    }

    const session = new LocalCloudSyncSession({
      localPath: resolvedPath,
      cloudTaskRunId,
      ignoreMatcher,
    });
    this.sessions.set(resolvedPath, session);
    this.cloudToLocalMap.set(cloudTaskRunId, resolvedPath);

    try {
      await session.start();
      serverLogger.info(
        `[localCloudSync] Started sync from ${resolvedPath} -> ${cloudTaskRunId}`
      );
    } catch (error) {
      console.error("[localCloudSync] Failed to start sync", error);
      serverLogger.error("[localCloudSync] Failed to start sync", error);
      session.stop();
      this.sessions.delete(resolvedPath);
      this.cloudToLocalMap.delete(cloudTaskRunId);
    }
  }

  stopSync(localWorkspacePath: string): void {
    const resolvedPath = path.resolve(localWorkspacePath);
    const session = this.sessions.get(resolvedPath);
    if (session) {
      const cloudId = session.getStatus().cloudTaskRunId;
      session.stop();
      this.sessions.delete(resolvedPath);
      this.cloudToLocalMap.delete(cloudId);
      serverLogger.info(`[localCloudSync] Stopped sync for ${resolvedPath}`);
    }
  }

  async triggerSync(
    localWorkspacePath: string
  ): Promise<{ success: boolean; filesQueued?: number; error?: string }> {
    const resolvedPath = path.resolve(localWorkspacePath);
    const session = this.sessions.get(resolvedPath);

    if (!session) {
      return {
        success: false,
        error: `No sync session found for ${resolvedPath}`,
      };
    }

    const result = await session.triggerFullSync();
    if (result.error) {
      return { success: false, error: result.error };
    }

    return { success: true, filesQueued: result.filesQueued };
  }

  getStatus(localWorkspacePath: string): {
    found: boolean;
    status?: ReturnType<LocalCloudSyncSession["getStatus"]>;
  } {
    const resolvedPath = path.resolve(localWorkspacePath);
    const session = this.sessions.get(resolvedPath);

    if (!session) {
      return { found: false };
    }

    return { found: true, status: session.getStatus() };
  }

  getAllSessions(): Array<{
    localPath: string;
    cloudTaskRunId: string;
    status: ReturnType<LocalCloudSyncSession["getStatus"]>;
  }> {
    return Array.from(this.sessions.entries()).map(([localPath, session]) => ({
      localPath,
      cloudTaskRunId: session.getStatus().cloudTaskRunId,
      status: session.getStatus(),
    }));
  }

  /**
   * Notify sync sessions that a VSCodeInstance has become available.
   * Called when a new VSCodeInstance is created or reconnected.
   */
  notifyInstanceAvailable(
    cloudTaskRunId: Id<"taskRuns">,
    instance: VSCodeInstance
  ): void {
    const localPath = this.cloudToLocalMap.get(cloudTaskRunId);
    if (!localPath) {
      return;
    }
    const session = this.sessions.get(localPath);
    if (session) {
      session.notifyInstanceAvailable(instance);
    }
  }

  /**
   * Handle incoming file sync from cloud worker.
   * Writes files from the cloud workspace to the local workspace.
   */
  async handleCloudSync(data: WorkerSyncFiles): Promise<void> {
    const { taskRunId, files, timestamp } = data;

    // Find the local path for this cloud task run
    const localPath = this.cloudToLocalMap.get(taskRunId);
    if (!localPath) {
      serverLogger.warn(
        `[localCloudSync] No local workspace found for cloud taskRun ${taskRunId}`
      );
      return;
    }

    // Get the session so we can mark files as synced from cloud
    const session = this.sessions.get(localPath);

    serverLogger.info(
      `[localCloudSync] Receiving ${files.length} files from cloud ${taskRunId} -> ${localPath}`
    );

    for (const file of files) {
      const absolutePath = path.join(localPath, file.relativePath);

      // Security: ensure path is within workspace
      const resolvedPath = path.resolve(absolutePath);
      if (!resolvedPath.startsWith(localPath)) {
        serverLogger.warn(
          `[localCloudSync] Path traversal attempt blocked: ${file.relativePath}`
        );
        continue;
      }

      try {
        if (file.action === "delete") {
          // Clear hash tracking for deleted files
          if (session) {
            session.markSyncedFromCloud(file.relativePath);
            session.clearSyncedHash(file.relativePath);
          }

          try {
            await fs.unlink(absolutePath);
            serverLogger.debug(
              `[localCloudSync] Deleted ${file.relativePath}`
            );
          } catch (error) {
            // File may already be deleted
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
        } else if (file.action === "write" && file.contentBase64) {
          // Compute content hash BEFORE writing
          const content = Buffer.from(file.contentBase64, "base64");
          const contentHash = computeContentHash(content);

          // Mark with both timing and hash BEFORE writing
          // This prevents the file watcher from echoing it back
          if (session) {
            session.markSyncedFromCloud(file.relativePath, contentHash);
          }

          // Ensure directory exists
          const dir = path.dirname(absolutePath);
          await fs.mkdir(dir, { recursive: true });

          // Write file
          await fs.writeFile(absolutePath, content);

          // Set file mode if provided
          if (file.mode) {
            const mode = parseInt(file.mode, 8);
            await fs.chmod(absolutePath, mode);
          }

          serverLogger.debug(
            `[localCloudSync] Wrote ${file.relativePath} (${content.length} bytes, hash: ${contentHash.slice(0, 8)})`
          );
        }
      } catch (error) {
        serverLogger.error(
          `[localCloudSync] Failed to sync file ${file.relativePath}:`,
          error
        );
      }
    }

    serverLogger.info(
      `[localCloudSync] Cloud sync complete: ${files.length} files from ${taskRunId} at ${new Date(timestamp).toISOString()}`
    );
  }
}

// Singleton instance - exported to avoid circular dependency issues
export const localCloudSyncManager = new LocalCloudSyncManager();

// Register callback for lazy sync: when a VSCodeInstance connects,
// notify any waiting sync sessions
VSCodeInstance.setOnInstanceConnected((taskRunId, instance) => {
  localCloudSyncManager.notifyInstanceAvailable(taskRunId, instance);
});
