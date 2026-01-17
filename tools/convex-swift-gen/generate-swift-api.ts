import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type CliOptions = {
  apiPath: string;
  outFile: string;
  include: string[];
  exclude: string[];
  format: boolean;
};

type FunctionShape = {
  path: string;
  visibility: "public" | "internal";
  argsType: ts.Type;
  returnType: ts.Type;
};

type FieldSchema = {
  name: string;
  schema: Schema;
  optional: boolean;
  nullable: boolean;
};

type Schema =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "id"; table: string | null }
  | { kind: "array"; element: Schema }
  | { kind: "record"; value: Schema }
  | { kind: "object"; fields: FieldSchema[] }
  | { kind: "enum"; cases: string[] }
  | { kind: "unknown" };

type SwiftType = {
  type: string;
  wrapper: string | null;
};

type SwiftDefs = {
  structs: Map<string, string>;
  enums: Map<string, string>;
  idTables: Set<string>;
};

type SwiftArgStruct = {
  name: string;
  body: string;
};

type TypeVisitContext = {
  visitedTypeIds: Set<number>;
  depth: number;
};

// Maximum recursion depth for type traversal - handles any reasonable nesting while catching pathological cases
const MAX_TYPE_DEPTH = 30;

// Built-in JavaScript prototype properties that should be filtered out from object fields.
// These appear when TypeScript's getPropertiesOfType expands primitive wrapper types.
const builtInProperties = new Set<string>([
  // String prototype
  "toString", "charAt", "charCodeAt", "concat", "indexOf", "lastIndexOf",
  "localeCompare", "match", "replace", "search", "slice", "split",
  "substring", "toLowerCase", "toUpperCase", "trim", "trimLeft", "trimRight",
  "trimStart", "trimEnd", "padStart", "padEnd", "repeat", "startsWith",
  "endsWith", "includes", "normalize", "at", "matchAll", "replaceAll",
  "toLocaleLowerCase", "toLocaleUpperCase", "valueOf", "codePointAt",
  "substr", "anchor", "big", "blink", "bold", "fixed", "fontcolor",
  "fontsize", "italics", "link", "small", "strike", "sub", "sup",
  // Number prototype
  "toFixed", "toExponential", "toPrecision", "toLocaleString",
  // Array prototype (but NOT length - it's commonly used in user schemas)
  "pop", "push", "shift", "unshift", "reverse", "sort",
  "splice", "join", "every", "some", "forEach", "map", "filter",
  "reduce", "reduceRight", "find", "findIndex", "fill", "copyWithin",
  "entries", "keys", "values", "flat", "flatMap", "findLast", "findLastIndex",
  "toReversed", "toSorted", "toSpliced", "with",
  // Object prototype
  "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__",
  "__lookupSetter__",
]);

function isBuiltInProperty(name: string): boolean {
  // Check for well-known symbols like __@iterator@123
  if (name.startsWith("__@") || name.startsWith("@@")) return true;
  if (builtInProperties.has(name)) return true;
  return false;
}

const swiftKeywords = new Set<string>([
  "associatedtype",
  "class",
  "deinit",
  "enum",
  "extension",
  "fileprivate",
  "func",
  "import",
  "init",
  "inout",
  "internal",
  "let",
  "open",
  "operator",
  "private",
  "protocol",
  "public",
  "static",
  "struct",
  "subscript",
  "typealias",
  "var",
  "break",
  "case",
  "continue",
  "default",
  "defer",
  "do",
  "else",
  "fallthrough",
  "for",
  "guard",
  "if",
  "in",
  "repeat",
  "return",
  "switch",
  "where",
  "while",
  "as",
  "Any",
  "catch",
  "false",
  "is",
  "nil",
  "rethrows",
  "super",
  "self",
  "Self",
  "throw",
  "throws",
  "true",
  "try",
]);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const defaultApiPath = join(repoRoot, "packages", "convex", "convex", "_generated", "api.d.ts");
const defaultOutFile = join(repoRoot, "ios-app", "Sources", "Generated", "ConvexApiTypes.swift");

