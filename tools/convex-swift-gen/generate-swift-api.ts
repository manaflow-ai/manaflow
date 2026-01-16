import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type CliOptions = {
  apiPath: string;
  outFile: string;
  include: string[];
  format: boolean;
};

type FunctionShape = {
  path: string;
  argsType: ts.Type;
  returnType: ts.Type;
};

type FieldSchema = {
  name: string;
  schema: Schema;
  optional: boolean;
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

  const selected = selectFunctions(functions, options.include);
  if (selected.length === 0) {
    throw new Error(`No functions matched: ${options.include.join(", ")}`);
  }

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

    const optionalSuffix = returnSchema.optional && !returnType.type.endsWith("?") ? "?" : "";
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
  let include: string[] = [
    "acp.startConversation",
    "acp.sendMessage",
    "conversationMessages.listByConversation",
    "conversations.list",
    "teams.listTeamMemberships",
    "codexTokens.get",
  ];
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

    if (arg === "--api" || arg === "--out" || arg === "--include") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`Missing value after ${arg}.`);
      }
      if (arg === "--api") {
        apiPath = resolve(repoRoot, value);
      } else if (arg === "--out") {
        outFile = resolve(repoRoot, value);
      } else {
        include = value
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { apiPath, outFile, include, format };
}

function printUsage(): void {
  const lines = [
    "Usage:",
    "  bun run tools/convex-swift-gen/generate-swift-api.ts --include tasks.get",
    "",
    "Options:",
    `  --api=PATH      Defaults to ${defaultApiPath}`,
    `  --out=PATH      Defaults to ${defaultOutFile}`,
    "  --include=LIST  Comma-separated function paths (default: tasks.get + related)",
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
        if (!argsSymbol || !returnSymbol) continue;
        const argsType = checker.getTypeOfSymbolAtLocation(
          argsSymbol,
          argsSymbol.valueDeclaration ?? sourceFile
        );
        const returnType = checker.getTypeOfSymbolAtLocation(
          returnSymbol,
          returnSymbol.valueDeclaration ?? sourceFile
        );
        result.push({ path: path.concat(propName).join("."), argsType, returnType });
        continue;
      }

      if (checker.getPropertiesOfType(propType).length > 0) {
        walkType(propType, path.concat(propName));
      }
    }
  }
}

function selectFunctions(functions: FunctionShape[], include: string[]): FunctionShape[] {
  const normalized = include.map((entry) => normalizeFunctionPath(entry));
  return functions.filter((fn) => normalized.includes(fn.path));
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
    const optionalSuffix = field.optional && !swift.type.endsWith("?") ? "?" : "";
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
          const optionalSuffix = field.optional && !swift.type.endsWith("?") ? "?" : "";
          const wrapper = field.optional && swift.wrapper === "@ConvexFloat"
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
          const optionalSuffix = field.optional && !swift.type.endsWith("?") ? "?" : "";
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
  sourceFile: ts.SourceFile
): { schema: Schema; optional: boolean } {
  const { baseType, optional } = unwrapOptional(checker, type);

  const typeString = checker.typeToString(baseType, sourceFile, ts.TypeFormatFlags.NoTruncation);
  const idMatch =
    /^Id<"([^"]+)">$/.exec(typeString) ?? /^import\(.+\)\.Id<"([^"]+)">$/.exec(typeString);
  const aliasName = baseType.aliasSymbol?.getName();
  if (aliasName === "Id" || idMatch) {
    return { schema: { kind: "id", table: idMatch?.[1] ?? null }, optional };
  }

  if (isStringType(baseType)) return { schema: { kind: "string" }, optional };
  if (isBooleanType(baseType)) return { schema: { kind: "boolean" }, optional };
  if (isNumberType(baseType)) return { schema: { kind: "number" }, optional };

  if (checker.isArrayType(baseType)) {
    const element = checker.getElementTypeOfArrayType(baseType);
    if (element) {
      const inner = schemaFromType(checker, element, sourceFile);
      return { schema: { kind: "array", element: inner.schema }, optional };
    }
  }

  const indexType = baseType.getStringIndexType();
  if (indexType) {
    const inner = schemaFromType(checker, indexType, sourceFile);
    return { schema: { kind: "record", value: inner.schema }, optional };
  }

  if (baseType.isUnion()) {
    const literals = extractStringLiteralUnion(checker, baseType, sourceFile);
    if (literals) {
      return { schema: { kind: "enum", cases: literals }, optional };
    }
  }

  const objectFields = extractObjectFields(checker, baseType, sourceFile);
  if (objectFields) {
    return { schema: { kind: "object", fields: objectFields }, optional };
  }

  return { schema: { kind: "unknown" }, optional };
}

function unwrapOptional(
  checker: ts.TypeChecker,
  type: ts.Type
): { baseType: ts.Type; optional: boolean } {
  if (!type.isUnion()) return { baseType: type, optional: false };

  const remaining = type.types.filter((member) => !isNullOrUndefined(checker, member));
  const optional = remaining.length !== type.types.length;
  if (remaining.length === 1) {
    return { baseType: remaining[0], optional };
  }

  if (remaining.length === 0) {
    return { baseType: type, optional: true };
  }

  const unionType = checker.getUnionType(remaining, ts.UnionReduction.None);
  return { baseType: unionType, optional };
}

function isNullOrUndefined(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.flags & ts.TypeFlags.Null) return true;
  if (type.flags & ts.TypeFlags.Undefined) return true;
  const typeString = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  return typeString === "null" || typeString === "undefined";
}

function extractStringLiteralUnion(
  checker: ts.TypeChecker,
  type: ts.Type,
  sourceFile: ts.SourceFile
): string[] | null {
  if (!type.isUnion()) return null;
  const values: string[] = [];
  for (const member of type.types) {
    const text = checker.typeToString(member, sourceFile, ts.TypeFormatFlags.NoTruncation);
    if (!/^".*"$/.test(text)) return null;
    values.push(text.slice(1, -1));
  }
  return values.length > 0 ? values : null;
}

function extractObjectFields(
  checker: ts.TypeChecker,
  type: ts.Type,
  sourceFile: ts.SourceFile
): FieldSchema[] | null {
  if (type.isIntersection()) {
    const merged: FieldSchema[] = [];
    for (const member of type.types) {
      const memberFields = extractObjectFields(checker, member, sourceFile);
      if (!memberFields) return null;
      merged.push(...memberFields);
    }
    return merged;
  }

  const properties = checker.getPropertiesOfType(type);
  if (properties.length === 0) return null;

  return properties.map((prop) => {
    const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? sourceFile);
    const schemaResult = schemaFromType(checker, propType, sourceFile);
    const optional = schemaResult.optional || (prop.flags & ts.SymbolFlags.Optional) !== 0;
    return {
      name: prop.getName(),
      schema: schemaResult.schema,
      optional,
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
