import { describe, expect, it } from "vitest";

import type { Column, SqlDataType } from "@/shared/contracts";

import { describeColumn, formatDataType } from "./dataType";

function type(partial: Partial<SqlDataType> & { name: string }): SqlDataType {
  return { length: null, precision: null, scale: null, userDefinedTypeName: null, ...partial };
}

describe("formatDataType", () => {
  it("renders lengths, precision and scale like SQL", () => {
    expect(formatDataType(type({ name: "int" }))).toBe("int");
    expect(formatDataType(type({ name: "nvarchar", length: { kind: "fixed", value: 120 } }))).toBe(
      "nvarchar(120)",
    );
    expect(formatDataType(type({ name: "varbinary", length: { kind: "max" } }))).toBe(
      "varbinary(max)",
    );
    expect(formatDataType(type({ name: "decimal", precision: 18, scale: 2 }))).toBe(
      "decimal(18,2)",
    );
    expect(formatDataType(type({ name: "datetime2", precision: 3 }))).toBe("datetime2(3)");
  });

  it("prefers the user-defined type name", () => {
    expect(
      formatDataType(
        type({ name: "decimal", precision: 19, scale: 4, userDefinedTypeName: "dbo.Money2" }),
      ),
    ).toBe("dbo.Money2(19,4)");
  });
});

describe("describeColumn", () => {
  const base: Column = {
    name: "Total",
    ordinalPosition: 1,
    dataType: type({ name: "decimal", precision: 18, scale: 2 }),
    isNullable: false,
    defaultExpression: null,
    isIdentity: false,
    isComputed: false,
  };

  const labels = {
    notAvailable: "DEFAULT (not available)",
    notRecorded: "(default not recorded)",
  };

  it("lists nullability and attributes after the type", () => {
    expect(describeColumn(base, labels)).toBe("decimal(18,2) NOT NULL");
    expect(
      describeColumn(
        {
          ...base,
          isNullable: true,
          isIdentity: true,
          defaultExpression: { status: "readable", text: "((0))" },
        },
        labels,
      ),
    ).toBe("decimal(18,2) NULL IDENTITY DEFAULT ((0))");
    expect(describeColumn({ ...base, isComputed: true }, labels)).toBe(
      "decimal(18,2) NOT NULL COMPUTED",
    );
  });

  it("says why a default's text is missing instead of dropping it", () => {
    expect(describeColumn({ ...base, defaultExpression: { status: "notVisible" } }, labels)).toBe(
      "decimal(18,2) NOT NULL DEFAULT (not available)",
    );
    // A state written by a newer version is not readable here either.
    expect(describeColumn({ ...base, defaultExpression: { status: "unknown" } }, labels)).toBe(
      "decimal(18,2) NOT NULL DEFAULT (not available)",
    );
    // A 1.0 file did not know whether there is a default, so the keyword is not claimed.
    expect(describeColumn({ ...base, defaultExpression: { status: "notRecorded" } }, labels)).toBe(
      "decimal(18,2) NOT NULL (default not recorded)",
    );
  });
});
