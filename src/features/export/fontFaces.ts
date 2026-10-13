import interRegularUrl from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import interSemiBoldUrl from "@fontsource/inter/files/inter-latin-600-normal.woff2?url";
import monoRegularUrl from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url";
import monoSemiBoldUrl from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2?url";

export interface FontFaceSource {
  family: "Inter" | "JetBrains Mono";
  weight: 400 | 600;
  url: string;
}

/** The static faces the diagram uses; the Rust renderer bundles the same four as TTF. */
export const FONT_FACE_SOURCES: readonly FontFaceSource[] = [
  { family: "Inter", weight: 400, url: interRegularUrl },
  { family: "Inter", weight: 600, url: interSemiBoldUrl },
  { family: "JetBrains Mono", weight: 400, url: monoRegularUrl },
  { family: "JetBrains Mono", weight: 600, url: monoSemiBoldUrl },
];

/** Base64 of raw bytes, in chunks so large fonts do not exceed the argument limit of `btoa`. */
export function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** One `@font-face` rule with the font embedded as a data URL. */
export function fontFaceRule(face: Omit<FontFaceSource, "url">, base64: string): string {
  return (
    `@font-face{font-family:"${face.family}";font-style:normal;font-weight:${face.weight};` +
    `font-display:block;src:url(data:font/woff2;base64,${base64}) format("woff2")}`
  );
}

let embeddedFontFaces: Promise<string> | null = null;

/** The four faces as embedded `@font-face` rules, fetched once from the bundled assets. */
export function loadEmbeddedFontFaces(): Promise<string> {
  embeddedFontFaces ??= Promise.all(
    FONT_FACE_SOURCES.map(async (face) => {
      const response = await fetch(face.url);
      if (!response.ok) {
        throw new Error(`could not load the font at ${face.url}: ${response.status}`);
      }
      return fontFaceRule(face, toBase64(new Uint8Array(await response.arrayBuffer())));
    }),
  )
    .then((rules) => rules.join(""))
    .catch((error: unknown) => {
      // Let the next export retry instead of caching the failure forever.
      embeddedFontFaces = null;
      throw error;
    });
  return embeddedFontFaces;
}
