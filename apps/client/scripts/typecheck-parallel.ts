import { spawn } from "node:child_process";

type TypeCheck = {
  label: string;
  command: string;
  args: string[];
};

const checks: TypeCheck[] = [
  {
    label: "renderer",
    command: "bunx",
    args: ["tsgo", "--noEmit", "-p", "tsconfig.json"],
  },
  {
    label: "electron",
    command: "bunx",
    args: ["tsgo", "--noEmit", "-p", "electron/tsconfig.json"],
  },
];

function runCheck({ label, command, args }: TypeCheck): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason =
        code !== null
          ? `exit code ${code}`
          : signal
            ? `signal ${signal}`
            : "unknown reason";
      reject(new Error(`${label} typecheck failed (${reason})`));
    });

    child.on("error", (error: Error) => {
      reject(new Error(`${label} typecheck failed (${error.message})`));
    });
  });
}

try {
  await Promise.all(checks.map(runCheck));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
