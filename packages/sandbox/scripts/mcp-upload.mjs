#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, resolve as resolvePath } from "node:path";
import { env, stdin, stdout } from "node:process";
import readline from "node:readline";

const TOOL_NAME = "upload_file";
const PROTOCOL_VERSION = "2024-11-05";

const EXTENSION_TO_CONTENT_TYPE = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["mp4", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
  ["pdf", "application/pdf"],
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["json", "application/json"],
]);

const CONTENT_TYPE_TO_EXTENSION = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["text/markdown", "md"],
  ["application/json", "json"],
]);

function inferContentType(pathValue) {
  const ext = extname(pathValue).toLowerCase().replace(/^\./, "");
  if (!ext) return null;
  return EXTENSION_TO_CONTENT_TYPE.get(ext) ?? null;
}

function ensureFileNameExtension(fileName, contentType) {
  const existingExt = extname(fileName).toLowerCase();
  if (existingExt) return fileName;
  const extension = CONTENT_TYPE_TO_EXTENSION.get(contentType);
  if (!extension) return fileName;
  return `${fileName}.${extension}`;
}
const EXTENSION_TO_CONTENT_TYPE = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["mp4", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
  ["pdf", "application/pdf"],
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["json", "application/json"],
]);

const CONTENT_TYPE_TO_EXTENSION = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["text/markdown", "md"],
  ["application/json", "json"],
]);

function inferContentType(pathValue) {
  const ext = extname(pathValue).toLowerCase().replace(/^\./, "");
  if (!ext) return null;
  return EXTENSION_TO_CONTENT_TYPE.get(ext) ?? null;
}

function ensureFileNameExtension(fileName, contentType) {
  const existingExt = extname(fileName).toLowerCase();
  if (existingExt) return fileName;
  const extension = CONTENT_TYPE_TO_EXTENSION.get(contentType);
  if (!extension) return fileName;
  return `${fileName}.${extension}`;
}

const toolDefinition = {
  name: TOOL_NAME,
  description:
    "Upload a local file (images/videos supported). This is the only supported way to embed files in the final Markdown response with a whitelisted domain. Provide fileName and contentType to preserve file extensions on download.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path." },
      fileName: {
        type: "string",
        description:
          "Optional file name override (recommended; include extension when possible).",
      },
      contentType: {
        type: "string",
        description:
          "Optional MIME type override (recommended; helps downloads keep the right type).",
      },
    },
    required: ["path"],
  },
  outputSchema: {
    type: "object",
    properties: {
      storageId: { type: "string" },
      downloadUrl: { type: "string" },
      fileName: { type: "string" },
      contentType: { type: "string" },
      sizeBytes: { type: "number" },
    },
    required: ["storageId", "downloadUrl", "fileName", "sizeBytes"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

function writeResponse(payload) {
  stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendResult(id, result) {
  writeResponse({ jsonrpc: "2.0", id, result });
}

function sendError(id, message, code = -32603) {
  writeResponse({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function getAuthToken() {
  const token = env.CMUX_CONVERSATION_JWT;
  if (!token) {
    throw new Error("CMUX_CONVERSATION_JWT is not set");
  }
  return token;
}

function getConvexSiteUrl() {
  const base = env.CONVEX_SITE_URL;
  if (!base) {
    throw new Error("CONVEX_SITE_URL is not set");
  }
  return base.replace(/\/+$/, "");
}

async function requestUploadUrl(fileName, contentType, sizeBytes) {
  const url = `${getConvexSiteUrl()}/api/acp/storage/upload-url`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${getAuthToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fileName, contentType, sizeBytes }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Upload URL request failed: ${response.status} ${text}`.trim()
    );
  }

  const json = await response.json();
  if (!json || typeof json.uploadUrl !== "string") {
    throw new Error("Upload URL response missing uploadUrl");
  }
  return json.uploadUrl;
}

async function resolveDownloadUrl(storageId) {
  const url = `${getConvexSiteUrl()}/api/acp/storage/resolve-url`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${getAuthToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ storageId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Resolve URL failed: ${response.status} ${text}`.trim()
    );
  }

  const json = await response.json();
  if (!json || typeof json.url !== "string") {
    throw new Error("Resolve URL response missing url");
  }
  return json.url;
}

async function uploadFileToConvex({ path, fileName, contentType }) {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error("path is required and must be a non-empty string");
  }

  const resolvedPath = resolvePath(path);
  const stats = await stat(resolvedPath).catch((error) => {
    throw new Error(`Failed to stat file: ${error instanceof Error ? error.message : String(error)}`);
  });

  if (!stats.isFile()) {
    throw new Error("path must point to a regular file");
  }

  const rawFileName = fileName && fileName.trim().length > 0
    ? fileName.trim()
    : basename(resolvedPath);
  const inferredContentType =
    inferContentType(rawFileName) ?? inferContentType(resolvedPath);
  const effectiveContentType =
    typeof contentType === "string" && contentType.trim().length > 0
      ? contentType.trim()
      : inferredContentType ?? "application/octet-stream";
  const finalFileName = ensureFileNameExtension(
    rawFileName,
    effectiveContentType
  );
  const uploadUrl = await requestUploadUrl(
    finalFileName,
    effectiveContentType,
    stats.size
  );

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "content-type": effectiveContentType,
    },
    body: createReadStream(resolvedPath),
    duplex: "half",
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(
      `Upload failed: ${uploadResponse.status} ${text}`.trim()
    );
  }

  const uploadJson = await uploadResponse.json();
  const storageId =
    uploadJson && typeof uploadJson.storageId === "string"
      ? uploadJson.storageId
      : null;

  if (!storageId) {
    throw new Error("Upload response missing storageId");
  }

  const downloadUrl = await resolveDownloadUrl(storageId);

  return {
    storageId,
    downloadUrl,
    fileName: finalFileName,
    contentType: effectiveContentType,
    sizeBytes: stats.size,
  };
}

async function handleToolCall(id, params) {
  const toolName = params?.name;
  if (toolName !== TOOL_NAME) {
    sendError(id, `Unknown tool: ${String(toolName)}`, -32601);
    return;
  }

  try {
    const result = await uploadFileToConvex(params?.arguments ?? {});
    sendResult(id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mcp-upload] Tool error:", error);
    sendResult(id, {
      content: [{ type: "text", text: message }],
      isError: true,
    });
  }
}

const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    console.error("[mcp-upload] Failed to parse JSON:", error);
    return;
  }

  const { id, method, params } = message ?? {};

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "cmux", version: "1.0.0" },
      instructions:
        "Use upload_file to upload local files (including images/videos). This is the only supported way to embed files in the final Markdown response with a whitelisted domain.",
    });
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools: [toolDefinition] });
    return;
  }

  if (method === "tools/call") {
    await handleToolCall(id, params);
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (id !== undefined) {
    sendError(id, `Unsupported method: ${String(method)}`, -32601);
  }
});

rl.on("close", () => {
  stdout.end();
});
