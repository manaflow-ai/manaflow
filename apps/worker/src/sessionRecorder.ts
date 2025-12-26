import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { log } from "./logger";

const LOG_PREFIX = "[SessionRecorder]";

export interface SessionRecordingConfig {
  taskRunId: string;
  taskRunToken: string;
  convexUrl: string;
  display?: string; // X11 display, defaults to :99
  outputDir?: string; // temp directory for recording files
  frameRate?: number; // fps, defaults to 10
  videoWidth?: number; // defaults to 1920
  videoHeight?: number; // defaults to 1080
}

export interface RecordingStartResult {
  recordingId: string;
  videoUploadUrl?: string;
  videoR2Key?: string;
  trajectoryUploadUrl?: string;
  trajectoryR2Key?: string;
}

interface TrajectoryEntry {
  timestamp: number;
  type: string;
  data: unknown;
}

export class SessionRecorder {
  private config: Required<Omit<SessionRecordingConfig, "taskRunToken" | "convexUrl">> & {
    taskRunToken: string;
    convexUrl: string;
  };
  private ffmpegProcess: ChildProcess | null = null;
  private recordingId: string | null = null;
  private videoUploadUrl: string | null = null;
  private trajectoryUploadUrl: string | null = null;
  private videoFilePath: string | null = null;
  private trajectoryFilePath: string | null = null;
  private trajectoryStream: fs.FileHandle | null = null;
  private trajectoryMessageCount = 0;
  private recordingStartTime: number | null = null;
  private isRecording = false;

  constructor(config: SessionRecordingConfig) {
    this.config = {
      taskRunId: config.taskRunId,
      taskRunToken: config.taskRunToken,
      convexUrl: config.convexUrl,
      display: config.display ?? ":99",
      outputDir: config.outputDir ?? "/tmp/cmux-recordings",
      frameRate: config.frameRate ?? 10,
      videoWidth: config.videoWidth ?? 1920,
      videoHeight: config.videoHeight ?? 1080,
    };
  }

  /**
   * Start a new recording session.
   * Calls the Convex API to get presigned upload URLs, then starts ffmpeg.
   */
  async start(): Promise<RecordingStartResult | null> {
    if (this.isRecording) {
      log("WARN", `${LOG_PREFIX} Recording already in progress for task ${this.config.taskRunId}`);
      return null;
    }

    try {
      // 1. Call Convex API to start recording and get upload URLs
      const startResult = await this.callStartRecording();
      if (!startResult) {
        log("ERROR", `${LOG_PREFIX} Failed to start recording via API`);
        return null;
      }

      this.recordingId = startResult.recordingId;
      this.videoUploadUrl = startResult.videoUploadUrl ?? null;
      this.trajectoryUploadUrl = startResult.trajectoryUploadUrl ?? null;

      // 2. Prepare output directory
      await fs.mkdir(this.config.outputDir, { recursive: true });
      
      const timestamp = Date.now();
      this.videoFilePath = path.join(this.config.outputDir, `${this.config.taskRunId}-${timestamp}.mp4`);
      this.trajectoryFilePath = path.join(this.config.outputDir, `${this.config.taskRunId}-${timestamp}.jsonl`);

      // 3. Start trajectory file
      this.trajectoryStream = await fs.open(this.trajectoryFilePath, "w");
      this.trajectoryMessageCount = 0;

      // 4. Start ffmpeg recording
      await this.startFfmpeg();

      this.isRecording = true;
      this.recordingStartTime = Date.now();

      log("INFO", `${LOG_PREFIX} Recording started`, {
        taskRunId: this.config.taskRunId,
        recordingId: this.recordingId,
        videoPath: this.videoFilePath,
        trajectoryPath: this.trajectoryFilePath,
      });

      return startResult;
    } catch (error) {
      log("ERROR", `${LOG_PREFIX} Failed to start recording`, error);
      await this.cleanup();
      return null;
    }
  }

