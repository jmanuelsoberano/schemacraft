// Turns the static WOFF2 files shipped by the Fontsource packages into TTF files for the Rust
// export renderer (resvg reads TTF/OTF only). The TTFs are committed; run this after bumping
// the font packages:
//   node scripts/prepare-fonts.mjs
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const woff2 = require("wawoff2");

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(root, "crates", "schemacraft-core", "assets", "fonts");

/** Static faces the diagram uses: regular text, and semibold for names and counters. */
const FACES = [
  { package: "@fontsource/inter", file: "inter-latin-400-normal", output: "Inter-Regular.ttf" },
  { package: "@fontsource/inter", file: "inter-latin-600-normal", output: "Inter-SemiBold.ttf" },
  {
    package: "@fontsource/jetbrains-mono",
    file: "jetbrains-mono-latin-400-normal",
    output: "JetBrainsMono-Regular.ttf",
  },
  {
    package: "@fontsource/jetbrains-mono",
    file: "jetbrains-mono-latin-600-normal",
    output: "JetBrainsMono-SemiBold.ttf",
  },
];

await mkdir(outputDirectory, { recursive: true });
for (const face of FACES) {
  const source = join(root, "node_modules", face.package, "files", `${face.file}.woff2`);
  const compressed = await readFile(source);
  const ttf = await woff2.decompress(compressed);
  await writeFile(join(outputDirectory, face.output), Buffer.from(ttf));
  console.log(`${face.output}: ${ttf.length} bytes`);
}
for (const [packageName, licenseName] of [
  ["@fontsource/inter", "LICENSE-Inter.txt"],
  ["@fontsource/jetbrains-mono", "LICENSE-JetBrainsMono.txt"],
]) {
  await copyFile(
    join(root, "node_modules", packageName, "LICENSE"),
    join(outputDirectory, licenseName),
  );
}
console.log(`fonts written to ${outputDirectory}`);
