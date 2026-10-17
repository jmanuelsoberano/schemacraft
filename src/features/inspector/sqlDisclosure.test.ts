import { describe, expect, it } from "vitest";

import type { RuleView } from "@/features/schema/objectDetailsView";

import { sqlDisclosure } from "./sqlDisclosure";

function rule(sql: string | null, unread: string | null): RuleView {
  return {
    sentences: [],
    unread,
    sql,
    sqlNote: null,
    targets: { columns: new Map(), relation: null },
  };
}

const READ = rule("([Status]='A')", null);
const UNREAD = rule("([dbo].[fn_ok]([Status])=(1))", "This rule can't be put into words.");

describe("sqlDisclosure", () => {
  it("shows the SQL from the start only for a rule that cannot be put into words", () => {
    expect(sqlDisclosure(READ).isOpen).toBe(false);
    expect(sqlDisclosure(UNREAD).isOpen).toBe(true);
  });

  it("keeps the reader's choice while the item shows the same rule", () => {
    const closed = { ...sqlDisclosure(UNREAD), isOpen: false };
    expect(sqlDisclosure(rule(UNREAD.sql, UNREAD.unread), closed)).toBe(closed);
  });

  it("starts over when the rule's readability or SQL changes", () => {
    // A readable CHECK whose SQL the reader left hidden, then unreadable after a refresh.
    const hidden = sqlDisclosure(READ);
    expect(sqlDisclosure(rule(READ.sql, "This rule can't be put into words."), hidden)).toEqual({
      sql: READ.sql,
      isUnread: true,
      isOpen: true,
    });
    // An unread rule, its SQL shown, then readable: the sentences come back with the SQL hidden.
    expect(sqlDisclosure(rule(UNREAD.sql, null), sqlDisclosure(UNREAD)).isOpen).toBe(false);
    // Another unread rule in the place of one whose SQL the reader hid: its SQL shows.
    const shut = { ...sqlDisclosure(UNREAD), isOpen: false };
    expect(sqlDisclosure(rule("([Code]<>'X' OR [Code] IS NULL)", "…"), shut).isOpen).toBe(true);
  });
});
