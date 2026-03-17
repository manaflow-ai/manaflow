/**
 * Cloud-to-Local Sync: Watches files in the cloud workspace and syncs changes back to local.
 * This is the mirror of localCloudSync.ts on the server side.
 */

import type { Id } from "@cmux/convex/dataModel";
import type { WorkerSyncFile } from "@cmux/shared";
import chokidar, { type FSWatcher } from "chokidar";
import { createHash } from "node:crypto";
import ignore, { type Ignore } from "ignore";
import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Compute a fast content hash for change detection.
 * Using MD5 for speed - this is for change detection, not security.
 */
function computeContentHash(content: Buffer): string {
  return createHash("md5").update(content).digest("hex");
}

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
  } catch {
    // .gitignore may not exist
  }
  ig.add(DEFAULT_IGNORES);
  return ig;
}

export type SyncFilesEmitter = (data: {
  taskRunId: Id<"taskRuns">;
  files: WorkerSyncFile[];
  timestamp: number;
}) => void;

export class CloudToLocalSyncSession {
  private readonly workspacePath: string;
  private readonly taskRunId: Id<"taskRuns">;
  private readonly pending = new Map<string, PendingChange>();
  private readonly ignoreMatcher: Ignore;
  private readonly emitSyncFiles: SyncFilesEmitter;
  private watcher: FSWatcher | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private syncing = false;
  private disposed = false;
  // Track files recently written by local->cloud sync to avoid echo loops (timing-based)
  private recentlySyncedFromLocal = new Set<string>();
  // Content-based echo prevention: track hash of last synced content per file
  private lastSyncedHashes = new Map<string, string>();

  constructor({
    workspacePath,
    taskRunId,
    ignoreMatcher,
    emitSyncFiles,
  }: {
    workspacePath: string;
    taskRunId: Id<"taskRuns">;
    ignoreMatcher: Ignore;
    emitSyncFiles: SyncFilesEmitter;
  }) {
    this.workspacePath = workspacePath;
    this.taskRunId = taskRunId;
    this.ignoreMatcher = ignoreMatcher;
    this.emitSyncFiles = emitSyncFiles;
  }

