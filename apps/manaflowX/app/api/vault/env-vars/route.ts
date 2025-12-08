import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/stack/server";

// Environment variable type
interface EnvVar {
  key: string;
  value: string;
}

// Store ID for the Data Vault
const STORE_ID = "xagi";

// Get the vault secret from environment
function getVaultSecret(): string {
  const secret = process.env.STACK_DATA_VAULT_SECRET;
  if (!secret) {
    throw new Error("STACK_DATA_VAULT_SECRET environment variable is not set");
  }
  return secret;
}

// GET /api/vault/env-vars?repoId=xxx
// Retrieves environment variables for a repo from the Data Vault
export async function GET(request: NextRequest) {
  try {
    // Get the current user
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get repoId from query params
    const repoId = request.nextUrl.searchParams.get("repoId");
    if (!repoId) {
      return NextResponse.json(
        { error: "repoId is required" },
        { status: 400 }
      );
    }

    // Get the Data Vault store
    const store = await stackServerApp.getDataVaultStore(STORE_ID);

    // Build the key: env:{userId}:{repoId}
    const key = `env:${user.id}:${repoId}`;

    // Get the encrypted value from the vault
    const value = await store.getValue(key, { secret: getVaultSecret() });

    if (!value) {
      return NextResponse.json({ envVars: [] });
    }

    // Parse the JSON value
    const envVars: EnvVar[] = JSON.parse(value);
    return NextResponse.json({ envVars });
  } catch (error) {
    console.error("[Vault] Failed to get env vars:", error);
    return NextResponse.json(
      { error: "Failed to retrieve environment variables" },
      { status: 500 }
    );
  }
}

// POST /api/vault/env-vars
// Stores environment variables for a repo in the Data Vault
export async function POST(request: NextRequest) {
  try {
    // Get the current user
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse the request body
    const { repoId, envVars } = (await request.json()) as {
      repoId: string;
      envVars: EnvVar[];
    };

    if (!repoId) {
      return NextResponse.json(
        { error: "repoId is required" },
        { status: 400 }
      );
    }

    // Get the Data Vault store
    const store = await stackServerApp.getDataVaultStore(STORE_ID);

    // Build the key: env:{userId}:{repoId}
    const key = `env:${user.id}:${repoId}`;

    // Filter out empty env vars
    const filteredEnvVars = (envVars || []).filter(
      (env) => env.key.trim() !== ""
    );

    // Store the encrypted value
    await store.setValue(key, JSON.stringify(filteredEnvVars), {
      secret: getVaultSecret(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Vault] Failed to set env vars:", error);
    return NextResponse.json(
      { error: "Failed to store environment variables" },
      { status: 500 }
    );
  }
}

// DELETE /api/vault/env-vars?repoId=xxx
// Deletes environment variables for a repo from the Data Vault
export async function DELETE(request: NextRequest) {
  try {
    // Get the current user
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get repoId from query params
    const repoId = request.nextUrl.searchParams.get("repoId");
    if (!repoId) {
      return NextResponse.json(
        { error: "repoId is required" },
        { status: 400 }
      );
    }

    // Get the Data Vault store
    const store = await stackServerApp.getDataVaultStore(STORE_ID);

    // Build the key: env:{userId}:{repoId}
    const key = `env:${user.id}:${repoId}`;

    // Set to empty array (Data Vault doesn't have delete, but empty value works)
    await store.setValue(key, JSON.stringify([]), {
      secret: getVaultSecret(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Vault] Failed to delete env vars:", error);
    return NextResponse.json(
      { error: "Failed to delete environment variables" },
      { status: 500 }
    );
  }
}
