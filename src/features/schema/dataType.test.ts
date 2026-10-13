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

  it("lists nullability and attributes after the type", () => {
    expect(describeColumn(base)).toBe("decimal(18,2) NOT NULL");
    expect(
      describeColumn({ ...base, isNullable: true, isIdentity: true, defaultExpression: "((0))" }),
    ).toBe("decimal(18,2) NULL IDENTITY DEFAULT ((0))");
    expect(describeColumn({ ...base, isComputed: true })).toBe("decimal(18,2) NOT NULL COMPUTED");
  });
});
