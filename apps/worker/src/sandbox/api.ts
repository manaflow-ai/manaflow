/**
 * Sandbox REST API - Express routes for managing bwrap sandboxes
 *
 * Endpoints:
 *   GET  /sandbox/healthz         - Health check
 *   POST /sandbox/sandboxes       - Create sandbox
 *   GET  /sandbox/sandboxes       - List sandboxes
 *   GET  /sandbox/sandboxes/:id   - Get sandbox
 *   DELETE /sandbox/sandboxes/:id - Delete sandbox
 *   POST /sandbox/sandboxes/:id/exec - Execute command in sandbox
 *   GET  /sandbox/sandbox-ip/:index  - Get sandbox IP by index (for proxy)
 */

import { Router } from "express";
import {
  createSandbox,
  listSandboxes,
  getSandbox,
  deleteSandbox,
  execInSandbox,
  getSandboxIpByIndex,
  cleanupStaleSandboxes,
} from "./manager";

const sandboxRouter = Router();

// Health check
sandboxRouter.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Create sandbox
sandboxRouter.post("/sandboxes", async (req, res) => {
  try {
    const sandbox = await createSandbox(req.body);
    res.status(201).json(sandbox);
  } catch (err) {
    console.error("[SandboxAPI] Create error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// List sandboxes
sandboxRouter.get("/sandboxes", async (_req, res) => {
  try {
    const sandboxes = await listSandboxes();
    res.json(sandboxes);
  } catch (err) {
    console.error("[SandboxAPI] List error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Get sandbox by ID or index
sandboxRouter.get("/sandboxes/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const sandbox = await getSandbox(id);
    if (!sandbox) {
      res.status(404).json({ error: "Sandbox not found" });
      return;
    }
    res.json(sandbox);
  } catch (err) {
    console.error("[SandboxAPI] Get error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Delete sandbox
sandboxRouter.delete("/sandboxes/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const sandbox = await deleteSandbox(id);
    if (!sandbox) {
      res.status(404).json({ error: "Sandbox not found" });
      return;
    }
    res.json(sandbox);
  } catch (err) {
    console.error("[SandboxAPI] Delete error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Execute command in sandbox
sandboxRouter.post("/sandboxes/:id/exec", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await execInSandbox(id, req.body);
    res.json(result);
  } catch (err) {
    console.error("[SandboxAPI] Exec error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Get sandbox IP by index (used by proxy for routing)
sandboxRouter.get("/sandbox-ip/:index", async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index)) {
      res.status(400).json({ error: "Invalid index" });
      return;
    }
    const ip = await getSandboxIpByIndex(index);
    if (!ip) {
      res.status(404).json({ error: "Sandbox not found" });
      return;
    }
    res.json({ index, ip });
  } catch (err) {
    console.error("[SandboxAPI] Get IP error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Cleanup stale sandboxes (can be called periodically)
sandboxRouter.post("/cleanup", async (_req, res) => {
  try {
    await cleanupStaleSandboxes();
    res.json({ status: "ok" });
  } catch (err) {
    console.error("[SandboxAPI] Cleanup error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export { sandboxRouter };
