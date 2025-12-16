#!/usr/bin/env bun

/**
 * Verify that the Content-Length header for one or more URLs matches the
 * number of bytes actually returned when the response body is downloaded.
 *
 * Usage:
 *   bun scripts/verify-content-length.ts <url> [<url> ...]
 *
 * Uses `Accept-Encoding: identity` to avoid transparently compressed bodies,
 * so the byte counts should line up with the advertised length.
 */

import { exit } from "node:process";

type VerificationResult =
  | { kind: "match"; url: string; headerLength: number }
  | { kind: "mismatch"; url: string; headerLength: number; actualLength: number }
  | { kind: "missing"; url: string }
  | { kind: "httpError"; url: string; status: number }
  | { kind: "requestError"; url: string; error: string };

async function verifyContentLength(url: string): Promise<VerificationResult> {
  try {
    const response = await fetch(url, {
      headers: {
        "accept-encoding": "identity",
      },
      redirect: "manual",
    });

    if (!response.ok) {
      return { kind: "httpError", url, status: response.status };
    }

    const headerValue = response.headers.get("content-length");

    if (headerValue === null) {
      return { kind: "missing", url };
    }

    const headerLength = Number.parseInt(headerValue, 10);

    if (Number.isNaN(headerLength)) {
      return { kind: "missing", url };
    }

    const body = new Uint8Array(await response.arrayBuffer());
    const actualLength = body.byteLength;

    if (actualLength === headerLength) {
      return { kind: "match", url, headerLength };
    }

    return { kind: "mismatch", url, headerLength, actualLength };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown request error";
    return { kind: "requestError", url, error: message };
  }
}

async function main(): Promise<void> {
  const urls = process.argv.slice(2);

  if (urls.length === 0) {
    console.error(
      "Usage: bun scripts/verify-content-length.ts <url> [<url> ...]",
    );
    exit(1);
  }

  let hadProblem = false;

  for (const url of urls) {
    const result = await verifyContentLength(url);

    switch (result.kind) {
      case "match": {
        console.log(
          `${url} ✓ Content-Length = ${result.headerLength} bytes (verified)`,
        );
        break;
      }
      case "mismatch": {
        hadProblem = true;
        console.error(
          `${url} ✗ Content-Length mismatch (header ${result.headerLength} bytes, actual ${result.actualLength} bytes)`,
        );
        break;
      }
      case "missing": {
        hadProblem = true;
        console.error(`${url} ✗ Content-Length header missing or invalid`);
        break;
      }
      case "httpError": {
        hadProblem = true;
        console.error(
          `${url} ✗ HTTP ${result.status} while downloading response`,
        );
        break;
      }
      case "requestError": {
        hadProblem = true;
        console.error(`${url} ✗ Request failed: ${result.error}`);
        break;
      }
      default: {
        const exhaustiveCheck: never = result;
        throw new Error(`Unhandled result: ${exhaustiveCheck}`);
      }
    }
  }

  if (hadProblem) {
    exit(2);
  }
}

void main();
