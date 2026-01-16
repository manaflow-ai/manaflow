import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type Schema = {
  tables: TableSchema[];
};

type TableSchema = {
  name: string;
  fields: FieldSchema[];
};

type FieldSchema = {
  name: string;
  validator: Validator;
};

type Validator =
  | { kind: "string"; optional: boolean }
  | { kind: "number"; optional: boolean }
  | { kind: "boolean"; optional: boolean }
  | { kind: "id"; optional: boolean; table: string | null }
  | { kind: "array"; optional: boolean; element: Validator }
  | { kind: "object"; optional: boolean; fields: FieldSchema[] }
  | { kind: "union"; optional: boolean; options: Validator[] }
  | { kind: "literal"; optional: boolean; value: string | number | boolean }
  | { kind: "record"; optional: boolean; key: Validator; value: Validator }
  | { kind: "any"; optional: boolean }
  | { kind: "unknown"; optional: boolean; text: string };

type Report = {
  tableCount: number;
  fieldCount: number;
  countsByKind: Record<string, number>;
  issueCount: number;
  issues: { table: string; field: string; reason: string }[];
};

type SwiftType = {
  type: string;
  wrapper: string | null;
};

type SwiftTypeHelpers = {
  defineStruct: (name: string, fields: FieldSchema[], path: string[]) => void;
  defineEnum: (name: string, values: string[]) => void;
};

type StringLiteralValidator = {
  kind: "literal";
  optional: boolean;
  value: string;
};

