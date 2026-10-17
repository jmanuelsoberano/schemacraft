import { describe, expect, it } from "vitest";

import { quoteIdentifier } from "@/features/schema/sqlIdentifiers";

import { grantScript } from "./grantScript";

describe("grantScript", () => {
  it("grants VIEW DEFINITION on the database to the login's user", () => {
    const script = grantScript({ database: "Shop", principal: "reporting", locale: "en" });
    const statements = script.split("\n").filter((line) => line !== "" && !line.startsWith("--"));
    expect(statements).toEqual(["USE [Shop];", "GRANT VIEW DEFINITION TO [reporting];"]);
    expect(script.endsWith(";\n")).toBe(true);
  });

  it("doubles closing brackets in the database and the user", () => {
    const script = grantScript({ database: "Odd]Db", principal: "dom]user", locale: "en" });
    expect(script).toContain("USE [Odd]]Db];");
    expect(script).toContain("GRANT VIEW DEFINITION TO [dom]]user];");
  });

  it("keeps Unicode names as they are", () => {
    const script = grantScript({ database: "Contabilidad Año", principal: "José", locale: "es" });
    expect(script).toContain("USE [Contabilidad Año];");
    expect(script).toContain("GRANT VIEW DEFINITION TO [José];");
  });

  it("writes a placeholder to replace when the user is not known", () => {
    const english = grantScript({ database: "Shop", principal: null, locale: "en" });
    expect(english).toContain("GRANT VIEW DEFINITION TO [<database user>];");
    expect(english).toMatch(/^-- Replace \[<database user>\] /m);
    const spanish = grantScript({ database: "Shop", principal: null, locale: "es" });
    expect(spanish).toContain("GRANT VIEW DEFINITION TO [<usuario de base de datos>];");
    expect(spanish).toMatch(/^-- Sustituye /m);
    expect(grantScript({ database: "Shop", principal: "x", locale: "en" })).not.toContain(
      "Replace",
    );
  });

  it("discloses what SQL Server 2022 adds to VIEW DEFINITION, in both languages", () => {
    expect(grantScript({ database: "Shop", principal: "x", locale: "en" })).toContain(
      "-- On SQL Server 2022 and later it also shows users, roles and permissions.",
    );
    expect(grantScript({ database: "Shop", principal: "x", locale: "es" })).toContain(
      "-- En SQL Server 2022 y posteriores también muestra usuarios, roles y permisos.",
    );
  });

  it("keeps every comment on one line, so the script stays valid SQL", () => {
    for (const locale of ["en", "es"] as const) {
      const lines = grantScript({ database: "Shop", principal: null, locale })
        .trimEnd()
        .split("\n");
      for (const line of lines.slice(0, -2)) {
        expect(line.startsWith("-- "), line).toBe(true);
      }
    }
  });

  it("never lets a line break in a name end a comment", () => {
    // A name a db_owner can give with ALTER DATABASE or ALTER USER; without brackets of its
    // own it survives the quoting and would run as a statement if it left the comment.
    const injected = "ALTER SERVER ROLE sysadmin ADD MEMBER mallory;--";
    for (const lineBreak of ["\n", "\r\n", "\r", "\u0085", "\u2028", "\u2029"]) {
      for (const [database, principal] of [
        [`Sales${lineBreak}${injected}`, "reporting"],
        ["Sales", `reporting${lineBreak}${injected}`],
      ] as const) {
        const script = grantScript({ database, principal, locale: "en" });
        const statementsStart = script.indexOf("\nUSE [") + 1;
        const comments = script.slice(0, statementsStart).trimEnd();
        const label = JSON.stringify({ database, principal });

        for (const line of comments.split(/\r\n|[\n\r\u0085\u2028\u2029]/u)) {
          expect(line.startsWith("-- "), label).toBe(true);
        }
        expect(comments.split("\n"), label).toHaveLength(3);
        // The statements keep the name as it is, inside brackets, where a line break is harmless.
        expect(script.slice(statementsStart), label).toBe(
          `USE ${quoteIdentifier(database)};\nGRANT VIEW DEFINITION TO ${quoteIdentifier(principal)};\n`,
        );
      }
    }
  });

  it("shows control characters of a name in the comments as visible escapes", () => {
    const script = grantScript({
      database: "Sales\r\nEast\tWing\u0000",
      principal: "dom\u2028user",
      locale: "en",
    });
    const header = script.split("\n")[0];
    expect(header).toBe(
      "-- SchemaCraft: read-only access to the schema of [Sales\\r\\nEast\\tWing\\u0000] for [dom\\u2028user].",
    );
  });
});
