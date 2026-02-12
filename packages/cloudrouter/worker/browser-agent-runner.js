#!/usr/bin/env node
/**
 * Browser Agent Runner for E2B cmux sandbox
 *
 * This script is invoked by the worker-daemon to execute browser automation tasks.
 * It connects to Chrome via CDP and executes actions based on the prompt.
 *
 * Environment variables:
 * - CDP_ENDPOINT: Chrome DevTools Protocol endpoint (default: http://localhost:9222)
 * - BROWSER_AGENT_PROMPT: The prompt/task to execute
 * - BROWSER_AGENT_SCREENSHOT_PATH: Optional path to save a screenshot after execution
 * - ANTHROPIC_API_KEY: Optional API key for Claude-based browser agent
 */

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || "http://localhost:9222";
const PROMPT = process.env.BROWSER_AGENT_PROMPT;
const SCREENSHOT_PATH = process.env.BROWSER_AGENT_SCREENSHOT_PATH;

/**
 * Connect to Chrome CDP and get the WebSocket debugger URL for a page
 */
async function getPageTarget() {
  try {
    // Get list of targets
    const response = await fetch(`${CDP_ENDPOINT}/json/list`);
    if (!response.ok) {
      throw new Error(`Failed to get targets: ${response.status}`);
    }

    const targets = await response.json();

    // Find a page target
    let pageTarget = targets.find((t) => t.type === "page");

    // If no page exists, create a new one
    if (!pageTarget) {
      const newTabResponse = await fetch(`${CDP_ENDPOINT}/json/new?about:blank`);
      if (!newTabResponse.ok) {
        throw new Error(`Failed to create new tab: ${newTabResponse.status}`);
      }
      pageTarget = await newTabResponse.json();
    }

    return pageTarget;
  } catch (err) {
    throw new Error(`Failed to connect to CDP: ${err.message}`);
  }
}

/**
 * Simple WebSocket wrapper for CDP
 */
class CDPSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.messageId = 0;
    this.pendingMessages = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      // Use built-in WebSocket if available (Node 22+), otherwise require ws
      let WebSocket;
      try {
        WebSocket = globalThis.WebSocket || require("ws");
      } catch {
        WebSocket = require("ws");
      }

      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const pending = this.pendingMessages.get(message.id);
        if (pending) {
          this.pendingMessages.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = ++this.messageId;
    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

/**
 * Parse simple commands from the prompt
 * Supports: navigate <url>, click <selector>, type <selector> <text>, screenshot, wait <ms>
 */
function parseCommands(prompt) {
  const commands = [];
  const lines = prompt.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();

    if (trimmed.startsWith("navigate ") || trimmed.startsWith("go to ") || trimmed.startsWith("open ")) {
      const url = line.replace(/^(navigate|go to|open)\s+/i, "").trim();
      commands.push({ type: "navigate", url });
    } else if (trimmed.startsWith("click ")) {
      const selector = line.replace(/^click\s+/i, "").trim();
      commands.push({ type: "click", selector });
    } else if (trimmed.startsWith("type ")) {
      const match = line.match(/^type\s+([^\s]+)\s+(.+)$/i);
      if (match) {
        commands.push({ type: "type", selector: match[1], text: match[2] });
      }
    } else if (trimmed === "screenshot") {
      commands.push({ type: "screenshot" });
    } else if (trimmed.startsWith("wait ")) {
      const ms = parseInt(line.replace(/^wait\s+/i, "").trim(), 10);
      commands.push({ type: "wait", ms: isNaN(ms) ? 1000 : ms });
    } else if (trimmed.startsWith("eval ") || trimmed.startsWith("execute ")) {
      const script = line.replace(/^(eval|execute)\s+/i, "").trim();
      commands.push({ type: "eval", script });
    }
  }

  // If no commands parsed, treat entire prompt as a URL to navigate to
  if (commands.length === 0 && prompt.trim()) {
    const url = prompt.trim();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      commands.push({ type: "navigate", url });
    } else {
      // Try as a search or simple command
      commands.push({ type: "navigate", url: `https://www.google.com/search?q=${encodeURIComponent(url)}` });
    }
  }

  return commands;
}

/**
 * Execute browser automation commands
 */
