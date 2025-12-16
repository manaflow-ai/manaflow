#!/usr/bin/env bun

import ignore from "ignore";
import { Instance, MorphCloudClient } from "morphcloud";
import { NodeSSH } from "node-ssh";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface DockerfileInstruction {
  type: string;
  content: string;
  args?: string[];
  heredoc?: string;
  isHeredoc?: boolean;
}

class DockerfileParser {
  private lines: string[];
  private currentIndex: number = 0;
  private buildArgs: Map<string, string> = new Map();
  private currentStage: string = "default";
  private stages: Map<string, string> = new Map();

  constructor(content: string) {
    this.lines = content.split("\n");
  }

  parse(): DockerfileInstruction[] {
    const instructions: DockerfileInstruction[] = [];

    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith("#")) {
        this.currentIndex++;
        continue;
      }

      // Parse instruction
      const instruction = this.parseInstruction();
      if (instruction) {
        instructions.push(instruction);
      }
    }

    return instructions;
  }

  private parseInstruction(): DockerfileInstruction | null {
    const line = this.lines[this.currentIndex].trim();

    // Check for heredoc syntax
    if (line.match(/^(RUN|COPY)\s+<<(-)?'?([A-Z]+)'?$/)) {
      return this.parseHeredoc();
    }

    // Parse regular instruction
    const match = line.match(/^([A-Z]+)\s+(.*)$/);
    if (!match) {
      this.currentIndex++;
      return null;
    }

    const [, type, content] = match;
    this.currentIndex++;

    // Handle multi-line continuations
    let fullContent = content;
    while (
      fullContent.endsWith("\\") &&
      this.currentIndex < this.lines.length
    ) {
      fullContent =
        fullContent.slice(0, -1) + " " + this.lines[this.currentIndex].trim();
      this.currentIndex++;
    }

    // Process specific instruction types
    switch (type) {
      case "ARG":
        this.parseArg(fullContent);
        break;
      case "FROM":
        this.parseFrom(fullContent);
        break;
    }

    return {
      type,
      content: fullContent,
      args: fullContent.split(/\s+/),
    };
  }

  private parseHeredoc(): DockerfileInstruction {
    const line = this.lines[this.currentIndex];
    const match = line.match(/^(RUN|COPY)\s+<<(-)?'?([A-Z]+)'?$/);
    if (!match) {
      throw new Error(`Invalid heredoc syntax: ${line}`);
    }

    const [, type, dash, delimiter] = match;
    this.currentIndex++;

    const heredocLines: string[] = [];
    while (this.currentIndex < this.lines.length) {
      const currentLine = this.lines[this.currentIndex];
      if (currentLine.trim() === delimiter) {
        this.currentIndex++;
        break;
      }
      // If dash is present, remove leading tabs
      heredocLines.push(dash ? currentLine.replace(/^\t/, "") : currentLine);
      this.currentIndex++;
    }

    return {
      type,
      content: heredocLines.join("\n"),
      isHeredoc: true,
      heredoc: delimiter,
    };
  }

  private parseArg(content: string) {
    const match = content.match(/^([A-Z_]+)(?:=(.*))?$/);
    if (match) {
      const [, name, value] = match;
      if (value) {
        this.buildArgs.set(name, value);
      }
    }
  }

  private parseFrom(content: string) {
    const parts = content.split(/\s+AS\s+/i);
    if (parts.length > 1) {
      this.currentStage = parts[1];
      this.stages.set(this.currentStage, parts[0]);
    }
  }

  getBuildArgs(): Map<string, string> {
    return this.buildArgs;
  }

  getStages(): Map<string, string> {
    return this.stages;
  }
}

class MorphDockerfileExecutor {
  private ssh: NodeSSH;
  private client: MorphCloudClient;
  private instance: Instance | null = null;
  private workDir: string = "/root";
  private dockerignore: ReturnType<typeof ignore> | null = null;
  private gitignore: ReturnType<typeof ignore> | null = null;
  private entrypoint: string | null = null;
  private cmd: string | null = null;
  private stageFiles: Map<string, Set<string>> = new Map();

