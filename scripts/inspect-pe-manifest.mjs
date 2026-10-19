// Reads PE resources without loading or executing the executable.
// Usage: node inspect-pe-manifest.mjs <exe> [expected-level]
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const [input, expectedLevel] = process.argv.slice(2);
assert(input, "An executable path is required");
const bytes = await readFile(input);
const u16 = (offset) => bytes.readUInt16LE(offset);
const u32 = (offset) => bytes.readUInt32LE(offset);
assert.equal(u16(0), 0x5a4d, "DOS signature");
const pe = u32(0x3c);
assert.equal(u32(pe), 0x4550, "PE signature");
const sectionCount = u16(pe + 6);
const optionalSize = u16(pe + 20);
const optional = pe + 24;
const magic = u16(optional);
assert([0x10b, 0x20b].includes(magic), "Supported PE optional header");
const directoryBase = optional + (magic === 0x20b ? 112 : 96);
const resourceRva = u32(directoryBase + 16);
assert(resourceRva > 0, "Resource directory exists");
const sections = Array.from({ length: sectionCount }, (_, index) => {
  const offset = optional + optionalSize + index * 40;
  return {
    address: u32(offset + 12),
    virtualSize: u32(offset + 8),
    rawSize: u32(offset + 16),
    rawOffset: u32(offset + 20),
  };
});
function fileOffset(address) {
  const section = sections.find(
    (s) => address >= s.address && address < s.address + Math.max(s.virtualSize, s.rawSize),
  );
  assert(section, "Resource address maps to a section");
  const offset = section.rawOffset + address - section.address;
  assert(offset >= 0 && offset < bytes.length, "Resource offset remains inside the executable");
  return offset;
}
const root = fileOffset(resourceRva);
function entries(relative) {
  const directory = root + relative;
  const count = u16(directory + 12) + u16(directory + 14);
  return Array.from({ length: count }, (_, index) => {
    const entry = directory + 16 + index * 8;
    const identity = u32(entry);
    const destination = u32(entry + 4);
    return {
      id: (identity & 0x80000000) === 0 ? identity : null,
      isDirectory: (destination & 0x80000000) !== 0,
      offset: destination & 0x7fffffff,
    };
  });
}
const manifestType = entries(0).find((entry) => entry.id === 24);
assert(manifestType?.isDirectory, "RT_MANIFEST resource exists");
const manifests = [];
function visit(entry, depth = 0) {
  assert(depth <= 4, "Resource tree depth is bounded");
  if (entry.isDirectory) {
    for (const child of entries(entry.offset)) visit(child, depth + 1);
    return;
  }
  const dataEntry = root + entry.offset;
  const offset = fileOffset(u32(dataEntry));
  const size = u32(dataEntry + 4);
  assert(offset + size <= bytes.length, "Manifest remains inside the executable");
  const body = bytes.subarray(offset, offset + size);
  const xml =
    body[0] === 0xff && body[1] === 0xfe
      ? body.subarray(2).toString("utf16le")
      : body.toString("utf8");
  const level =
    /<requestedExecutionLevel\b[^>]*\blevel\s*=\s*["']([^"']+)["']/u.exec(xml)?.[1] ?? null;
  const uiAccess =
    /<requestedExecutionLevel\b[^>]*\buiAccess\s*=\s*["']([^"']+)["']/u.exec(xml)?.[1] ?? null;
  manifests.push({ languageId: entry.id, bytes: size, level, uiAccess });
}
visit(manifestType);
assert(manifests.length > 0, "At least one embedded manifest was read");
if (expectedLevel)
  for (const manifest of manifests)
    assert.equal(manifest.level, expectedLevel, "Requested execution level");
console.log(
  JSON.stringify(
    {
      executable: resolve(input),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      manifests,
    },
    null,
    2,
  ),
);