async function runBrowserAgent(prompt) {
  const target = await getPageTarget();

  if (!target.webSocketDebuggerUrl) {
    throw new Error("No WebSocket debugger URL available");
  }

  const session = new CDPSession(target.webSocketDebuggerUrl);
  await session.connect();

  try {
    // Enable required domains
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("DOM.enable");

    const commands = parseCommands(prompt);
    console.log(`Executing ${commands.length} commands...`);

    for (const cmd of commands) {
      switch (cmd.type) {
        case "navigate": {
          console.log(`Navigating to: ${cmd.url}`);
          await session.send("Page.navigate", { url: cmd.url });
          // Wait for page to load
          await new Promise((resolve) => setTimeout(resolve, 2000));
          break;
        }

        case "click": {
          console.log(`Clicking: ${cmd.selector}`);
          const clickResult = await session.send("Runtime.evaluate", {
            expression: `
              (function() {
                const el = document.querySelector('${cmd.selector.replace(/'/g, "\\'")}');
                if (el) {
                  el.click();
                  return 'clicked';
                }
                return 'not found';
              })()
            `,
            returnByValue: true,
          });
          console.log(`  Result: ${clickResult?.result?.value || "unknown"}`);
          break;
        }

        case "type": {
          console.log(`Typing in: ${cmd.selector}`);
          await session.send("Runtime.evaluate", {
            expression: `
              (function() {
                const el = document.querySelector('${cmd.selector.replace(/'/g, "\\'")}');
                if (el) {
                  el.value = '${cmd.text.replace(/'/g, "\\'")}';
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  return 'typed';
                }
                return 'not found';
              })()
            `,
            returnByValue: true,
          });
          break;
        }

        case "wait": {
          console.log(`Waiting: ${cmd.ms}ms`);
          await new Promise((resolve) => setTimeout(resolve, cmd.ms));
          break;
        }

        case "eval": {
          console.log(`Evaluating: ${cmd.script.substring(0, 50)}...`);
          const evalResult = await session.send("Runtime.evaluate", {
            expression: cmd.script,
            returnByValue: true,
          });
          if (evalResult?.result?.value !== undefined) {
            console.log(`  Result: ${JSON.stringify(evalResult.result.value)}`);
          }
          break;
        }

        case "screenshot": {
          console.log("Taking screenshot...");
          const screenshotData = await session.send("Page.captureScreenshot", {
            format: "png",
          });
          if (screenshotData?.data) {
            const fs = require("fs");
            const path = SCREENSHOT_PATH || "/tmp/browser-screenshot.png";
            fs.writeFileSync(path, Buffer.from(screenshotData.data, "base64"));
            console.log(`Screenshot saved to: ${path}`);
          }
          break;
        }
      }
    }

    // Take final screenshot if path specified and not already taken
    if (SCREENSHOT_PATH && !commands.some((c) => c.type === "screenshot")) {
      console.log("Taking final screenshot...");
      const screenshotData = await session.send("Page.captureScreenshot", {
        format: "png",
      });
      if (screenshotData?.data) {
        const fs = require("fs");
        fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshotData.data, "base64"));
        console.log(`Screenshot saved to: ${SCREENSHOT_PATH}`);
      }
    }

    // Get current page info
    const pageInfo = await session.send("Runtime.evaluate", {
      expression: `({ url: location.href, title: document.title })`,
      returnByValue: true,
    });

    console.log("\nFinal page state:");
    console.log(`  URL: ${pageInfo?.result?.value?.url || "unknown"}`);
    console.log(`  Title: ${pageInfo?.result?.value?.title || "unknown"}`);

    return { success: true };
  } finally {
    session.close();
  }
}

// Main execution
async function main() {
  if (!PROMPT) {
    console.error("Error: BROWSER_AGENT_PROMPT environment variable is required");
    process.exit(1);
  }

  console.log("Browser Agent Runner");
  console.log(`CDP Endpoint: ${CDP_ENDPOINT}`);
  console.log(`Prompt: ${PROMPT}`);
  console.log("");

  try {
    await runBrowserAgent(PROMPT);
    console.log("\nBrowser agent completed successfully");
    process.exit(0);
  } catch (err) {
    console.error(`\nBrowser agent error: ${err.message}`);
    process.exit(1);
  }
}

main();