  private async findFiles(pattern: string): Promise<string[]> {
    // Simple glob pattern matching for common cases
    const results: string[] = [];

    // Handle patterns like "scripts/package.json", "apps/*/package.json", etc.
    if (!pattern.includes("*") && !pattern.includes("?")) {
      // No glob pattern, just return the file if it exists
      try {
        await fs.stat(pattern);
        return [pattern];
      } catch {
        return [];
      }
    }

    // Split pattern into directory parts
    const parts = pattern.split("/");

    // Simple implementation for common patterns like "apps/*/package.json" or "packages/*/package.json"
    if (parts.length === 3 && parts[1] === "*") {
      const baseDir = parts[0];
      const fileName = parts[2];

      try {
        const entries = await fs.readdir(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const filePath = path.join(baseDir, entry.name, fileName);
            try {
              await fs.stat(filePath);
              results.push(filePath);
            } catch {
              // File doesn't exist in this directory
            }
          }
        }
      } catch (err) {
        console.log(`  Warning: Could not read directory ${baseDir}: ${err}`);
      }
    } else if (pattern === "scripts/package.json") {
      // Direct file check
      try {
        await fs.stat(pattern);
        results.push(pattern);
      } catch {
        // File doesn't exist
      }
    }

    return results;
  }

  constructor() {
    this.ssh = new NodeSSH();
    this.client = new MorphCloudClient();
  }

  async connect(): Promise<void> {
    // const snapshot = await this.client.snapshots.create({
    //   // imageId: "morphvm-minimal",
    //   imageId: "snapshot_wdtqk4gj",
    //   vcpus: 4,
    //   memory: 16384,
    //   diskSize: 32768,
    // });
    // console.log(`Created snapshot: ${snapshot.id}`);

    // const snapshotId = "snapshot_r7dtrx12";
    const snapshotId = "snapshot_uvnvam3n";

    console.log("Starting instance from snapshot...", snapshotId);
    const instance = await this.client.instances.start({
      // snapshotId: snapshot.id,
      // snapshotId: "snapshot_wdtqk4gj", // the one with docker!
      snapshotId, // the big one!
      // 30 minutes
      ttlSeconds: 60 * 30,
      ttlAction: "pause",
    });
    void (async () => {
      await instance.setWakeOn(true, true);
    })();

    this.instance = instance;

    console.log(`Started instance: ${this.instance.id}`);

    // Connect via SSH
    console.log("Connecting to Morph VM via SSH...");

    const privateKeyPath = path.join(
      process.env.HOME || "",
      ".ssh",
      "id_ed25519_new"
    );

    await this.ssh.connect({
      host: "ssh.cloud.morph.so",
      username: instance.id,
      privateKeyPath: privateKeyPath,
      readyTimeout: 30000,
      keepaliveInterval: 5000,
    });

    console.log("Connected to Morph VM");
  }

  async loadIgnoreFiles(): Promise<void> {
    // Load .dockerignore
    try {
      const dockerignoreContent = await fs.readFile(".dockerignore", "utf-8");
      this.dockerignore = ignore().add(dockerignoreContent);
    } catch (_error) {
      // No .dockerignore file
      this.dockerignore = ignore();
    }

    // Load .gitignore
    try {
      const gitignoreContent = await fs.readFile(".gitignore", "utf-8");
      this.gitignore = ignore().add(gitignoreContent);
    } catch (_error) {
      // No .gitignore file
      this.gitignore = ignore();
    }
  }

  async executeDockerfile(dockerfilePath: string): Promise<void> {
    const content = await fs.readFile(dockerfilePath, "utf-8");
    const parser = new DockerfileParser(content);
    const instructions = parser.parse();

    console.log(`Parsing Dockerfile with ${instructions.length} instructions`);

    // Process each instruction
    for (const instruction of instructions) {
      console.log(`\nExecuting: ${instruction.type}`);

      switch (instruction.type) {
        case "FROM":
          await this.handleFrom(instruction);
          break;
        case "RUN":
          await this.handleRun(instruction);
          break;
        case "WORKDIR":
          await this.handleWorkdir(instruction);
          break;
        case "COPY":
          await this.handleCopy(instruction);
          break;
        case "ADD":
          await this.handleAdd(instruction);
          break;
        case "ENV":
          await this.handleEnv(instruction);
          break;
        case "ARG":
          // Already parsed
          break;
        case "EXPOSE":
          // Note exposed ports but don't need to execute anything
          console.log(`  Exposing ports: ${instruction.content}`);
          await this.handleExpose(instruction);
          break;
        case "VOLUME":
          break;
        // Ignore volumes for now
        // await this.handleVolume(instruction);
        // break;
        case "CMD":
          await this.handleCmd(instruction);
          break;
        case "ENTRYPOINT":
          await this.handleEntrypoint(instruction);
          break;
        default:
          console.log(
            `  Skipping unsupported instruction: ${instruction.type}`
          );
      }
    }

    // After processing all instructions, run CMD/ENTRYPOINT if present
    await this.runFinalCommand();
  }

  async getHttpServices() {
    if (!this.instance) {
      throw new Error("Instance not found");
    }
    const httpServices = this.instance.networking.httpServices;
    return httpServices;
  }

  async setWakeOn({
    wakeOnSsh,
    wakeOnHttp,
  }: {
    wakeOnSsh: boolean;
    wakeOnHttp: boolean;
  }): Promise<void> {
    if (!this.instance) {
      throw new Error("Instance not found");
    }
    await this.instance.setWakeOn(wakeOnSsh, wakeOnHttp);
  }

  async snapshot() {
    if (!this.instance) {
      throw new Error("Instance not found");
    }
    const snapshot = await this.instance.snapshot();
    return snapshot;
  }

  private async handleCmd(instruction: DockerfileInstruction): Promise<void> {
    console.log(`  Setting CMD: ${instruction.content}`);
    this.cmd = this.parseCommand(instruction.content);
  }

  private async handleEntrypoint(
    instruction: DockerfileInstruction
  ): Promise<void> {
    console.log(`  Setting ENTRYPOINT: ${instruction.content}`);
    this.entrypoint = this.parseCommand(instruction.content);
  }

  private parseCommand(content: string): string {
    // Handle JSON array format ["executable", "param1", "param2"]
    if (content.startsWith("[")) {
      try {
        const parsed = JSON.parse(content);
        return parsed.join(" ");
      } catch {
        // Not valid JSON, treat as shell format
      }
    }
    // Shell format
    return content;
  }

  private async runFinalCommand(): Promise<void> {
    let finalCommand = "";

    if (this.entrypoint && this.cmd) {
      // Both ENTRYPOINT and CMD are set
      finalCommand = `${this.entrypoint} ${this.cmd}`;
    } else if (this.entrypoint) {
      // Only ENTRYPOINT is set
      finalCommand = this.entrypoint;
    } else if (this.cmd) {
      // Only CMD is set
      finalCommand = this.cmd;
    }

    if (finalCommand) {
      console.log(`\nStarting background process: ${finalCommand}`);
      await this.execBackground(finalCommand);
      console.log("Background process started successfully");

      // Give it a moment to start and show initial output
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if process is still running
      const result = await this.ssh.execCommand(
        "ps aux | grep -v grep | grep -q '/bin/bash' && echo 'Process running' || echo 'Process not found'"
      );
      console.log(`Process status: ${result.stdout}`);
    }
  }

  private async execBackground(command: string): Promise<void> {
    // Run command in background using nohup and redirect output
    const bgCommand = `nohup ${command} > /tmp/docker-output.log 2>&1 &`;
    console.log(`  Executing in background: ${bgCommand}`);

    try {
      await this.ssh.execCommand(bgCommand, {
        cwd: this.workDir,
      });

      // Show initial logs
      await new Promise((resolve) => setTimeout(resolve, 500));
      const logResult = await this.ssh.execCommand(
        "head -20 /tmp/docker-output.log 2>/dev/null || true"
      );
      if (logResult.stdout) {
        console.log("Initial output:");
        console.log(logResult.stdout);
      }
    } catch (error) {
      console.error(`Failed to start background process: ${error}`);
    }
  }

  private async handleExpose(
    instruction: DockerfileInstruction
  ): Promise<void> {
    // Parse all ports (EXPOSE can have multiple ports separated by spaces)
    const ports = instruction.content
      .split(/\s+/)
      .map((p) => parseInt(p))
      .filter((p) => !isNaN(p));
    for (const port of ports) {
      this.instance?.exposeHttpService(`port-${port}`, port);
    }
  }

  private async handleFrom(instruction: DockerfileInstruction): Promise<void> {
    const parts = instruction.content.split(/\s+AS\s+/i);
    const image = parts[0];
    const stage = parts[1] || "default";

    console.log(`  Setting up base image: ${image} (stage: ${stage})`);

    // Track this stage for multi-stage builds
    if (!this.stageFiles.has(stage)) {
      this.stageFiles.set(stage, new Set());
    }

    // For Ubuntu images, ensure apt-get is updated
    if (image.includes("ubuntu")) {
      await this.exec("apt-get update");
    }
  }

  private async handleRun(instruction: DockerfileInstruction): Promise<void> {
    // Check for --mount directives and remove them
    let command = instruction.content;

    // Remove --mount directives (simplified handling)
    if (command.includes("--mount=")) {
      command = command.replace(/--mount=[^\s]+\s*/g, "");
      console.log(`  Note: Ignoring --mount directives`);
    }

    if (instruction.isHeredoc) {
      // Execute heredoc content as a shell script
      const tempFile = `/tmp/heredoc_${Date.now()}.sh`;
      // Create a temporary local file first
      const localTempFile = `/tmp/local_heredoc_${Date.now()}.sh`;
      await fs.writeFile(localTempFile, command);
      await this.ssh.putFile(localTempFile, tempFile);
      await fs.unlink(localTempFile);
      await this.exec(`bash ${tempFile}`);
      await this.exec(`rm ${tempFile}`);
    } else {
      // Execute regular RUN command
      await this.exec(command);
    }
  }

  private async handleWorkdir(
    instruction: DockerfileInstruction
  ): Promise<void> {
    this.workDir = instruction.content;
    console.log(`  Changing working directory to: ${this.workDir}`);
    await this.exec(`mkdir -p ${this.workDir}`);
  }

  private async handleCopy(instruction: DockerfileInstruction): Promise<void> {
    // Parse COPY instruction more carefully
    let content = instruction.content;
    let fromStage: string | null = null;
    let preserveParents = false;

    // Check for --from=<stage> format
    const fromMatch = content.match(/^--from=([^\s]+)\s+/);
    if (fromMatch) {
      fromStage = fromMatch[1];
      content = content.substring(fromMatch[0].length);
    }

    // Check for --parents flag
    if (content.startsWith("--parents ")) {
      preserveParents = true;
      content = content.substring("--parents ".length);
    }

    // Now split the remaining content
    const args = content.trim().split(/\s+/);
    const sources = args.slice(0, -1);
    const dest = args[args.length - 1];

    if (fromStage) {
      console.log(
        `  Copying from stage ${fromStage}: ${sources.join(" ")} to ${dest}`
      );

      // For multi-stage builds, the source paths exist in the build context
      // Since we're running everything in the same VM, we just copy normally
      // but we need to handle absolute paths from the builder stage
      for (const source of sources) {
        // The source is an absolute path in the builder stage
        // We'll copy it as-is since we're in the same environment
        const remoteDest = path.isAbsolute(dest)
          ? dest
          : path.join(this.workDir, dest);

        // Ensure destination directory exists
        if (sources.length > 1 || dest.endsWith("/")) {
          await this.exec(`mkdir -p ${remoteDest}`);
        } else {
          const destDir = path.dirname(remoteDest);
          await this.exec(`mkdir -p ${destDir}`);
        }

        // Copy the file/directory
        try {
          const stats = await this.ssh.execCommand(`stat -c %F "${source}"`);
          if (stats.stdout.includes("directory")) {
            await this.exec(`cp -r ${source} ${remoteDest}`);
          } else {
            await this.exec(`cp ${source} ${remoteDest}`);
          }
          console.log(`  Copied ${source} to ${remoteDest}`);
        } catch (_error) {
          console.log(
            `  Warning: Could not copy ${source} from stage ${fromStage}`
          );
        }
      }
      return;
    }

    // Ensure destination directory exists if copying to a directory
    const fullDest = path.isAbsolute(dest)
      ? dest
      : path.join(this.workDir, dest);

    // If dest is ./ or ends with /, ensure it exists
    if (dest === "./" || dest === "." || dest.endsWith("/")) {
      await this.exec(`mkdir -p ${fullDest}`);
    }

    console.log(
      `  Copying ${sources.join(", ")} to ${dest}${preserveParents ? " (preserving parents)" : ""}`
    );

    for (const source of sources) {
      // Check if source contains glob patterns
      if (source.includes("*") || source.includes("?")) {
        const matches = await this.findFiles(source);
        if (matches.length === 0) {
          console.log(`  Warning: No files matched pattern ${source}`);
          continue;
        }
        for (const match of matches) {
          await this.copyToVM(match, dest, preserveParents);
        }
      } else {
        await this.copyToVM(source, dest, preserveParents);
      }
    }
  }

  private async handleAdd(instruction: DockerfileInstruction): Promise<void> {
    // Similar to COPY but with URL support and auto-extraction
    const args = instruction.content.split(/\s+/);
    const sources = args.slice(0, -1);
    const dest = args[args.length - 1];

    for (const source of sources) {
      if (source.startsWith("http://") || source.startsWith("https://")) {
        console.log(`  Downloading ${source} to ${dest}`);
        await this.exec(`curl -fsSL -o ${dest} ${source}`);
      } else {
        await this.copyToVM(source, dest);
      }
    }
  }

  private async handleEnv(instruction: DockerfileInstruction): Promise<void> {
    const match = instruction.content.match(/^([A-Z_]+)=(.*)$/);
    if (match) {
      const [, name, value] = match;
      console.log(`  Setting environment variable: ${name}=${value}`);
      await this.exec(`export ${name}=${value}`);
    }
  }

  private async handleVolume(
    instruction: DockerfileInstruction
  ): Promise<void> {
    const volume = instruction.content;
    console.log(`  Creating volume: ${volume}`);
    await this.exec(`mkdir -p ${volume}`);
  }

  private async copyToVM(
    source: string,
    dest: string,
    preserveParents: boolean = false
  ): Promise<void> {
    // Check if file should be ignored - only for relative paths
    if (!path.isAbsolute(source)) {
      if (
        (this.dockerignore && this.dockerignore.ignores(source)) ||
        (this.gitignore && this.gitignore.ignores(source))
      ) {
        console.log(`  Skipping ignored file: ${source}`);
        return;
      }
    }

    const stats = await fs.stat(source).catch(() => null);
    if (!stats) {
      console.log(`  Warning: Source ${source} not found`);
      return;
    }

    const remoteDest = path.isAbsolute(dest)
      ? dest
      : path.join(this.workDir, dest);

    if (stats.isDirectory()) {
      await this.copyDirectoryToVM(source, remoteDest, preserveParents);
    } else {
      // Determine proper destination path
      let finalDest = remoteDest;

      // If preserveParents is true, maintain the full directory structure
      if (preserveParents) {
        // For --parents, preserve the full path structure
        // e.g., apps/client/package.json -> /cmux/apps/client/package.json
        if (dest === "./" || dest === ".") {
          // Copying to current workdir with structure preserved
          finalDest = path.join(this.workDir, source);
        } else {
          // Append source path to destination
          finalDest = path.join(remoteDest, source);
        }
        const remoteDir = path.dirname(finalDest);
        await this.exec(`mkdir -p ${remoteDir}`);
      } else if (dest.endsWith("/") || dest === "./" || dest === ".") {
        // Treat as directory, preserve source filename only
        const remoteDir =
          dest === "." || dest === "./" ? this.workDir : remoteDest;
        await this.exec(`mkdir -p ${remoteDir}`);
        finalDest = path.join(remoteDir, path.basename(source));
      } else {
        // Destination is a specific file path (e.g., /startup.sh)
        // Copy source to that exact path
        finalDest = remoteDest;
        const remoteDir = path.dirname(remoteDest);
        // Only create parent directory if it's not root
        if (remoteDir !== "/") {
          await this.exec(`mkdir -p ${remoteDir}`);
        }
      }

      console.log(`  Copying ${source} to ${finalDest}`);
      try {
        await this.ssh.putFile(source, finalDest);
      } catch (error) {
        console.error(`  Failed to copy ${source}: ${error}`);
        throw error;
      }
    }
  }

  private async copyDirectoryToVM(
    localDir: string,
    remoteDir: string,
    _preserveParents: boolean
  ): Promise<void> {
    await this.exec(`mkdir -p ${remoteDir}`);

    const files = await fs.readdir(localDir, { withFileTypes: true });

    for (const file of files) {
      const localPath = path.join(localDir, file.name);
      const remotePath = path.join(remoteDir, file.name);

      // Check ignore rules
      if (
        (this.dockerignore && this.dockerignore.ignores(localPath)) ||
        (this.gitignore && this.gitignore.ignores(localPath))
      ) {
        continue;
      }

      if (file.isDirectory()) {
        await this.copyDirectoryToVM(localPath, remotePath, false);
      } else {
        console.log(`  Copying ${localPath} to ${remotePath}`);
        await this.ssh.putFile(localPath, remotePath);
      }
    }
  }

  private async exec(command: string): Promise<void> {
    console.log(`  Executing: ${command}`);

    try {
      const result = await this.ssh.execCommand(command, {
        cwd: this.workDir,
      });

      if (result.stdout) {
        console.log(result.stdout);
      }

      if (result.stderr && result.code !== 0) {
        console.error(`Error: ${result.stderr}`);
        throw new Error(`Command failed with exit code ${result.code}`);
      }
    } catch (error) {
      console.error(`Failed to execute command: ${error}`);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.ssh.dispose();

    if (this.instance) {
      console.log(`\nCleaning up Morph VM: ${this.instance.id}`);
      await this.client.instances.stop({ instanceId: this.instance.id });
    }
  }
}

async function main() {
  const dockerfilePath = process.argv[2] || "Dockerfile";

  console.log(`Building from ${dockerfilePath}`);

  const executor = new MorphDockerfileExecutor();

  try {
    await executor.loadIgnoreFiles();
    await executor.connect();
    await executor.executeDockerfile(dockerfilePath);

    console.log("Setting wake on");
    await executor.setWakeOn({ wakeOnSsh: false, wakeOnHttp: true });

    const httpServices = await executor.getHttpServices();
    console.log("httpServices", httpServices);

    // let user play around and tell them to press any key to continue
    console.log("\nPress any key to snapshot...");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    console.log("Snapshotting...");

    const snapshot = await executor.snapshot();
    console.log(`Snapshot created: ${snapshot.id}`);

    console.log("\nBuild completed successfully!");
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  } finally {
    await executor.disconnect();
    process.exit(0);
  }
}

// Run the script
main().catch(console.error);
