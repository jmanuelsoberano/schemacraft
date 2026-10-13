import type { DetailLevel, ExportFormat } from "@/shared/contracts";

import type { ExportTheme } from "./svg/palette";

export type { ExportFormat };

/** Output formats, in the order the dialog offers them. */
export const EXPORT_FORMATS: readonly ExportFormat[] = ["svg", "html", "pdf", "png"];

export type PngScale = 1 | 2 | 4;
export const PNG_SCALES: readonly PngScale[] = [1, 2, 4];

export const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  svg: "svg",
  html: "html",
  pdf: "pdf",
  png: "png",
};

/** Everything an export needs, validated. Built with {@link ExportSpecificationBuilder}. */
export interface ExportSpecification {
  format: ExportFormat;
  detailLevel: DetailLevel;
  theme: ExportTheme;
  /** Device pixels per CSS pixel; always 1 for the vector formats. */
  scale: PngScale;
  /** Whether SVG and HTML carry the fonts; the raster and PDF renderers always have them. */
  embedFonts: boolean;
  destination: string;
}

/** The choices the dialog collects before a destination is known. */
export type ExportChoices = Omit<ExportSpecification, "destination">;

export class ExportSpecificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportSpecificationError";
  }
}

/** Default choices for a first export: keys level, the current theme, 2x PNG, fonts embedded. */
export const DEFAULT_CHOICES: ExportChoices = {
  format: "svg",
  detailLevel: "keys",
  theme: "light",
  scale: 2,
  embedFonts: true,
};

/**
 * Builds an {@link ExportSpecification} step by step, normalising the choices that only make
 * sense together: the vector formats ignore the scale, PNG and PDF never embed fonts in the
 * document, and the destination gets the extension of its format.
 */
export class ExportSpecificationBuilder {
  private choices: ExportChoices;
  private destination: string | null = null;

  constructor(choices: ExportChoices = DEFAULT_CHOICES) {
    this.choices = { ...choices };
  }

  static from(choices: ExportChoices): ExportSpecificationBuilder {
    return new ExportSpecificationBuilder(choices);
  }

  format(format: ExportFormat): this {
    this.choices.format = format;
    return this;
  }

  detailLevel(detailLevel: DetailLevel): this {
    this.choices.detailLevel = detailLevel;
    return this;
  }

  theme(theme: ExportTheme): this {
    this.choices.theme = theme;
    return this;
  }

  scale(scale: PngScale): this {
    this.choices.scale = scale;
    return this;
  }

  embedFonts(embedFonts: boolean): this {
    this.choices.embedFonts = embedFonts;
    return this;
  }

  to(destination: string): this {
    this.destination = destination;
    return this;
  }

  build(): ExportSpecification {
    const { format } = this.choices;
    if (this.destination === null || this.destination.trim() === "") {
      throw new ExportSpecificationError("an export needs a destination path");
    }
    if (!PNG_SCALES.includes(this.choices.scale)) {
      throw new ExportSpecificationError(`${this.choices.scale}x is not a supported scale`);
    }
    return {
      format,
      detailLevel: this.choices.detailLevel,
      theme: this.choices.theme,
      scale: format === "png" ? this.choices.scale : 1,
      embedFonts: (format === "svg" || format === "html") && this.choices.embedFonts,
      destination: withExtension(this.destination.trim(), FILE_EXTENSIONS[format]),
    };
  }
}

/** Appends `.extension` unless the path already ends with it (case-insensitively). */
export function withExtension(path: string, extension: string): string {
  return path.toLowerCase().endsWith(`.${extension}`) ? path : `${path}.${extension}`;
}

/** File name offered by the save dialog, e.g. `Northwind-diagram.svg`. */
export function suggestedFileName(databaseName: string, format: ExportFormat): string {
  const base = databaseName.trim().replaceAll(/[\\/:*?"<>|]/gu, "-") || "diagram";
  return `${base}-diagram.${FILE_EXTENSIONS[format]}`;
}
