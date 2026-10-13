import { describe, expect, it } from "vitest";

import { FONT_FACE_SOURCES, fontFaceRule, toBase64 } from "./fontFaces";

describe("font faces", () => {
  it("lists the four static faces the renderer bundles", () => {
    expect(FONT_FACE_SOURCES.map((face) => `${face.family} ${face.weight}`)).toEqual([
      "Inter 400",
      "Inter 600",
      "JetBrains Mono 400",
      "JetBrains Mono 600",
    ]);
    expect(FONT_FACE_SOURCES.every((face) => face.url.endsWith(".woff2"))).toBe(true);
  });

  it("encodes bytes as base64 in chunks and writes a self-contained rule", () => {
    const bytes = new Uint8Array(70_000).map((_, index) => index % 251);
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (character) => character.charCodeAt(0));
    expect(decoded).toEqual(bytes);
    const rule = fontFaceRule({ family: "JetBrains Mono", weight: 600 }, "AAAA");
    expect(rule).toBe(
      '@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:600;font-display:block;src:url(data:font/woff2;base64,AAAA) format("woff2")}',
    );
  });
});