  async start(): Promise<void> {
    if (this.disposed) {
      return;
    }

    console.log(
      `[CloudToLocalSync] Starting sync for taskRun ${this.taskRunId} at ${this.workspacePath}`
    );

    this.watcher = chokidar.watch(this.workspacePath, {
      ignored: (filePath: string) => {
        const rel = path.relative(this.workspacePath, filePath);
        if (!rel || rel.startsWith("..")) {
          return false;
        }
        const normalizedRel = normalizeRelativePath(rel);
        return this.ignoreMatcher.ignores(normalizedRel);
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on("add", (filePath) => this.recordChange(filePath, "write"));
    this.watcher.on("change", (filePath) =>
      this.recordChange(filePath, "write")
    );
    this.watcher.on("unlink", (filePath) =>
      this.recordChange(filePath, "delete")
    );
    this.watcher.on("error", (error) => {
      console.error("[CloudToLocalSync] Watcher error:", error);
    });
  }

  /**
   * Mark a file as recently synced from local, so we don't echo it back.
   * Uses both timing-based and content-hash based detection.
   * Call this BEFORE writing files received from local sync.
   */
  markSyncedFromLocal(relativePath: string, contentHash?: string): void {
    const normalized = normalizeRelativePath(relativePath);
    // Timing-based: mark for 3 seconds
    this.recentlySyncedFromLocal.add(normalized);
    setTimeout(() => {
      this.recentlySyncedFromLocal.delete(normalized);
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

  private recordChange(absolutePath: string, action: SyncAction): void {
    if (this.disposed) {
      return;
    }

    const rel = path.relative(this.workspacePath, absolutePath);
    if (!rel || rel.startsWith("..")) {
      return;
    }

    const relativePath = normalizeRelativePath(rel);

    // Check ignore patterns
    if (this.ignoreMatcher.ignores(relativePath)) {
      return;
    }

    // Skip if this change was caused by local->cloud sync (avoid echo loop)
    if (this.recentlySyncedFromLocal.has(relativePath)) {
      console.log(
        `[CloudToLocalSync] Ignoring echo for ${relativePath} (recently synced from local)`
      );
      return;
    }

    this.pending.set(relativePath, {
      action,
      absolutePath,
      relativePath,
    });

    this.scheduleFlush(500);
  }

  private scheduleFlush(delay: number): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.disposed || this.syncing || this.pending.size === 0) {
      return;
    }

    this.syncing = true;
    const entries = Array.from(this.pending.values());
    this.pending.clear();

    try {
      const files: WorkerSyncFile[] = [];
      let batchBytes = 0;

      for (const entry of entries) {
        if (files.length >= MAX_BATCH_FILES || batchBytes >= MAX_BATCH_BYTES) {
          // Send current batch
          this.emitSyncFiles({
            taskRunId: this.taskRunId,
            files: [...files],
            timestamp: Date.now(),
          });
          files.length = 0;
          batchBytes = 0;
        }

        if (entry.action === "delete") {
          files.push({
            relativePath: entry.relativePath,
            action: "delete",
          });
          this.lastSyncedHashes.delete(entry.relativePath);
          continue;
        }

        // Read file content for write action
        try {
          const stat = await fs.stat(entry.absolutePath);
          if (!stat.isFile()) {
            continue;
          }
          if (stat.size > MAX_SINGLE_FILE_BYTES) {
            console.log(
              `[CloudToLocalSync] Skipping large file: ${entry.relativePath} (${stat.size} bytes)`
            );
            continue;
          }

          const content = await fs.readFile(entry.absolutePath);

          // Content-based echo prevention: skip if content hash matches what we received from local
          const contentHash = computeContentHash(content);
          const lastHash = this.lastSyncedHashes.get(entry.relativePath);
          if (lastHash === contentHash) {
            console.log(
              `[CloudToLocalSync] Skipping ${entry.relativePath} - content unchanged (hash: ${contentHash.slice(0, 8)})`
            );
            continue;
          }

          const contentBase64 = content.toString("base64");
          const mode = (stat.mode & 0o777).toString(8);

          files.push({
            relativePath: entry.relativePath,
            action: "write",
            contentBase64,
            mode,
          });
          batchBytes += content.length;

          // Update the hash to track what we're sending
          this.lastSyncedHashes.set(entry.relativePath, contentHash);
        } catch (error) {
          // File may have been deleted between detection and read
          console.error(
            `[CloudToLocalSync] Failed to read file ${entry.relativePath}:`,
            error
          );
        }
      }

      // Send remaining files
      if (files.length > 0) {
        this.emitSyncFiles({
          taskRunId: this.taskRunId,
          files,
          timestamp: Date.now(),
        });
      }

      console.log(
        `[CloudToLocalSync] Synced ${entries.length} files for taskRun ${this.taskRunId}`
      );
    } catch (error) {
      console.error("[CloudToLocalSync] Flush error:", error);
      // Re-queue failed entries
      for (const entry of entries) {
        if (!this.pending.has(entry.relativePath)) {
          this.pending.set(entry.relativePath, entry);
        }
      }
      this.scheduleFlush(2000);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Trigger a full sync of all existing files in the workspace.
   * This is used when a local workspace is first created to sync existing cloud changes.
   */
  async triggerFullSync(): Promise<{ filesSent: number }> {
    if (this.disposed) {
      return { filesSent: 0 };
    }

    console.log(
      `[CloudToLocalSync] Triggering full sync for taskRun ${this.taskRunId}`
    );

    const files: WorkerSyncFile[] = [];
    let batchBytes = 0;
    let totalFilesSent = 0;

    const sendBatch = () => {
      if (files.length > 0) {
        this.emitSyncFiles({
          taskRunId: this.taskRunId,
          files: [...files],
          timestamp: Date.now(),
        });
        totalFilesSent += files.length;
        files.length = 0;
        batchBytes = 0;
      }
    };

    // Recursively collect all files
    const collectFiles = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);
        const rel = path.relative(this.workspacePath, absolutePath);
        if (!rel || rel.startsWith("..")) {
          continue;
        }

        const relativePath = normalizeRelativePath(rel);

        // Check ignore patterns
        const ignorePath = entry.isDirectory()
          ? `${relativePath}/`
          : relativePath;
        if (this.ignoreMatcher.ignores(ignorePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await collectFiles(absolutePath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        // Check batch limits
        if (files.length >= MAX_BATCH_FILES || batchBytes >= MAX_BATCH_BYTES) {
          sendBatch();
        }

        try {
          const stat = await fs.stat(absolutePath);
          if (stat.size > MAX_SINGLE_FILE_BYTES) {
            console.log(
              `[CloudToLocalSync] Skipping large file: ${relativePath} (${stat.size} bytes)`
            );
            continue;
          }

          const content = await fs.readFile(absolutePath);
          const contentBase64 = content.toString("base64");
          const mode = (stat.mode & 0o777).toString(8);

          files.push({
            relativePath,
            action: "write",
            contentBase64,
            mode,
          });
          batchBytes += content.length;
        } catch (error) {
          console.error(
            `[CloudToLocalSync] Failed to read file ${relativePath}:`,
            error
          );
        }
      }
    };

    await collectFiles(this.workspacePath);
    sendBatch(); // Send remaining files

    console.log(
      `[CloudToLocalSync] Full sync completed: sent ${totalFilesSent} files for taskRun ${this.taskRunId}`
    );

    return { filesSent: totalFilesSent };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    console.log(
      `[CloudToLocalSync] Disposed sync session for taskRun ${this.taskRunId}`
    );
  }
}

// Manager for multiple sync sessions
export class CloudToLocalSyncManager {
  private readonly sessions = new Map<string, CloudToLocalSyncSession>();
  private readonly emitSyncFiles: SyncFilesEmitter;

  constructor(emitSyncFiles: SyncFilesEmitter) {
    this.emitSyncFiles = emitSyncFiles;
  }

  async startSync({
    taskRunId,
    workspacePath,
  }: {
    taskRunId: Id<"taskRuns">;
    workspacePath: string;
  }): Promise<void> {
    const key = taskRunId;

    // Check if session already exists
    if (this.sessions.has(key)) {
      console.log(
        `[CloudToLocalSync] Session already exists for taskRun ${taskRunId}`
      );
      return;
    }

    const ignoreMatcher = await buildIgnoreMatcher(workspacePath);
    const session = new CloudToLocalSyncSession({
      workspacePath,
      taskRunId,
      ignoreMatcher,
      emitSyncFiles: this.emitSyncFiles,
    });

    this.sessions.set(key, session);
    await session.start();

    console.log(
      `[CloudToLocalSync] Started sync session for taskRun ${taskRunId}`
    );
  }

  async stopSync(taskRunId: Id<"taskRuns">): Promise<void> {
    const key = taskRunId;
    const session = this.sessions.get(key);
    if (session) {
      await session.dispose();
      this.sessions.delete(key);
      console.log(
        `[CloudToLocalSync] Stopped sync session for taskRun ${taskRunId}`
      );
    }
  }

  /**
   * Mark files as recently synced from local to prevent echo loops.
   * Call this BEFORE writing files received from local sync.
   */
  markSyncedFromLocal(
    taskRunId: Id<"taskRuns">,
    relativePaths: string[]
  ): void {
    const session = this.sessions.get(taskRunId);
    if (session) {
      for (const relativePath of relativePaths) {
        session.markSyncedFromLocal(relativePath);
      }
    }
  }

  /**
   * Mark files in ALL active sessions as synced from local.
   * Use when taskRunId is not known (e.g., in upload-files handler).
   */
  markSyncedFromLocalAllSessions(relativePaths: string[]): void {
    for (const session of this.sessions.values()) {
      for (const relativePath of relativePaths) {
        session.markSyncedFromLocal(relativePath);
      }
    }
  }

  /**
   * Mark files with their content hashes in ALL active sessions.
   * Use when taskRunId is not known (e.g., in upload-files handler).
   * This provides content-based echo prevention alongside timing-based.
   */
  markSyncedFromLocalWithHashes(
    files: Array<{ relativePath: string; contentHash: string }>
  ): void {
    for (const session of this.sessions.values()) {
      for (const file of files) {
        session.markSyncedFromLocal(file.relativePath, file.contentHash);
      }
    }
  }

  /**
   * Clear hash tracking for deleted files in ALL active sessions.
   */
  clearSyncedHashesAllSessions(relativePaths: string[]): void {
    for (const session of this.sessions.values()) {
      for (const relativePath of relativePaths) {
        session.clearSyncedHash(relativePath);
      }
    }
  }

  /**
   * Trigger a full sync of all existing files for a given taskRun.
   * Used when a local workspace is first created to download existing cloud changes.
   */
  async triggerFullSync(taskRunId: Id<"taskRuns">): Promise<{ filesSent: number }> {
    const session = this.sessions.get(taskRunId);
    if (!session) {
      console.log(
        `[CloudToLocalSync] No session found for taskRun ${taskRunId} to trigger full sync`
      );
      return { filesSent: 0 };
    }
    return session.triggerFullSync();
  }

  async disposeAll(): Promise<void> {
    const disposals = Array.from(this.sessions.values()).map((session) =>
      session.dispose()
    );
    await Promise.all(disposals);
    this.sessions.clear();
  }
}