type CliOptions = {
  schemaPath: string;
  outFile: string;
  format: boolean;
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
const defaultSchemaPath = join(repoRoot, "packages", "convex", "convex", "schema.ts");
const defaultOutFile = join(here, "out", "ConvexTables.swift");
const defaultFormat = true;

try {
  const options = parseArgs(process.argv.slice(2));
  const schemaPath = options.schemaPath;
  const outFile = options.outFile;
  const shouldFormat = options.format;
  const outDir = dirname(outFile);
  const irPath = join(outDir, "schema-ir.json");
  const reportPath = join(outDir, "schema-report.json");

  mkdirSync(outDir, { recursive: true });

  const sourceText = readFileSync(schemaPath, "utf8");
  const sourceFile = ts.createSourceFile(
    schemaPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const schemaObject = findDefineSchemaObject(sourceFile);
  if (!schemaObject) {
    console.error("Could not locate defineSchema(...) in schema.ts");
    process.exit(1);
  }

  const schema = parseSchema(schemaObject);

  writeFileSync(irPath, JSON.stringify(schema, null, 2) + "\n", "utf8");

  const report = buildReport(schema);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const swiftOutput = generateSwift(schema);
  writeFileSync(outFile, swiftOutput, "utf8");
  if (shouldFormat) {
    runSwiftFormat(outFile);
  }

  console.log(`Wrote ${irPath}, ${reportPath}, and ${outFile}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  let schemaPath = defaultSchemaPath;
  let outFile = defaultOutFile;
  let format = defaultFormat;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--format") {
      format = true;
      continue;
    }

    if (arg === "--no-format") {
      format = false;
      continue;
    }

    if (arg === "--schema" || arg === "--out") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`Missing value after ${arg}.`);
      }
      if (arg === "--schema") {
        schemaPath = resolvePath(value);
      } else {
        outFile = resolvePath(value);
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--schema=")) {
      schemaPath = resolvePath(arg.slice("--schema=".length));
      continue;
    }

    if (arg.startsWith("--out=")) {
      outFile = resolvePath(arg.slice("--out=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { schemaPath, outFile, format };
}

function resolvePath(value: string): string {
  if (!value.trim()) {
    throw new Error("Argument value cannot be empty.");
  }
  return resolve(repoRoot, value);
}

function printUsage(): void {
  const lines = [
    "Usage:",
    "  bun run tools/convex-swift-gen/generate-swift.ts [--schema=PATH] [--out=PATH] [--format]",
    "",
    "Options:",
    `  --schema=PATH  Defaults to ${defaultSchemaPath}`,
    `  --out=PATH     Defaults to ${defaultOutFile}`,
    `  --format       Run swift-format after generating (default: ${defaultFormat})`,
    "  --no-format    Disable formatting",
  ];
  console.log(lines.join("\n"));
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

function findDefineSchemaObject(
  file: ts.SourceFile
): ts.ObjectLiteralExpression | null {
  let found: ts.ObjectLiteralExpression | null = null;
  file.forEachChild(function visit(node) {
    if (found) return;
    if (ts.isCallExpression(node) && isIdentifier(node.expression, "defineSchema")) {
      const [arg] = node.arguments;
      if (arg && ts.isObjectLiteralExpression(arg)) {
        found = arg;
        return;
      }
    }
    node.forEachChild(visit);
  });
  return found;
}

function parseSchema(schemaObject: ts.ObjectLiteralExpression): Schema {
  const tables: TableSchema[] = [];
  for (const prop of schemaObject.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const tableName = propertyNameToString(prop.name);
    if (!tableName) continue;
    const defineTableCall = unwrapDefineTableCall(prop.initializer);
    if (!defineTableCall) continue;
    const [fieldsArg] = defineTableCall.arguments;
    if (!fieldsArg || !ts.isObjectLiteralExpression(fieldsArg)) continue;
    const fields = parseFields(fieldsArg);
    tables.push({ name: tableName, fields });
  }
  return { tables };
}

function parseFields(objectLiteral: ts.ObjectLiteralExpression): FieldSchema[] {
  const fields: FieldSchema[] = [];
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyNameToString(prop.name);
    if (!name) continue;
    const validator = parseValidator(prop.initializer);
    fields.push({ name, validator });
  }
  return fields;
}

function parseValidator(node: ts.Expression): Validator {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const callee = node.expression;
    const calleeObject = callee.expression;
    const calleeName = callee.name.text;

    if (ts.isIdentifier(calleeObject) && calleeObject.text === "v") {
      switch (calleeName) {
        case "optional": {
          const [innerNode] = node.arguments;
          if (!innerNode) {
            return { kind: "unknown", optional: true, text: "v.optional()" };
          }
          const inner = parseValidator(innerNode);
          return { ...inner, optional: true };
        }
        case "string":
          return { kind: "string", optional: false };
        case "number":
          return { kind: "number", optional: false };
        case "boolean":
          return { kind: "boolean", optional: false };
        case "id": {
          const [arg] = node.arguments;
          const table = arg && ts.isStringLiteral(arg) ? arg.text : null;
          return { kind: "id", optional: false, table };
        }
        case "array": {
          const [arg] = node.arguments;
          if (!arg) {
            return {
              kind: "array",
              optional: false,
              element: { kind: "unknown", optional: false, text: "v.array()" },
            };
          }
          return { kind: "array", optional: false, element: parseValidator(arg) };
        }
        case "object": {
          const [arg] = node.arguments;
          if (!arg || !ts.isObjectLiteralExpression(arg)) {
            return { kind: "object", optional: false, fields: [] };
          }
          return { kind: "object", optional: false, fields: parseFields(arg) };
        }
        case "union": {
          const options = node.arguments.map((arg) => parseValidator(arg));
          return { kind: "union", optional: false, options };
        }
        case "literal": {
          const [arg] = node.arguments;
          if (!arg) {
            return { kind: "literal", optional: false, value: "" };
          }
          if (ts.isStringLiteral(arg)) {
            return { kind: "literal", optional: false, value: arg.text };
          }
          if (ts.isNumericLiteral(arg)) {
            return { kind: "literal", optional: false, value: Number(arg.text) };
          }
          if (arg.kind === ts.SyntaxKind.TrueKeyword) {
            return { kind: "literal", optional: false, value: true };
          }
          if (arg.kind === ts.SyntaxKind.FalseKeyword) {
            return { kind: "literal", optional: false, value: false };
          }
          return { kind: "literal", optional: false, value: "" };
        }
        case "record": {
          const [keyArg, valueArg] = node.arguments;
          return {
            kind: "record",
            optional: false,
            key: keyArg ? parseValidator(keyArg) : { kind: "string", optional: false },
            value: valueArg ? parseValidator(valueArg) : { kind: "any", optional: false },
          };
        }
        case "any":
          return { kind: "any", optional: false };
        default:
          return { kind: "unknown", optional: false, text: calleeName };
      }
    }
  }

  return { kind: "unknown", optional: false, text: node.getText() };
}

function unwrapDefineTableCall(expr: ts.Expression): ts.CallExpression | null {
  if (ts.isCallExpression(expr)) {
    if (isIdentifier(expr.expression, "defineTable")) return expr;
    if (ts.isPropertyAccessExpression(expr.expression)) {
      return unwrapDefineTableCall(expr.expression.expression);
    }
  }
  return null;
}

function propertyNameToString(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return null;
}

function isIdentifier(node: ts.Node, name: string): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === name;
}

function buildReport(schema: Schema): Report {
  const counts = new Map<string, number>();
  const issues: { table: string; field: string; reason: string }[] = [];
  let fieldCount = 0;

  for (const table of schema.tables) {
    for (const field of table.fields) {
      fieldCount += 1;
      collectCounts(field.validator, counts);
      const issue = scanForIssue(field.validator);
      if (issue) {
        issues.push({ table: table.name, field: field.name, reason: issue });
      }
    }
  }

  const countsByKind: Record<string, number> = {};
  for (const [kind, count] of counts.entries()) {
    countsByKind[kind] = count;
  }

  return {
    tableCount: schema.tables.length,
    fieldCount,
    countsByKind,
    issueCount: issues.length,
    issues,
  };
}

function collectCounts(validator: Validator, counts: Map<string, number>): void {
  counts.set(validator.kind, (counts.get(validator.kind) ?? 0) + 1);
  switch (validator.kind) {
    case "array":
      collectCounts(validator.element, counts);
      break;
    case "object":
      for (const field of validator.fields) {
        collectCounts(field.validator, counts);
      }
      break;
    case "union":
      for (const option of validator.options) {
        collectCounts(option, counts);
      }
      break;
    case "record":
      collectCounts(validator.key, counts);
      collectCounts(validator.value, counts);
      break;
    default:
      break;
  }
}

function scanForIssue(validator: Validator): string | null {
  switch (validator.kind) {
    case "unknown":
      return "unknown";
    case "any":
      return "any";
    case "union":
      if (!isLiteralStringUnion(validator)) return "union-non-literal";
      for (const option of validator.options) {
        const nestedIssue = scanForIssue(option);
        if (nestedIssue) return nestedIssue;
      }
      return null;
    case "record": {
      const valueIssue = scanForIssue(validator.value);
      return valueIssue ?? "record";
    }
    case "array":
      return scanForIssue(validator.element);
    case "object":
      for (const field of validator.fields) {
        const nestedIssue = scanForIssue(field.validator);
        if (nestedIssue) return nestedIssue;
      }
      return null;
    default:
      return null;
  }
}

function isLiteralStringUnion(
  validator: Validator
): validator is { kind: "union"; optional: boolean; options: StringLiteralValidator[] } {
  if (validator.kind !== "union") return false;
  return validator.options.every(
    (option): option is StringLiteralValidator =>
      option.kind === "literal" && typeof option.value === "string"
  );
}

function generateSwift(schema: Schema): string {
  const definitions = new Map<string, string>();
  const structDefinitions: string[] = [];

  for (const table of schema.tables) {
    const tableTypeName = `Convex${pascalCase(table.name)}`;
    const fields: string[] = [];

    fields.push("let _id: String");
    fields.push("@ConvexFloat var _creationTime: Double");

    for (const field of table.fields) {
      const fieldType = renderSwiftType(field.validator, [table.name, field.name], {
        defineStruct,
        defineEnum,
      });

      const needsVar = fieldType.wrapper !== null;
      const keyword = needsVar ? "var" : "let";
      const wrapper = fieldType.wrapper ? `${fieldType.wrapper} ` : "";
      const fieldName = escapeSwiftIdentifier(field.name);
      fields.push(`${wrapper}${keyword} ${fieldName}: ${fieldType.type}`);
    }

    structDefinitions.push(renderStruct(tableTypeName, fields));
  }

  function defineStruct(name: string, fields: FieldSchema[], path: string[]): void {
    if (definitions.has(name)) return;
    const swiftFields = fields.map((field) => {
      const fieldType = renderSwiftType(field.validator, path.concat(field.name), {
        defineStruct,
        defineEnum,
      });
      const needsVar = fieldType.wrapper !== null;
      const keyword = needsVar ? "var" : "let";
      const wrapper = fieldType.wrapper ? `${fieldType.wrapper} ` : "";
      const fieldName = escapeSwiftIdentifier(field.name);
      return `${wrapper}${keyword} ${fieldName}: ${fieldType.type}`;
    });
    definitions.set(name, renderStruct(name, swiftFields));
  }

  function defineEnum(name: string, values: string[]): void {
    if (definitions.has(name)) return;
    const cases: string[] = [];
    const used = new Set<string>();
    for (const value of values) {
      const baseName = sanitizeEnumCase(value);
      let caseName = baseName;
      let suffix = 1;
      while (used.has(caseName)) {
        suffix += 1;
        caseName = `${baseName}_${suffix}`;
      }
      used.add(caseName);
      const escapedName = escapeSwiftIdentifier(caseName);
      cases.push(`case ${escapedName} = "${value}"`);
    }
    definitions.set(name, renderEnum(name, cases));
  }

  const header = [
    "import Foundation",
    "import ConvexMobile",
    "",
    "// Generated from packages/convex/convex/schema.ts",
    "",
    "enum ConvexValue: Decodable {",
    "    case string(String)",
    "    case double(Double)",
    "    case bool(Bool)",
    "    case array([ConvexValue])",
    "    case object([String: ConvexValue])",
    "    case null",
    "",
    "    init(from decoder: Decoder) throws {",
    "        let container = try decoder.singleValueContainer()",
    "        if container.decodeNil() {",
    "            self = .null",
    "            return",
    "        }",
    "        if let value = try? container.decode(Bool.self) {",
    "            self = .bool(value)",
    "            return",
    "        }",
    "        if let value = try? container.decode(Double.self) {",
    "            self = .double(value)",
    "            return",
    "        }",
    "        if let value = try? container.decode(String.self) {",
    "            self = .string(value)",
    "            return",
    "        }",
    "        if let value = try? container.decode([String: ConvexValue].self) {",
    "            self = .object(value)",
    "            return",
    "        }",
    "        if let value = try? container.decode([ConvexValue].self) {",
    "            self = .array(value)",
    "            return",
    "        }",
    "        throw DecodingError.dataCorruptedError(in: container, debugDescription: \"Unsupported ConvexValue\")",
    "    }",
    "}",
    "",
  ];

  const nestedDefs = Array.from(definitions.values());
  const content = header.concat(nestedDefs).concat(structDefinitions).join("\n\n");

  return content + "\n";
}

function renderSwiftType(
  validator: Validator,
  path: string[],
  helpers: SwiftTypeHelpers
): SwiftType {
  const optional = validator.optional;
  switch (validator.kind) {
    case "string":
      return { type: optional ? "String?" : "String", wrapper: null };
    case "boolean":
      return { type: optional ? "Bool?" : "Bool", wrapper: null };
    case "number":
      return {
        type: optional ? "Double?" : "Double",
        wrapper: optional ? "@OptionalConvexFloat" : "@ConvexFloat",
      };
    case "id":
      return { type: optional ? "String?" : "String", wrapper: null };
    case "any":
      return { type: optional ? "ConvexValue?" : "ConvexValue", wrapper: null };
    case "array": {
      const elementType = renderSwiftType(validator.element, path.concat("Item"), helpers);
      const base = `[${stripOptional(elementType.type)}]`;
      return { type: optional ? `${base}?` : base, wrapper: null };
    }
    case "object": {
      const typeName = `Convex${path.map(pascalCase).join("")}`;
      helpers.defineStruct(typeName, validator.fields, path);
      return { type: optional ? `${typeName}?` : typeName, wrapper: null };
    }
    case "union": {
      if (isLiteralStringUnion(validator)) {
        const typeName = `Convex${path.map(pascalCase).join("")}Enum`;
        const values = validator.options.map((option) => option.value);
        helpers.defineEnum(typeName, values);
        return { type: optional ? `${typeName}?` : typeName, wrapper: null };
      }
      return { type: optional ? "ConvexValue?" : "ConvexValue", wrapper: null };
    }
    case "literal": {
      const literalType = typeof validator.value === "boolean" ? "Bool" : "String";
      return { type: optional ? `${literalType}?` : literalType, wrapper: null };
    }
    case "record": {
      const valueType = renderSwiftType(validator.value, path.concat("Value"), helpers);
      const base = `[String: ${stripOptional(valueType.type)}]`;
      return { type: optional ? `${base}?` : base, wrapper: null };
    }
    default:
      return { type: optional ? "ConvexValue?" : "ConvexValue", wrapper: null };
  }
}

function renderStruct(name: string, fields: string[]): string {
  return `struct ${name}: Decodable {\n${fields.map((f) => `    ${f}`).join("\n")}\n}`;
}

function renderEnum(name: string, cases: string[]): string {
  return `enum ${name}: String, Decodable {\n${cases
    .map((c) => `    ${c}`)
    .join("\n")}\n}`;
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
