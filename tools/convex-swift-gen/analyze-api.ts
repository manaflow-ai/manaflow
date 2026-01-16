import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type FunctionInfo = {
  path: string;
  kind: string;
  visibility: string;
  argsType: string;
  returnType: string;
};

type AnalysisReport = {
  functionCount: number;
  byKind: Record<string, number>;
  byVisibility: Record<string, number>;
  argsPatterns: Record<string, number>;
  returnPatterns: Record<string, number>;
  containsAny: number;
  containsUnknown: number;
  functions: FunctionInfo[];
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const apiDtsPath = join(repoRoot, "packages", "convex", "convex", "_generated", "api.d.ts");
const outDir = join(here, "out");
const outPath = join(outDir, "api-analysis.json");

mkdirSync(outDir, { recursive: true });

const program = ts.createProgram([apiDtsPath], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
});

const checker = program.getTypeChecker();
const sourceFile = program.getSourceFile(apiDtsPath);
if (!sourceFile) {
  console.error(`Unable to load ${apiDtsPath}`);
  process.exit(1);
}

const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
if (!moduleSymbol) {
  console.error("Unable to resolve module symbol for api.d.ts");
  process.exit(1);
}

const exports = checker.getExportsOfModule(moduleSymbol);
const apiSymbol = exports.find((symbol) => symbol.getName() === "api");
const internalSymbol = exports.find((symbol) => symbol.getName() === "internal");

if (!apiSymbol || !internalSymbol) {
  console.error("Unable to locate api/internal exports in api.d.ts");
  process.exit(1);
}

const functions: FunctionInfo[] = [];

collectFunctions(apiSymbol, "api");
collectFunctions(internalSymbol, "internal");

const patterns = [
  "Id<",
  "Doc<",
  "PaginationResult<",
  "PaginationOptions",
  "null",
  "undefined",
  "Record<",
  "Array<",
  "Promise<",
  "ConvexHttpRequest",
  "ConvexHttpResponse",
];

const report: AnalysisReport = {
  functionCount: functions.length,
  byKind: countBy(functions, (info) => info.kind),
  byVisibility: countBy(functions, (info) => info.visibility),
  argsPatterns: countPattern(functions.map((info) => info.argsType), patterns),
  returnPatterns: countPattern(functions.map((info) => info.returnType), patterns),
  containsAny: countMatches(functions, (info) => typeIncludes(info.argsType, "any") || typeIncludes(info.returnType, "any")),
  containsUnknown: countMatches(
    functions,
    (info) => typeIncludes(info.argsType, "unknown") || typeIncludes(info.returnType, "unknown")
  ),
  functions: functions.sort((a, b) => a.path.localeCompare(b.path)),
};

writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`Wrote ${outPath}`);

function collectFunctions(root: ts.Symbol, rootName: string): void {
  const rootType = checker.getTypeOfSymbolAtLocation(root, root.valueDeclaration ?? sourceFile);
  walkType(rootType, [rootName]);
}

function walkType(type: ts.Type, path: string[]): void {
  const properties = checker.getPropertiesOfType(type);
  for (const prop of properties) {
    const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? sourceFile);
    const propName = prop.getName();

    if (isFunctionReferenceType(propType)) {
      const info = extractFunctionInfo(propType, path.concat(propName).join("."));
      functions.push(info);
      continue;
    }

    if (checker.getPropertiesOfType(propType).length > 0) {
      walkType(propType, path.concat(propName));
    }
  }
}

function isFunctionReferenceType(type: ts.Type): boolean {
  return Boolean(
    checker.getPropertyOfType(type, "_type") &&
      checker.getPropertyOfType(type, "_visibility") &&
      checker.getPropertyOfType(type, "_args") &&
      checker.getPropertyOfType(type, "_returnType")
  );
}

function extractFunctionInfo(type: ts.Type, path: string): FunctionInfo {
  const typeSymbol = checker.getPropertyOfType(type, "_type");
  const visibilitySymbol = checker.getPropertyOfType(type, "_visibility");
  const argsSymbol = checker.getPropertyOfType(type, "_args");
  const returnSymbol = checker.getPropertyOfType(type, "_returnType");

  if (!typeSymbol || !visibilitySymbol || !argsSymbol || !returnSymbol) {
    return {
      path,
      kind: "unknown",
      visibility: "unknown",
      argsType: "unknown",
      returnType: "unknown",
    };
  }

  const typeLiteral = typeToString(typeSymbol);
  const visibilityLiteral = typeToString(visibilitySymbol);
  const argsType = typeToString(argsSymbol);
  const returnType = typeToString(returnSymbol);

  return {
    path,
    kind: typeLiteral,
    visibility: visibilityLiteral,
    argsType,
    returnType,
  };
}

function typeToString(symbol: ts.Symbol): string {
  const node = symbol.valueDeclaration ?? sourceFile;
  const valueType = checker.getTypeOfSymbolAtLocation(symbol, node);
  return checker.typeToString(valueType, node, ts.TypeFormatFlags.NoTruncation);
}

function countBy(items: FunctionInfo[], key: (info: FunctionInfo) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function countPattern(values: string[], patterns: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const pattern of patterns) {
    result[pattern] = 0;
  }

  for (const value of values) {
    for (const pattern of patterns) {
      if (value.includes(pattern)) {
        result[pattern] = (result[pattern] ?? 0) + 1;
      }
    }
  }

  return result;
}

function countMatches(items: FunctionInfo[], predicate: (info: FunctionInfo) => boolean): number {
  let count = 0;
  for (const item of items) {
    if (predicate(item)) count += 1;
  }
  return count;
}

function typeIncludes(value: string, token: string): boolean {
  const parts = value.split(/[^A-Za-z0-9_]+/).filter(Boolean);
  return parts.includes(token);
}
