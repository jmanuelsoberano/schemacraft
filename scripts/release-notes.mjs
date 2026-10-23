// Prints the notes of a release: what SchemaCraft is, its assets, the code signing policy and
// the CHANGELOG.md entry of that version. release.yml publishes them as the body of the draft
// release, and CI runs this script on every pull request, so a version is never tagged without a
// dated CHANGELOG entry and its link.
//
// Usage: node scripts/release-notes.mjs [version]   (the version in package.json by default)
import { readFile } from "node:fs/promises";

const REPOSITORY = "https://github.com/jmanuelsoberano/schemacraft";
const root = new URL("../", import.meta.url);

function fail(message) {
  process.stderr.write(`release-notes: ${message}\n`);
  process.exit(1);
}

const version =
  process.argv[2] ?? JSON.parse(await readFile(new URL("package.json", root), "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  fail(`"${version}" is not a version such as 1.1.0`);
}
const tag = `v${version}`;

const lines = (await readFile(new URL("CHANGELOG.md", root), "utf8")).split(/\r?\n/u);
const heading = `## [${version}]`;
const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
if (start === -1) {
  fail(`CHANGELOG.md has no "${heading} - YYYY-MM-DD" entry`);
}
if (!/ - \d{4}-\d{2}-\d{2}$/u.test(lines[start])) {
  fail(`the CHANGELOG.md entry "${lines[start]}" has no release date`);
}
if (!lines.some((line) => line.startsWith(`[${version}]: ${REPOSITORY}/`))) {
  fail(`CHANGELOG.md has no "[${version}]: ${REPOSITORY}/..." link`);
}

// The entry runs until the next version heading or the link definitions at the end of the file.
const isEntryEnd = (line) => line.startsWith("## [") || /^\[[^\]]+\]: /u.test(line);
const endOffset = lines.slice(start + 1).findIndex(isEntryEnd);
const body = lines.slice(start + 1, endOffset === -1 ? lines.length : start + 1 + endOffset);

// CHANGELOG.md wraps its lines at 100 columns; a release page would show every wrap as a line
// break, so each paragraph and list item is joined back into one line.
const joined = [];
for (const line of body) {
  const previous = joined.at(-1);
  const continues =
    line.trim() !== "" &&
    !/^\s*(?:#|[-*] )/u.test(line) &&
    previous !== undefined &&
    previous.trim() !== "" &&
    !previous.startsWith("#");
  if (continues) {
    joined[joined.length - 1] = `${previous} ${line.trim()}`;
  } else {
    joined.push(line);
  }
}
const entry = joined.join("\n").trim();
if (entry === "") {
  fail(`the CHANGELOG.md entry "${lines[start]}" is empty`);
}

// One line per paragraph, for the same reason the entry's lines are joined.
const [major, minor] = version.split(".").map(Number);
const overview =
  major > 1 || (major === 1 && minor >= 3)
    ? `SchemaCraft explores Microsoft SQL Server and PostgreSQL schemas through interactive diagrams, known dependencies, project comparison and saved perspectives, with SVG, HTML, PDF and PNG export.`
    : `SchemaCraft reads the schema of a Microsoft SQL Server database and shows it as an interactive entity-relationship diagram, with SVG, HTML, PDF and PNG export.`;
const paragraphs = [
  `${overview} The [README](${REPOSITORY}#features) lists every feature.`,
  `Portable executable (\`schemacraft-${tag}-windows-x64.exe\`) and per-user installer (\`schemacraft-${tag}-windows-x64-setup.exe\`) for Windows 10/11 x64; verify the downloads with \`SHA256SUMS.txt\`. Both need the Microsoft Edge WebView2 runtime, which Windows 11 and updated Windows 10 include.`,
  `[Code signing policy](${REPOSITORY}#code-signing-policy): free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org). The application to SignPath Foundation is under review; until it is approved, release files are not signed and SmartScreen warns on the first launch.`,
  `## What's new in ${version}`,
  entry,
];
process.stdout.write(`${paragraphs.join("\n\n")}\n`);
