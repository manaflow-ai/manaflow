import type { PrReviewOptions } from "./options";

export interface PersistArtifactOptions {
  append?: boolean;
}

export interface StrategyPrepareContext {
  filePath: string;
  diff: string;
  formattedDiff: string[];
  options: PrReviewOptions;
  artifactsDir: string;
  workspaceDir: string;
  log: (header: string, body: string) => void;
  persistArtifact: (
    relativePath: string,
    content: string,
    options?: PersistArtifactOptions
  ) => Promise<string>;
}

export interface StrategyPrepareResult {
  prompt: string;
  outputSchema?: unknown;
  metadata?: Record<string, unknown>;
}

export interface StrategyProcessContext {
  filePath: string;
  responseText: string;
  events: AsyncIterable<unknown> | null;
  options: PrReviewOptions;
  metadata?: Record<string, unknown>;
  log: (header: string, body: string) => void;
  workspaceDir: string;
  persistArtifact: (
    relativePath: string,
    content: string,
    options?: PersistArtifactOptions
  ) => Promise<string>;
}

export interface StrategyRunResult {
  rawResponse: string;
  artifacts?: StrategyArtifact[];
  annotations?: StrategyAnnotation[];
  summary?: string;
}

export interface StrategyArtifact {
  label: string;
  relativePath: string;
}

export interface StrategyAnnotation {
  lineNumber?: number | null;
  lineContent?: string | null;
  shouldBeReviewedScore: number;
  mostImportantWord?: string | null;
  highlightPhrase?: string | null;
  comment?: string | null;
}

export interface ReviewStrategy {
  id: string;
  displayName: string;
  prepare(context: StrategyPrepareContext): Promise<StrategyPrepareResult>;
  process(context: StrategyProcessContext): Promise<StrategyRunResult>;
}