try {
  const options = parseArgs(process.argv.slice(2));
  const outDir = dirname(options.outFile);
  mkdirSync(outDir, { recursive: true });

  const program = ts.createProgram([options.apiPath], {
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
  const sourceFile = program.getSourceFile(options.apiPath);
  if (!sourceFile) {
    throw new Error(`Unable to load ${options.apiPath}`);
  }

  const apiSymbol = getApiSymbol(checker, sourceFile, "api");
  const functions = collectFunctions(checker, sourceFile, apiSymbol);

  const selected = selectFunctions(functions, options.include, options.exclude);
  if (selected.length === 0) {
    if (options.include.length > 0) {
      throw new Error(`No functions matched: ${options.include.join(", ")}`);
    }
    throw new Error("No public functions found in the API");
  }

  console.log(
    `Generating types for ${selected.length} function(s): ${selected.map((fn) => fn.path.replace(/^api\./, "")).join(", ")}`
  );

  const defs: SwiftDefs = {
    structs: new Map<string, string>(),
    enums: new Map<string, string>(),
    idTables: new Set<string>(),
  };

  const swiftArgStructs: SwiftArgStruct[] = [];
  const returnAliases: string[] = [];

  for (const func of selected) {
    const baseName = functionBaseName(func.path);
    const argStruct = buildArgsStruct(checker, defs, baseName, func.argsType, sourceFile);
    swiftArgStructs.push(argStruct);

    const returnName = `${baseName}Return`;
    const returnSchema = schemaFromType(checker, func.returnType, sourceFile);
    const returnType = renderSwiftType(
      checker,
      defs,
      returnSchema.schema,
      [baseName, "Return"],
      sourceFile,
      {
        preferArrayItemName: `${baseName}Item`,
      }
    );

    const isOptionalReturn = returnSchema.optional || returnSchema.nullable;
    const optionalSuffix = isOptionalReturn && !returnType.type.endsWith("?") ? "?" : "";
    const resolvedReturn = `${stripOptional(returnType.type)}${optionalSuffix}`;
    const baseReturn = stripOptional(resolvedReturn);
    if (resolvedReturn !== returnName && baseReturn !== returnName) {
      returnAliases.push(`typealias ${returnName} = ${resolvedReturn}`);
    }
  }

  const content = renderSwiftFile(defs, swiftArgStructs, returnAliases, options.apiPath, selected);
  writeFileSync(options.outFile, content, "utf8");

  if (options.format) {
    runSwiftFormat(options.outFile);
  }

  console.log(`Wrote ${options.outFile}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  let apiPath = defaultApiPath;
  let outFile = defaultOutFile;
  let include: string[] = []; // Empty means "all public functions"
  let exclude: string[] = [];
  let format = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--no-format") {
      format = false;
      continue;
    }

    if (arg === "--format") {
      format = true;
      continue;
    }

    if (arg === "--api" || arg === "--out" || arg === "--include" || arg === "--exclude") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`Missing value after ${arg}.`);
      }
      if (arg === "--api") {
        apiPath = resolve(repoRoot, value);
      } else if (arg === "--out") {
        outFile = resolve(repoRoot, value);
      } else if (arg === "--include") {
        include = value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
      } else {
        exclude = value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--api=")) {
      apiPath = resolve(repoRoot, arg.slice("--api=".length));
      continue;
    }

    if (arg.startsWith("--out=")) {
      outFile = resolve(repoRoot, arg.slice("--out=".length));
      continue;
    }

    if (arg.startsWith("--include=")) {
      include = arg
        .slice("--include=".length)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      continue;
    }

    if (arg.startsWith("--exclude=")) {
      exclude = arg
        .slice("--exclude=".length)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { apiPath, outFile, include, exclude, format };
}

function printUsage(): void {
  const lines = [
    "Usage:",
    "  bun run tools/convex-swift-gen/generate-swift-api.ts",
    "",
    "By default, generates types for ALL public (non-internal) Convex functions.",
    "",
    "Options:",
    `  --api=PATH      Defaults to ${defaultApiPath}`,
    `  --out=PATH      Defaults to ${defaultOutFile}`,
    "  --include=LIST  Comma-separated function paths (overrides default of all public)",
    "  --exclude=LIST  Comma-separated function paths to exclude",
    "  --format        Run swift-format after generating (default: true)",
    "  --no-format     Disable formatting",
  ];
  console.log(lines.join("\n"));
}

function getApiSymbol(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  exportName: string
): ts.Symbol {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error("Unable to resolve module symbol for api.d.ts");
  }
  const exports = checker.getExportsOfModule(moduleSymbol);
  const symbol = exports.find((item) => item.getName() === exportName);
  if (!symbol) {
    throw new Error(`Unable to locate ${exportName} export in api.d.ts`);
  }
  return symbol;
}

function collectFunctions(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  apiSymbol: ts.Symbol
): FunctionShape[] {
  const result: FunctionShape[] = [];
  const rootType = checker.getTypeOfSymbolAtLocation(apiSymbol, apiSymbol.valueDeclaration ?? sourceFile);
  walkType(rootType, ["api"]);
  return result;

  function walkType(type: ts.Type, path: string[]): void {
    const properties = checker.getPropertiesOfType(type);
    for (const prop of properties) {
      const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? sourceFile);
      const propName = prop.getName();

      if (isFunctionReferenceType(checker, propType)) {
        const argsSymbol = checker.getPropertyOfType(propType, "_args");
        const returnSymbol = checker.getPropertyOfType(propType, "_returnType");
        const visibilitySymbol = checker.getPropertyOfType(propType, "_visibility");
        if (!argsSymbol || !returnSymbol || !visibilitySymbol) continue;

        const visibilityType = checker.getTypeOfSymbolAtLocation(
          visibilitySymbol,
          visibilitySymbol.valueDeclaration ?? sourceFile
        );
        const visibilityString = safeTypeToString(checker, visibilityType, sourceFile);
        // Extract "public" or "internal" from the type string (it's a string literal type like '"public"')
        const visibility = visibilityString.replace(/"/g, "") as "public" | "internal";

        const argsType = checker.getTypeOfSymbolAtLocation(
          argsSymbol,
          argsSymbol.valueDeclaration ?? sourceFile
        );
        const returnType = checker.getTypeOfSymbolAtLocation(
          returnSymbol,
          returnSymbol.valueDeclaration ?? sourceFile
        );
        result.push({ path: path.concat(propName).join("."), visibility, argsType, returnType });
        continue;
      }

      if (checker.getPropertiesOfType(propType).length > 0) {
        walkType(propType, path.concat(propName));
      }
    }
  }
}

function selectFunctions(functions: FunctionShape[], include: string[], exclude: string[]): FunctionShape[] {
  const normalizedExclude = exclude.map((entry) => normalizeFunctionPath(entry));

  // If include list is empty, include all public functions
  if (include.length === 0) {
    return functions.filter(
      (fn) => fn.visibility === "public" && !normalizedExclude.includes(fn.path)
    );
  }

  // Otherwise, use explicit include list (still respecting exclude)
  const normalizedInclude = include.map((entry) => normalizeFunctionPath(entry));
  return functions.filter(
    (fn) => normalizedInclude.includes(fn.path) && !normalizedExclude.includes(fn.path)
  );
}

function normalizeFunctionPath(value: string): string {
  if (value.startsWith("api.")) return value;
  return `api.${value}`;
}

function functionBaseName(path: string): string {
  const trimmed = path.replace(/^api\./, "");
  return trimmed
    .split(".")
    .map((part) => pascalCase(part))
    .join("");
}

function buildArgsStruct(
  checker: ts.TypeChecker,
  defs: SwiftDefs,
  baseName: string,
  argsType: ts.Type,
  sourceFile: ts.SourceFile
): SwiftArgStruct {
  const schema = schemaFromType(checker, argsType, sourceFile);
  if (schema.schema.kind !== "object") {
    return {
      name: `${baseName}Args`,
      body: `struct ${baseName}Args {\n    // Unsupported args shape\n}`,
    };
  }

  const fields = schema.schema.fields;
  const lines: string[] = [];
  for (const field of fields) {
    const swift = renderSwiftArgType(checker, defs, field.schema, [baseName, "Args", field.name], sourceFile);
    const name = escapeSwiftIdentifier(field.name);
    const isOptional = field.optional || field.nullable;
    const optionalSuffix = isOptional && !swift.type.endsWith("?") ? "?" : "";
    const typeName = `${stripOptional(swift.type)}${optionalSuffix}`;
    lines.push(`    let ${name}: ${typeName}`);
  }

  const dictLines: string[] = [];
  dictLines.push("    func asDictionary() -> [String: ConvexEncodable?] {");
  dictLines.push("        var result: [String: ConvexEncodable?] = [:]");
  for (const field of fields) {
    const name = escapeSwiftIdentifier(field.name);
    const key = field.name;
    const valueExpr = renderConvexValueExpression(field.schema, "value");
    const directExpr = renderConvexValueExpression(field.schema, name);
    if (field.optional) {
      dictLines.push(`        if let value = ${name} { result["${key}"] = ${valueExpr} }`);
    } else if (field.nullable) {
      dictLines.push(`        if let value = ${name} { result["${key}"] = ${valueExpr} } else { result["${key}"] = ConvexNull() }`);
    } else {
      dictLines.push(`        result["${key}"] = ${directExpr}`);
    }
  }
  dictLines.push("        return result");
  dictLines.push("    }");

  const body = [
    `struct ${baseName}Args {`,
    ...lines,
    "",
    ...dictLines,
    "}",
  ].join("\n");

  return { name: `${baseName}Args`, body };
}

function renderConvexValueExpression(schema: Schema, valueExpr: string): string {
  switch (schema.kind) {
    case "array":
      return `convexEncodeArray(${valueExpr})`;
    case "record":
      return `convexEncodeRecord(${valueExpr})`;
    default:
      return valueExpr;
  }
}

function renderSwiftType(
  checker: ts.TypeChecker,
  defs: SwiftDefs,
  schema: Schema,
  path: string[],
  sourceFile: ts.SourceFile,
  options: { preferArrayItemName?: string } = {}
): SwiftType {
  switch (schema.kind) {
    case "string":
      return { type: "String", wrapper: null };
    case "boolean":
      return { type: "Bool", wrapper: null };
    case "number":
      return { type: "Double", wrapper: "@ConvexFloat" };
    case "id": {
      if (!schema.table) {
        return { type: "String", wrapper: null };
      }
      const marker = `ConvexTable${pascalCase(schema.table)}`;
      defs.idTables.add(marker);
      return { type: `ConvexId<${marker}>`, wrapper: null };
    }
    case "record": {
      const valueType = renderSwiftType(checker, defs, schema.value, path.concat("Value"), sourceFile);
      return { type: `[String: ${stripOptional(valueType.type)}]`, wrapper: null };
    }
    case "array": {
      const itemPath = options.preferArrayItemName ? [options.preferArrayItemName] : path.concat("Item");
      const itemType = renderSwiftType(
        checker,
        defs,
        schema.element,
        itemPath,
        sourceFile,
        options
      );
      return { type: `[${stripOptional(itemType.type)}]`, wrapper: null };
    }
    case "object": {
      const structName = pascalCase(path.join("_"));
      if (!defs.structs.has(structName)) {
        const fields = schema.fields.map((field) => {
          const swift = renderSwiftType(checker, defs, field.schema, path.concat(field.name), sourceFile);
          const isOptional = field.optional || field.nullable;
          const optionalSuffix = isOptional && !swift.type.endsWith("?") ? "?" : "";
          const wrapper = isOptional && swift.wrapper === "@ConvexFloat"
            ? "@OptionalConvexFloat"
            : swift.wrapper ?? "";
          const needsVar = wrapper !== "";
          const keyword = needsVar ? "var" : "let";
          const fieldName = escapeSwiftIdentifier(field.name);
          const typeName = `${stripOptional(swift.type)}${optionalSuffix}`;
          const wrapperPrefix = wrapper ? `${wrapper} ` : "";
          return `    ${wrapperPrefix}${keyword} ${fieldName}: ${typeName}`;
        });
        const body = `struct ${structName}: Decodable {\n${fields.join("\n")}\n}`;
        defs.structs.set(structName, body);
      }
      return { type: structName, wrapper: null };
    }
    case "enum": {
      const enumName = pascalCase(path.join("_")) + "Enum";
      if (!defs.enums.has(enumName)) {
        const cases = schema.cases.map((value) => {
          const caseName = escapeSwiftIdentifier(sanitizeEnumCase(value));
          return `    case ${caseName} = "${value}"`;
        });
        const body = `enum ${enumName}: String, Decodable {\n${cases.join("\n")}\n}`;
        defs.enums.set(enumName, body);
      }
      return { type: enumName, wrapper: null };
    }
    default:
      return { type: "String", wrapper: null };
  }
}

function renderSwiftArgType(
  checker: ts.TypeChecker,
  defs: SwiftDefs,
  schema: Schema,
  path: string[],
  sourceFile: ts.SourceFile
): SwiftType {
  switch (schema.kind) {
    case "string":
      return { type: "String", wrapper: null };
    case "boolean":
      return { type: "Bool", wrapper: null };
    case "number":
      return { type: "Double", wrapper: null };
    case "id": {
      if (!schema.table) {
        return { type: "String", wrapper: null };
      }
      const marker = `ConvexTable${pascalCase(schema.table)}`;
      defs.idTables.add(marker);
      return { type: `ConvexId<${marker}>`, wrapper: null };
    }
    case "record": {
      const valueType = renderSwiftArgType(checker, defs, schema.value, path.concat("Value"), sourceFile);
      return { type: `[String: ${stripOptional(valueType.type)}]`, wrapper: null };
    }
    case "array": {
      const itemType = renderSwiftArgType(checker, defs, schema.element, path.concat("Item"), sourceFile);
      return { type: `[${stripOptional(itemType.type)}]`, wrapper: null };
    }
    case "object": {
      const structName = pascalCase(path.join("_"));
      if (!defs.structs.has(structName)) {
        const fields = schema.fields.map((field) => {
          const swift = renderSwiftArgType(checker, defs, field.schema, path.concat(field.name), sourceFile);
          const fieldName = escapeSwiftIdentifier(field.name);
          const isOptional = field.optional || field.nullable;
          const optionalSuffix = isOptional && !swift.type.endsWith("?") ? "?" : "";
          const typeName = `${stripOptional(swift.type)}${optionalSuffix}`;
          return `    let ${fieldName}: ${typeName}`;
        });
        const encodeLines: string[] = [];
        encodeLines.push("    func convexEncode() throws -> String {");
        encodeLines.push("        var result: [String: ConvexEncodable?] = [:]");
        for (const field of schema.fields) {
          const fieldName = escapeSwiftIdentifier(field.name);
          const key = field.name;
          const valueExpr = renderConvexValueExpression(field.schema, "value");
          const directExpr = renderConvexValueExpression(field.schema, fieldName);
          if (field.optional) {
            encodeLines.push(`        if let value = ${fieldName} { result["${key}"] = ${valueExpr} }`);
          } else if (field.nullable) {
            encodeLines.push(`        if let value = ${fieldName} { result["${key}"] = ${valueExpr} } else { result["${key}"] = ConvexNull() }`);
          } else {
            encodeLines.push(`        result["${key}"] = ${directExpr}`);
          }
        }
        encodeLines.push("        return try result.convexEncode()");
        encodeLines.push("    }");

        const body = [
          `struct ${structName}: ConvexEncodable {`,
          ...fields,
          "",
          ...encodeLines,
          "}",
        ].join("\n");
        defs.structs.set(structName, body);
      }
      return { type: structName, wrapper: null };
    }
    case "enum": {
      const enumName = pascalCase(path.join("_")) + "Enum";
      if (!defs.enums.has(enumName)) {
        const cases = schema.cases.map((value) => {
          const caseName = escapeSwiftIdentifier(sanitizeEnumCase(value));
          return `    case ${caseName} = "${value}"`;
        });
        const body = `enum ${enumName}: String, Encodable, ConvexEncodable {\n${cases.join("\n")}\n}`;
        defs.enums.set(enumName, body);
      }
      return { type: enumName, wrapper: null };
    }
    default:
      return { type: "String", wrapper: null };
  }
}

function schemaFromType(
  checker: ts.TypeChecker,
  type: ts.Type,
  sourceFile: ts.SourceFile,
  ctx: TypeVisitContext = createVisitContext()
): { schema: Schema; optional: boolean; nullable: boolean } {
  // Check depth limit
  if (ctx.depth > MAX_TYPE_DEPTH) {
    return { schema: { kind: "unknown" }, optional: false, nullable: false };
  }

  const { baseType, optional, nullable } = unwrapOptional(checker, type);

  const typeString = safeTypeToString(checker, baseType, sourceFile);
  const idMatch =
    /^Id<"([^"]+)">$/.exec(typeString) ?? /^import\(.+\)\.Id<"([^"]+)">$/.exec(typeString);
  const aliasName = baseType.aliasSymbol?.getName();
  if (aliasName === "Id" || idMatch) {
    return { schema: { kind: "id", table: idMatch?.[1] ?? null }, optional, nullable };
  }

  if (isStringType(baseType)) return { schema: { kind: "string" }, optional, nullable };
  if (isBooleanType(baseType)) return { schema: { kind: "boolean" }, optional, nullable };
  if (isNumberType(baseType)) return { schema: { kind: "number" }, optional, nullable };

  // For complex types that can recurse, check for cycles
  const nextCtx = withVisitedType(ctx, baseType);
  if (!nextCtx) {
    // Cycle detected - return unknown to break the recursion
    return { schema: { kind: "unknown" }, optional };
  }

  if (checker.isArrayType(baseType)) {
    const element = checker.getElementTypeOfArrayType(baseType);
    if (element) {
      const inner = schemaFromType(checker, element, sourceFile, nextCtx);
      return { schema: { kind: "array", element: inner.schema }, optional, nullable };
    }
  }

  const indexType = baseType.getStringIndexType();
  if (indexType) {
    const inner = schemaFromType(checker, indexType, sourceFile, nextCtx);
    return { schema: { kind: "record", value: inner.schema }, optional, nullable };
  }

  if (baseType.isUnion()) {
    const literals = extractStringLiteralUnion(checker, baseType, sourceFile);
    if (literals) {
      return { schema: { kind: "enum", cases: literals }, optional, nullable };
    }
  }

  const objectFields = extractObjectFields(checker, baseType, sourceFile, nextCtx);
  if (objectFields) {
    return { schema: { kind: "object", fields: objectFields }, optional, nullable };
  }

  return { schema: { kind: "unknown" }, optional, nullable };
}

function unwrapOptional(
  checker: ts.TypeChecker,
  type: ts.Type
): { baseType: ts.Type; optional: boolean; nullable: boolean } {
  if (!type.isUnion()) return { baseType: type, optional: false, nullable: false };

  const nullable = type.types.some((member) => isNullType(checker, member));
  const optional = type.types.some((member) => isUndefinedType(checker, member));
  const remaining = type.types.filter(
    (member) => !isNullType(checker, member) && !isUndefinedType(checker, member)
  );
  if (remaining.length === 1) {
    return { baseType: remaining[0], optional, nullable };
  }

  if (remaining.length === 0) {
    return { baseType: type, optional: true, nullable };
  }

  const unionType = checker.getUnionType(remaining, ts.UnionReduction.None);
  return { baseType: unionType, optional, nullable };
}

function isNullType(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.flags & ts.TypeFlags.Null) return true;
  const typeString = safeTypeToString(checker, type);
  return typeString === "null";
}

function isUndefinedType(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.flags & ts.TypeFlags.Undefined) return true;
  const typeString = safeTypeToString(checker, type);
  return typeString === "undefined";
}

