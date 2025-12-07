#!/usr/bin/env bun
/**
 * Convex Upload MCP Server
 *
 * A minimal MCP server that provides an image upload tool for browser agents.
 * This server reads the Convex URL from /root/.xagi/config.json and uploads
 * images to the Convex storage endpoint.
 *
 * Usage:
 *   bun /root/mcp/convex-upload.ts
 *
 * The tool returns the public URL and instructions to render the image in markdown.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Config interface
interface XagiConfig {
  convexUrl: string;
  jwt: string;
}

// Cached config
let cachedConfig: XagiConfig | null = null;

// Load config from /root/.xagi/config.json
async function loadConfig(): Promise<XagiConfig | null> {
  if (cachedConfig) return cachedConfig;

  const configPath = "/root/.xagi/config.json";
  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();
    if (!exists) {
      console.error("[convex-upload] Config file not found:", configPath);
      return null;
    }
    const content = await file.text();
    cachedConfig = JSON.parse(content) as XagiConfig;
    console.error("[convex-upload] Config loaded successfully");
    return cachedConfig;
  } catch (error) {
    console.error("[convex-upload] Failed to load config:", error);
    return null;
  }
}

// Derive upload endpoint from convexUrl (which points to /opencode_hook)
function getUploadUrl(config: XagiConfig): string {
  // convexUrl is like "https://xxx.convex.site/opencode_hook"
  // We need "https://xxx.convex.site/upload_image"
  const baseUrl = config.convexUrl.replace(/\/opencode_hook$/, "");
  return `${baseUrl}/upload_image`;
}

// Create MCP server
const server = new Server(
  {
    name: "convex-upload",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "upload_image",
        description: `Upload an image to Convex storage and get a public URL.
Use this tool after taking a screenshot or capturing an image to make it permanently accessible.
You can provide either a file path OR base64 data.
The tool returns a public URL that you MUST render in your response using markdown image syntax.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description:
                "Absolute path to an image file on disk (e.g., '/tmp/screenshot.png'). Use this OR data, not both.",
            },
            data: {
              type: "string",
              description:
                "Base64-encoded image data. Can be raw base64 or a data URL (data:image/png;base64,...). Use this OR path, not both.",
            },
            filename: {
              type: "string",
              description:
                "Optional filename for the image (e.g., 'screenshot.png'). Defaults to basename of path or 'screenshot-{timestamp}.png'.",
            },
            mimeType: {
              type: "string",
              description:
                "Optional MIME type (e.g., 'image/png', 'image/jpeg'). Defaults to 'image/png' or inferred from file extension.",
            },
            description: {
              type: "string",
              description:
                "A brief description of what the image shows. This will be used as alt text.",
            },
          },
          required: [],
        },
      },
    ],
  };
});

// Infer MIME type from file extension
function inferMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "upload_image") {
    return {
      content: [
        {
          type: "text" as const,
          text: `Unknown tool: ${request.params.name}`,
        },
      ],
      isError: true,
    };
  }

  const args = request.params.arguments as {
    path?: string;
    data?: string;
    filename?: string;
    mimeType?: string;
    description?: string;
  };

  // Must provide either path or data
  if (!args.path && !args.data) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Error: Must provide either 'path' (absolute file path) or 'data' (base64-encoded image)",
        },
      ],
      isError: true,
    };
  }

  // If path is provided, read the file and convert to base64
  let imageData = args.data;
  let filename = args.filename;
  let mimeType = args.mimeType;

  if (args.path) {
    try {
      const file = Bun.file(args.path);
      const exists = await file.exists();
      if (!exists) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: File not found: ${args.path}`,
            },
          ],
          isError: true,
        };
      }

      // Read file and convert to base64
      const buffer = await file.arrayBuffer();
      imageData = Buffer.from(buffer).toString("base64");

      // Use filename from path if not provided
      if (!filename) {
        filename = args.path.split("/").pop() || "screenshot.png";
      }

      // Infer MIME type from extension if not provided
      if (!mimeType) {
        mimeType = inferMimeType(args.path);
      }

      console.error(`[convex-upload] Read file from ${args.path} (${buffer.byteLength} bytes)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error reading file ${args.path}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Load config
  const config = await loadConfig();
  if (!config) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Error: Could not load config from /root/.xagi/config.json. Make sure the config file exists.",
        },
      ],
      isError: true,
    };
  }

  const uploadUrl = getUploadUrl(config);
  console.error(`[convex-upload] Uploading to ${uploadUrl}`);

  try {
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: imageData,
        filename: filename,
        mimeType: mimeType,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        content: [
          {
            type: "text" as const,
            text: `Error uploading image: ${response.status} ${text}`,
          },
        ],
        isError: true,
      };
    }

    const result = (await response.json()) as {
      success: boolean;
      url?: string;
      storageId?: string;
      filename?: string;
      error?: string;
    };

    if (!result.success || !result.url) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error uploading image: ${result.error || "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }

    const altText = args.description || args.filename || "Screenshot";
    const markdownImage = `![${altText}](${result.url})`;

    return {
      content: [
        {
          type: "text" as const,
          text: `Image uploaded successfully!

**URL:** ${result.url}
**Storage ID:** ${result.storageId}
**Filename:** ${result.filename}

You may include this image in your response using markdown:

${markdownImage}

Note: Only convex.cloud URLs can be rendered as images. External URLs will not display - always upload screenshots first to get a convex.cloud URL.`,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[convex-upload] Upload error:", errorMessage);
    return {
      content: [
        {
          type: "text" as const,
          text: `Error uploading image: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[convex-upload] MCP server started");
}

main().catch((error) => {
  console.error("[convex-upload] Fatal error:", error);
  process.exit(1);
});
