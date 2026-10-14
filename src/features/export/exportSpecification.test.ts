import { describe, expect, it } from "vitest";

import {
  ExportSpecificationBuilder,
  ExportSpecificationError,
  suggestedFileName,
  withExtension,
} from "./exportSpecification";

describe("ExportSpecificationBuilder", () => {
  it("builds a complete specification from fluent steps", () => {
    const specification = new ExportSpecificationBuilder()
      .format("png")
      .detailLevel("full")
      .theme("dark")
      .scale(4)
      .embedFonts(true)
      .to("C:\\exports\\shop")
      .build();
    expect(specification).toEqual({
      format: "png",
      detailLevel: "full",
      theme: "dark",
      scale: 4,
      embedFonts: false,
      destination: "C:\\exports\\shop.png",
    });
  });

  it("normalises the scale and the fonts for the vector formats", () => {
    const svg = ExportSpecificationBuilder.from({
      format: "svg",
      detailLevel: "keys",
      theme: "light",
      scale: 4,
      embedFonts: true,
    })
      .to("diagram.SVG")
      .build();
    expect(svg.scale).toBe(1);
    expect(svg.embedFonts).toBe(true);
    expect(svg.destination).toBe("diagram.SVG");

    const pdf = new ExportSpecificationBuilder().format("pdf").to("diagram").build();
    expect(pdf.embedFonts).toBe(false);
    expect(pdf.destination).toBe("diagram.pdf");
  });

  it("refuses a missing destination", () => {
    expect(() => new ExportSpecificationBuilder().build()).toThrow(ExportSpecificationError);
    expect(() => new ExportSpecificationBuilder().to("   ").build()).toThrow(
      ExportSpecificationError,
    );
  });

  it("suggests file names and extensions", () => {
    expect(suggestedFileName("Northwind", "html")).toBe("Northwind-diagram.html");
    expect(suggestedFileName("  ", "pdf")).toBe("diagram-diagram.pdf");
    expect(suggestedFileName("a/b:c", "svg")).toBe("a-b-c-diagram.svg");
    expect(withExtension("x.png", "png")).toBe("x.png");
    expect(withExtension("x", "png")).toBe("x.png");
  });
});