function extractStringLiteralUnion(
  checker: ts.TypeChecker,
  type: ts.Type,
  sourceFile: ts.SourceFile
): string[] | null {
  if (!type.isUnion()) return null;
  const values: string[] = [];
  for (const member of type.types) {
    const text = safeTypeToString(checker, member, sourceFile);
    if (!/^".*"$/.test(text)) return null;
    values.push(text.slice(1, -1));
  }
  return values.length > 0 ? values : null;
}

function extractObjectFields(
  checker: ts.TypeChecker,
  type: ts.Type,
  sourceFile: ts.SourceFile,
  ctx: TypeVisitContext
): FieldSchema[] | null {
  if (type.isIntersection()) {
    const merged: FieldSchema[] = [];
    for (const member of type.types) {
      const memberFields = extractObjectFields(checker, member, sourceFile, ctx);
      if (!memberFields) return null;
      merged.push(...memberFields);
    }
    return merged;
  }

  const properties = checker.getPropertiesOfType(type);
  if (properties.length === 0) return null;

  // Filter out built-in JavaScript prototype properties that leak through from
  // TypeScript's type checker when it expands primitive wrapper types
  const userProperties = properties.filter((prop) => !isBuiltInProperty(prop.getName()));

  if (userProperties.length === 0) return null;

  return userProperties.map((prop) => {
    const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? sourceFile);
    const schemaResult = schemaFromType(checker, propType, sourceFile, ctx);
    const optional = schemaResult.optional || (prop.flags & ts.SymbolFlags.Optional) !== 0;
    return {
      name: prop.getName(),
      schema: schemaResult.schema,
      optional,
      nullable: schemaResult.nullable,
    };
  });
}

