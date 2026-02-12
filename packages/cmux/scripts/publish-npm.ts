#!/usr/bin/env tsx

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const rootDir = path.resolve(projectRoot, "../..");
const npmPublishDir = path.join(projectRoot, "npm-publish");
const cmuxCliBinary = path.join(rootDir, "cmux-cli");

function publish() {
  console.log("🚀 Publishing cmux to npm...\n");

  // Check if cmux-cli binary exists
  if (!fs.existsSync(cmuxCliBinary)) {
    console.error("❌ cmux-cli binary not found!");
    console.error("Please run ./scripts/build-cli.ts first");
    process.exit(1);
  }

  // Clean up and create npm-publish directory
  if (fs.existsSync(npmPublishDir)) {
    fs.rmSync(npmPublishDir, { recursive: true, force: true });
  }
  fs.mkdirSync(npmPublishDir);
  console.log("✓ Created npm-publish directory");

  // Copy files
  fs.copyFileSync(cmuxCliBinary, path.join(npmPublishDir, "cmux-cli"));
  console.log("✓ Copied cmux-cli binary");

  // Create package.json with fixes
  const packageJson = {
    name: "cmux",
    version: JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8")
    ).version,
    description:
      "Open source Claude Code manager that supports Codex/Gemini/OpenCode/Amp CLI",
    bin: {
      cmux: "./cmux-cli",
    },
    files: ["cmux-cli", "README.md"],
    keywords: [
      "Claude Code",
      "Codex",
      "Gemini",
      "OpenCode",
      "Claude Opus",
      "Claude Sonnet",
      "Coding CLI",
      "multiplexer",
      "Grok",
      "Amp",
      "Qwen",
      "Rovo",
      "tmux",
    ],
    author: "Manaflow",
    license: "MIT",
    engines: {
      node: ">=16.0.0",
    },
    publishConfig: {
      access: "public",
    },
    repository: {
      type: "git",
      url: "git+https://github.com/manaflow-ai/manaflow.git",
    },
  };

  fs.writeFileSync(
    path.join(npmPublishDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );
  console.log("✓ Created package.json");

  // Copy README
  if (fs.existsSync(path.join(projectRoot, "README.md"))) {
    fs.copyFileSync(
      path.join(projectRoot, "README.md"),
      path.join(npmPublishDir, "README.md")
    );
    console.log("✓ Copied README.md");
  }

  // Show package contents
  console.log("\n📦 Package contents:");
  const files = fs.readdirSync(npmPublishDir);
  files.forEach((file) => {
    const stat = fs.statSync(path.join(npmPublishDir, file));
    const size = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`   ${file} (${size} MB)`);
  });

  // Run npm pkg fix
  console.log("\n🔧 Running npm pkg fix...");
  try {
    execSync("npm pkg fix", { cwd: npmPublishDir, stdio: "inherit" });
    console.log("✓ Fixed package.json");
  } catch (error) {
    console.warn("⚠️  npm pkg fix failed, continuing...");
  }

  // Publish
  console.log("\n📤 Publishing to npm...");
  try {
    execSync("npm publish", { cwd: npmPublishDir, stdio: "inherit" });
    console.log("\n✅ Successfully published to npm!");
  } catch (error) {
    console.error("\n❌ Failed to publish:", error);
    process.exit(1);
  }

  // Clean up
  console.log("\n🧹 Cleaning up...");
  fs.rmSync(npmPublishDir, { recursive: true, force: true });
  console.log("✓ Removed npm-publish directory");

  console.log("\n🎉 Done!");
}

// Run the publish script
publish();