  /**
   * Log a trajectory entry (agent action, user input, etc.)
   */
  async logTrajectory(type: string, data: unknown): Promise<void> {
    if (!this.trajectoryStream) {
      return;
    }

    const entry: TrajectoryEntry = {
      timestamp: Date.now(),
      type,
      data,
    };

    try {
      await this.trajectoryStream.write(JSON.stringify(entry) + "\n");
      this.trajectoryMessageCount++;
    } catch (error) {
      log("ERROR", `${LOG_PREFIX} Failed to write trajectory entry`, error);
    }
  }

  /**
   * Stop recording, upload files to R2, and complete the recording.
   */
  async stop(): Promise<void> {
    if (!this.isRecording) {
      log("WARN", `${LOG_PREFIX} No recording in progress to stop`);
      return;
    }

    log("INFO", `${LOG_PREFIX} Stopping recording for task ${this.config.taskRunId}`);

    try {
      // 1. Stop ffmpeg gracefully
      await this.stopFfmpeg();

      // 2. Close trajectory file
      if (this.trajectoryStream) {
        await this.trajectoryStream.close();
        this.trajectoryStream = null;
      }

      // 3. Upload files to R2
      const videoStats = await this.uploadVideo();
      const trajectoryStats = await this.uploadTrajectory();

      // 4. Call complete endpoint
      if (this.recordingId) {
        await this.callCompleteRecording({
          videoSizeBytes: videoStats?.size,
          videoDurationMs: this.recordingStartTime ? Date.now() - this.recordingStartTime : undefined,
          videoWidth: this.config.videoWidth,
          videoHeight: this.config.videoHeight,
          trajectorySizeBytes: trajectoryStats?.size,
          trajectoryMessageCount: this.trajectoryMessageCount,
        });
      }

      log("INFO", `${LOG_PREFIX} Recording completed successfully`, {
        taskRunId: this.config.taskRunId,
        recordingId: this.recordingId,
        videoSize: videoStats?.size,
        trajectoryMessages: this.trajectoryMessageCount,
      });
    } catch (error) {
      log("ERROR", `${LOG_PREFIX} Error stopping recording`, error);
      await this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Mark the recording as failed.
   */
  async fail(errorMessage: string): Promise<void> {
    log("ERROR", `${LOG_PREFIX} Recording failed: ${errorMessage}`, {
      taskRunId: this.config.taskRunId,
      recordingId: this.recordingId,
    });

    // Stop ffmpeg if running
    await this.stopFfmpeg();

    // Close trajectory file
    if (this.trajectoryStream) {
      await this.trajectoryStream.close();
      this.trajectoryStream = null;
    }

    // Call fail endpoint
    if (this.recordingId) {
      try {
        await this.callFailRecording(errorMessage);
      } catch (error) {
        log("ERROR", `${LOG_PREFIX} Failed to call fail endpoint`, error);
      }
    }

    await this.cleanup();
  }

  /**
   * Check if recording is currently active.
   */
  get active(): boolean {
    return this.isRecording;
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private async startFfmpeg(): Promise<void> {
    // ffmpeg command to capture X11 display
    // -f x11grab: capture X11 display
    // -framerate: capture framerate
    // -video_size: capture resolution
    // -i: input display
    // -c:v libx264: H.264 codec
    // -preset ultrafast: fast encoding (lower quality but faster)
    // -crf 28: quality (higher = smaller file, lower quality)
    // -pix_fmt yuv420p: pixel format for compatibility
    const args = [
      "-f", "x11grab",
      "-framerate", this.config.frameRate.toString(),
      "-video_size", `${this.config.videoWidth}x${this.config.videoHeight}`,
      "-i", this.config.display,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-y", // overwrite output
      this.videoFilePath!,
    ];

    log("INFO", `${LOG_PREFIX} Starting ffmpeg`, { args: args.join(" ") });

    this.ffmpegProcess = spawn("ffmpeg", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.ffmpegProcess.on("error", (error) => {
      log("ERROR", `${LOG_PREFIX} ffmpeg process error`, error);
    });

    this.ffmpegProcess.stderr?.on("data", (data: Buffer) => {
      // ffmpeg outputs progress info to stderr
      const message = data.toString().trim();
      if (message.includes("frame=") || message.includes("fps=")) {
        // Periodic progress, don't spam logs
        log("DEBUG", `${LOG_PREFIX} ffmpeg: ${message.slice(0, 100)}`);
      } else if (message.toLowerCase().includes("error")) {
        log("ERROR", `${LOG_PREFIX} ffmpeg stderr: ${message}`);
      }
    });

    this.ffmpegProcess.on("exit", (code, signal) => {
      log("INFO", `${LOG_PREFIX} ffmpeg exited`, { code, signal });
      this.ffmpegProcess = null;
    });

    // Wait a moment for ffmpeg to initialize
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (!this.ffmpegProcess || this.ffmpegProcess.killed) {
      throw new Error("ffmpeg failed to start");
    }
  }

  private async stopFfmpeg(): Promise<void> {
    if (!this.ffmpegProcess) {
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log("WARN", `${LOG_PREFIX} ffmpeg did not exit gracefully, killing`);
        this.ffmpegProcess?.kill("SIGKILL");
        resolve();
      }, 10000);

      this.ffmpegProcess!.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      // Send 'q' to stdin to gracefully stop ffmpeg
      if (this.ffmpegProcess?.stdin?.writable) {
        this.ffmpegProcess.stdin.write("q");
        this.ffmpegProcess.stdin.end();
      } else {
        // Fallback to SIGTERM
        this.ffmpegProcess?.kill("SIGTERM");
      }
    });
  }

  private async uploadVideo(): Promise<{ size: number } | null> {
    if (!this.videoFilePath || !this.videoUploadUrl) {
      log("WARN", `${LOG_PREFIX} No video file or upload URL, skipping video upload`);
      return null;
    }

    try {
      const stats = await fs.stat(this.videoFilePath);
      const fileBuffer = await fs.readFile(this.videoFilePath);

      log("INFO", `${LOG_PREFIX} Uploading video`, {
        path: this.videoFilePath,
        size: stats.size,
      });

      const response = await fetch(this.videoUploadUrl, {
        method: "PUT",
        body: fileBuffer,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": stats.size.toString(),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Video upload failed: ${response.status} ${errorText}`);
      }

      log("INFO", `${LOG_PREFIX} Video uploaded successfully`, { size: stats.size });
      return { size: stats.size };
    } catch (error) {
      log("ERROR", `${LOG_PREFIX} Video upload failed`, error);
      throw error;
    }
  }

  private async uploadTrajectory(): Promise<{ size: number } | null> {
    if (!this.trajectoryFilePath || !this.trajectoryUploadUrl) {
      log("WARN", `${LOG_PREFIX} No trajectory file or upload URL, skipping trajectory upload`);
      return null;
    }

    try {
      const stats = await fs.stat(this.trajectoryFilePath);
      const fileBuffer = await fs.readFile(this.trajectoryFilePath);

      log("INFO", `${LOG_PREFIX} Uploading trajectory`, {
        path: this.trajectoryFilePath,
        size: stats.size,
        messageCount: this.trajectoryMessageCount,
      });

      const response = await fetch(this.trajectoryUploadUrl, {
        method: "PUT",
        body: fileBuffer,
        headers: {
          "Content-Type": "application/x-ndjson",
          "Content-Length": stats.size.toString(),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Trajectory upload failed: ${response.status} ${errorText}`);
      }

      log("INFO", `${LOG_PREFIX} Trajectory uploaded successfully`, { size: stats.size });
      return { size: stats.size };
    } catch (error) {
      log("ERROR", `${LOG_PREFIX} Trajectory upload failed`, error);
      throw error;
    }
  }

  private async cleanup(): Promise<void> {
    this.isRecording = false;
    this.ffmpegProcess = null;
    this.recordingId = null;
    this.videoUploadUrl = null;
    this.trajectoryUploadUrl = null;

    // Clean up temp files
    try {
      if (this.videoFilePath) {
        await fs.unlink(this.videoFilePath).catch(() => {});
        this.videoFilePath = null;
      }
      if (this.trajectoryFilePath) {
        await fs.unlink(this.trajectoryFilePath).catch(() => {});
        this.trajectoryFilePath = null;
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  // ============================================================================
  // Convex API calls
  // ============================================================================

  private async callStartRecording(): Promise<RecordingStartResult | null> {
    const url = `${this.config.convexUrl}/api/session-recordings/start`;
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cmux-token": this.config.taskRunToken,
        },
        body: JSON.stringify({
          taskRunId: this.config.taskRunId,
          includeVideo: true,
          includeTrajectory: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log("ERROR", `${LOG_PREFIX} Start recording API failed`, {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const result = await response.json() as {
        ok: boolean;
        recordingId: string;
        videoUploadUrl?: string;
        videoR2Key?: string;
        trajectoryUploadUrl?: string;
        trajectoryR2Key?: string;
      };

      if (!result.ok) {
        log("ERROR", `${LOG_PREFIX} Start recording API returned not ok`, result);
        return null;
      }

      return {
        recordingId: result.recordingId,
        videoUploadUrl: result.videoUploadUrl,
        videoR2Key: result.videoR2Key,
        trajectoryUploadUrl: result.trajectoryUploadUrl,
        trajectoryR2Key: result.trajectoryR2Key,
      };
    } catch (error) {
      log("ERROR", `${LOG_PREFIX} Start recording API error`, error);
      return null;
    }
  }

  private async callCompleteRecording(metadata: {
    videoSizeBytes?: number;
    videoDurationMs?: number;
    videoWidth?: number;
    videoHeight?: number;
    trajectorySizeBytes?: number;
    trajectoryMessageCount?: number;
  }): Promise<void> {
    const url = `${this.config.convexUrl}/api/session-recordings/complete`;
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cmux-token": this.config.taskRunToken,
        },
        body: JSON.stringify({
          recordingId: this.recordingId,
          ...metadata,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log("ERROR", `${LOG_PREFIX} Complete recording API failed`, {
          status: response.status,
          error: errorText,
        });
      }
    } catch (error) {
      log("ERROR", `${LOG_PREFIX} Complete recording API error`, error);
    }
  }

  private async callFailRecording(errorMessage: string): Promise<void> {
    const url = `${this.config.convexUrl}/api/session-recordings/fail`;
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cmux-token": this.config.taskRunToken,
        },
        body: JSON.stringify({
          recordingId: this.recordingId,
          errorMessage,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log("ERROR", `${LOG_PREFIX} Fail recording API failed`, {
          status: response.status,
          error: errorText,
        });
      }
    } catch (error) {
      log("ERROR", `${LOG_PREFIX} Fail recording API error`, error);
    }
  }
}

// ============================================================================
// Global recording registry (tracks active recordings by taskRunId)
// ============================================================================

const activeRecordings = new Map<string, SessionRecorder>();

/**
 * Start a recording for a task run.
 * Returns the recorder instance if successful, null if failed.
 */
export async function startSessionRecording(
  config: SessionRecordingConfig
): Promise<SessionRecorder | null> {
  // Check if already recording
  const existing = activeRecordings.get(config.taskRunId);
  if (existing?.active) {
    log("WARN", `${LOG_PREFIX} Recording already active for task ${config.taskRunId}`);
    return existing;
  }

  const recorder = new SessionRecorder(config);
  const result = await recorder.start();
  
  if (result) {
    activeRecordings.set(config.taskRunId, recorder);
    return recorder;
  }
  
  return null;
}

/**
 * Stop the recording for a task run.
 */
export async function stopSessionRecording(taskRunId: string): Promise<void> {
  const recorder = activeRecordings.get(taskRunId);
  if (!recorder) {
    log("WARN", `${LOG_PREFIX} No active recording found for task ${taskRunId}`);
    return;
  }

  await recorder.stop();
  activeRecordings.delete(taskRunId);
}

/**
 * Fail the recording for a task run.
 */
export async function failSessionRecording(taskRunId: string, errorMessage: string): Promise<void> {
  const recorder = activeRecordings.get(taskRunId);
  if (!recorder) {
    log("WARN", `${LOG_PREFIX} No active recording found for task ${taskRunId}`);
    return;
  }

  await recorder.fail(errorMessage);
  activeRecordings.delete(taskRunId);
}

/**
 * Get the active recorder for a task run (for logging trajectory).
 */
export function getSessionRecorder(taskRunId: string): SessionRecorder | undefined {
  return activeRecordings.get(taskRunId);
}