function isFunctionReferenceType(checker: ts.TypeChecker, type: ts.Type): boolean {
  return Boolean(
    checker.getPropertyOfType(type, "_type") &&
      checker.getPropertyOfType(type, "_visibility") &&
      checker.getPropertyOfType(type, "_args") &&
      checker.getPropertyOfType(type, "_returnType")
  );
}

function isStringType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.String) !== 0;
}

function isBooleanType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Boolean) !== 0 || (type.flags & ts.TypeFlags.BooleanLiteral) !== 0;
}

function isNumberType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Number) !== 0 || (type.flags & ts.TypeFlags.NumberLiteral) !== 0;
}

function renderSwiftFile(
  defs: SwiftDefs,
  argStructs: SwiftArgStruct[],
  returnAliases: string[],
  apiPath: string,
  selected: FunctionShape[]
): string {
  const header = [
    "import ConvexMobile",
    "import Foundation",
    "",
    `// Generated from ${apiPath}`,
    `// Functions: ${selected.map((fn) => fn.path.replace(/^api\./, "")).join(", ")}`,
    "",
    "struct ConvexId<Table>: Decodable, Hashable, Sendable, ConvexEncodable {",
    "  let rawValue: String",
    "",
    "  init(rawValue: String) {",
    "    self.rawValue = rawValue",
    "  }",
    "",
    "  init(from decoder: Decoder) throws {",
    "    let container = try decoder.singleValueContainer()",
    "    rawValue = try container.decode(String.self)",
    "  }",
    "",
    "  func convexEncode() throws -> String {",
    "    try rawValue.convexEncode()",
    "  }",
    "}",
    "",
    "struct ConvexNull: ConvexEncodable {",
    "  func convexEncode() throws -> String {",
    "    \"null\"",
    "  }",
    "}",
    "",
    "private func convexEncodeArray<T: ConvexEncodable>(_ values: [T]) -> [ConvexEncodable?] {",
    "  values.map { $0 }",
    "}",
    "",
    "private func convexEncodeRecord<T: ConvexEncodable>(_ values: [String: T]) -> [String: ConvexEncodable?] {",
    "  var result: [String: ConvexEncodable?] = [:]",
    "  for (key, value) in values {",
    "    result[key] = value",
    "  }",
    "  return result",
    "}",
    "",
  ];

  const idMarkers = Array.from(defs.idTables.values()).sort().map((name) => `enum ${name} {}`);
  const enums = Array.from(defs.enums.values());
  const structs = Array.from(defs.structs.values());
  const argBodies = argStructs.map((item) => item.body);

  return header
    .concat(idMarkers)
    .concat(enums)
    .concat(structs)
    .concat(argBodies)
    .concat(returnAliases)
    .join("\n\n")
    .concat("\n");
}

