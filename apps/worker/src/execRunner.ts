import { promisify } from "node:util";
import { exec, spawn, type ExecException } from "node:child_process";
import type { WorkerExec, WorkerExecResult } from "@cmux/shared";

const execAsync = promisify(exec);

function spawnAsync(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code, signal) => {
      // If code is null, the process was killed by a signal - treat as failure
      // Using exit code 1 for signalled processes (Unix convention is 128+signum but we don't need that precision)
      const exitCode = code !== null ? code : 1;
      resolve({ stdout, stderr, exitCode });
    });

    proc.on("error", (err) => {
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

export async function runWorkerExec(validated: WorkerExec): Promise<WorkerExecResult> {
  const execOptions = {
    cwd: validated.cwd || process.env.HOME || "/",
    env: { ...process.env, ...(validated.env || {}) } as NodeJS.ProcessEnv,
    timeout: validated.timeout,
  };

  try {
    // If the caller asked for a specific shell with -c, execute using that shell
    if (
      (validated.command === "/bin/bash" ||
        validated.command === "bash" ||
        validated.command === "/bin/sh" ||
        validated.command === "sh") &&
      validated.args &&
      validated.args[0] === "-c"
    ) {
      const shellCommand = validated.args.slice(1).join(" ");
      const shellPath = validated.command;
      const { stdout, stderr } = await execAsync(shellCommand, {
        ...execOptions,
        shell: shellPath,
      });
      return { stdout: stdout || "", stderr: stderr || "", exitCode: 0 };
    }

    // Use spawn to pass args directly without shell interpretation
    // This properly handles args with special characters like newlines
    const result = await spawnAsync(
      validated.command,
      validated.args || [],
      execOptions
    );
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  } catch (execError: unknown) {
    const isObj = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null;

    const toString = (v: unknown): string => {
      if (typeof v === "string") return v;
      if (isObj(v) && "toString" in v && typeof v.toString === "function") {
        try {
          // Buffer and many objects provide sensible toString()
          return v.toString();
        } catch (_err) {
          return "";
        }
      }
      return "";
    };

    const err = execError as Partial<ExecException> & {
      stdout?: unknown;
      stderr?: unknown;
      code?: number | string;
      signal?: NodeJS.Signals;
    };

    const code = typeof err?.code === "number" ? err.code : 1;

    return {
      stdout: toString(err?.stdout),
      stderr: toString(err?.stderr),
      exitCode: code,
      signal: (err?.signal as string | undefined) ?? undefined,
    };
  }
}
