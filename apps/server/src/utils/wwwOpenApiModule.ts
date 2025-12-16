import { serverLogger } from "./fileLogger";

const IMPORT_RETRY_ATTEMPTS = 20;
const IMPORT_RETRY_BASE_DELAY_MS = 250;

type WwwOpenApiModule = typeof import("@cmux/www-openapi-client");
type WwwOpenApiClientModule = typeof import("@cmux/www-openapi-client/client");

type Importer<T> = () => Promise<T>;

let openApiModulePromise: Promise<WwwOpenApiModule> | null = null;
let openApiClientModulePromise: Promise<WwwOpenApiClientModule> | null = null;

function isModuleNotFoundError(error: unknown, moduleName: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const errorWithCode = error as { code?: string; message: string };
  const code = errorWithCode.code;
  if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
    return true;
  }
  return error.message.includes(moduleName);
}

async function importWithRetry<T>(
  moduleName: string,
  importer: Importer<T>
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < IMPORT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const result = await importer();
      if (attempt > 0) {
        serverLogger.info(
          `[OpenAPI] Successfully imported ${moduleName} after ${attempt + 1} attempts`
        );
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!isModuleNotFoundError(error, moduleName)) {
        throw error;
      }

      const delay = IMPORT_RETRY_BASE_DELAY_MS * (attempt + 1);
      serverLogger.warn(
        `[OpenAPI] ${moduleName} not available yet (attempt ${
          attempt + 1
        }/${IMPORT_RETRY_ATTEMPTS}). Retrying in ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  serverLogger.error(
    `[OpenAPI] Failed to import ${moduleName} after ${IMPORT_RETRY_ATTEMPTS} attempts`,
    lastError
  );
  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to import ${moduleName}`);
}

export function getWwwOpenApiModule(): Promise<WwwOpenApiModule> {
  if (!openApiModulePromise) {
    openApiModulePromise = importWithRetry("@cmux/www-openapi-client", () =>
      import("@cmux/www-openapi-client")
    );
  }
  return openApiModulePromise;
}

export function getWwwOpenApiClientModule(): Promise<WwwOpenApiClientModule> {
  if (!openApiClientModulePromise) {
    openApiClientModulePromise = importWithRetry(
      "@cmux/www-openapi-client/client",
      () => import("@cmux/www-openapi-client/client")
    );
  }
  return openApiClientModulePromise;
}