function runSwiftFormat(outFile: string): void {
  const result = spawnSync("swift-format", ["-i", outFile], {
    encoding: "utf-8",
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("swift-format failed");
  }
}

function pascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function sanitizeEnumCase(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join("");

  if (!cleaned) return "value";
  if (/^[0-9]/.test(cleaned)) return `value${cleaned}`;
  return cleaned;
}

function escapeSwiftIdentifier(name: string): string {
  if (swiftKeywords.has(name)) {
    return `\`${name}\``;
  }
  return name;
}

function stripOptional(value: string): string {
  return value.endsWith("?") ? value.slice(0, -1) : value;
}

function getTypeId(type: ts.Type): number {
  // TypeScript types have internal IDs we can use for cycle detection
  return (type as { id?: number }).id ?? 0;
}

function safeTypeToString(
  checker: ts.TypeChecker,
  type: ts.Type,
  sourceFile?: ts.SourceFile,
  flags: ts.TypeFormatFlags = ts.TypeFormatFlags.NoTruncation
): string {
  try {
    return checker.typeToString(type, sourceFile, flags);
  } catch {
    return "[complex type]";
  }
}

function createVisitContext(): TypeVisitContext {
  return {
    visitedTypeIds: new Set<number>(),
    depth: 0,
  };
}

function withVisitedType(ctx: TypeVisitContext, type: ts.Type): TypeVisitContext | null {
  const typeId = getTypeId(type);
  if (typeId !== 0 && ctx.visitedTypeIds.has(typeId)) {
    // Cycle detected
    return null;
  }
  const newVisited = new Set(ctx.visitedTypeIds);
  if (typeId !== 0) {
    newVisited.add(typeId);
  }
  return {
    visitedTypeIds: newVisited,
    depth: ctx.depth + 1,
  };
}
