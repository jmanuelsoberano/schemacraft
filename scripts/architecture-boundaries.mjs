import { posix } from "node:path";
import ts from "typescript";

/** Parse literal static, re-export, dynamic-import and CommonJS module references. */
export function moduleReferences(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const references = new Set();
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) references.add(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      add(node.moduleReference.expression);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    )
      add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...references].sort();
}

/** Normalized paths close relative-import bypasses of the documented alias boundaries. */
export function importViolation(source, reference) {
  const file = source.replaceAll("\\", "/");
  if (reference.startsWith("@tauri-apps/") && !file.startsWith("src/shared/ipc/"))
    return "only src/shared/ipc may import the Tauri API";
  const target = reference.startsWith("@/")
    ? posix.normalize(`src/${reference.slice(2)}`)
    : reference.startsWith(".")
      ? posix.normalize(posix.join(posix.dirname(file), reference))
      : null;
  if (target === null) return null;
  const inside = (folder) => target === folder || target.startsWith(`${folder}/`);
  if (file.startsWith("src/shared/") && (inside("src/app") || inside("src/features")))
    return "shared cannot import app or product features";
  if (file.startsWith("src/features/") && inside("src/app"))
    return "features cannot import the composition root";
  if (
    file.startsWith("src/features/schema/") &&
    inside("src/features") &&
    !inside("src/features/schema")
  )
    return "features/schema must remain a leaf among features";
  if (file.startsWith("src/viewer/") && inside("src/app"))
    return "the standalone viewer cannot import the application shell";
  if (!file.startsWith("src/viewer/") && inside("src/viewer"))
    return "the standalone viewer is a separate bundle";
  return null;
}

/** Each literal IPC call belongs to a documented caller and a registered host command. */
export function invokedCommands(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const commands = new Set();
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "invokeCommand" &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      commands.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...commands].sort();
}
