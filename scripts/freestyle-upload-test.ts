#!/usr/bin/env bun
/**
 * Standalone repro script to test Freestyle put_file API limits.
 * Usage: FREESTYLE_API_KEY=xxx bun run scripts/freestyle-upload-test.ts
 */

import { appendFileSync, writeFileSync } from "node:fs";

const LOG_FILE = "freestyle-upload-test.log";
const API_KEY = process.env.FREESTYLE_API_KEY;
const BASE_URL = process.env.FREESTYLE_API_BASE_URL ?? "https://api.freestyle.sh";

function log(message: string) {
  const line = message + "\n";
  process.stdout.write(line);
  appendFileSync(LOG_FILE, line);
}

// Initialize log file
writeFileSync(LOG_FILE, `Freestyle put_file API Test - ${new Date().toISOString()}\n\n`);

if (!API_KEY) {
  log("Error: FREESTYLE_API_KEY environment variable is required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function createVm(): Promise<{ id: string; domains: string[] }> {
  const res = await fetch(`${BASE_URL}/v1/vms`, {
    method: "POST",
    headers,
    body: JSON.stringify({ template: {} }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create VM: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function putFile(vmId: string, path: string, content: string): Promise<void> {
  // filepath needs to be URL encoded (e.g., /tmp/test.txt -> %2Ftmp%2Ftest.txt)
  const encodedPath = encodeURIComponent(path);
  const res = await fetch(`${BASE_URL}/v1/vms/${vmId}/files/${encodedPath}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`put_file failed: ${res.status} ${body}`);
  }
}

async function stopVm(vmId: string): Promise<void> {
  await fetch(`${BASE_URL}/v1/vms/${vmId}/stop`, {
    method: "POST",
    headers,
  });
}

function generateTestData(sizeBytes: number): string {
  // Generate random-ish binary data and base64 encode it
  const bytes = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    bytes[i] = i % 256;
  }
  return Buffer.from(bytes).toString("base64");
}

async function main() {
  log("Creating VM...");
  const vm = await createVm();
  log(`VM created: ${vm.id}`);
  log(`Domain: https://${vm.domains[0]}`);
  log(`API Base URL: ${BASE_URL}`);

  const testSizes = [
    { mb: 0.5, label: "500 KB" },
    { mb: 1, label: "1 MB" },
    { mb: 2, label: "2 MB" },
    { mb: 5, label: "5 MB" },
    { mb: 10, label: "10 MB" },
    { mb: 20, label: "20 MB" },
    { mb: 30, label: "30 MB" },
    { mb: 40, label: "40 MB" },
  ];

  log("\nTesting put_file size limits:");
  log("(Size shown is raw data size, base64 adds ~33% overhead)\n");

  for (const { mb, label } of testSizes) {
    const sizeBytes = Math.floor(mb * 1024 * 1024);
    const b64Content = generateTestData(sizeBytes);
    const b64SizeMb = (b64Content.length / 1024 / 1024).toFixed(1);

    const prefix = `  ${label.padEnd(8)} (${b64SizeMb} MB b64)... `;
    process.stdout.write(prefix);
    appendFileSync(LOG_FILE, prefix);

    try {
      await putFile(vm.id, `/tmp/test_${mb}mb.txt`, b64Content);
      log("OK");
    } catch (error) {
      log("FAILED");
      if (error instanceof Error) {
        log(`    Error: ${error.message}`);
      }
      break;
    }
  }

  log("\nStopping VM...");
  await stopVm(vm.id);
  log("Done.");
  log(`\nLog written to: ${LOG_FILE}`);
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
