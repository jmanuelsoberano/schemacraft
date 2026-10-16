import { quoteIdentifier } from "@/features/schema/sqlIdentifiers";
import { formatMessage } from "@/shared/i18n/formatMessage";
import type { MessageParameters } from "@/shared/i18n/formatMessage";
import type { Locale } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import type { MessageKey } from "@/shared/i18n/messages/en";

export interface GrantScriptRequest {
  database: string;
  /** Database user the login maps to; `null` writes a placeholder for the DBA to replace. */
  principal: string | null;
  /** Language of the comments; the SQL itself is never translated. */
  locale: Locale;
}

/** Escapes with a name of their own; every other control character is written as `\uXXXX`. */
const NAMED_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
]);

/**
 * Whether the character ends a line or is otherwise invisible: the C0 and C1 controls, `DEL`,
 * and the Unicode line and paragraph separators.
 */
function isControlCharacter(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

/**
 * `text` as it can appear inside a `--` comment: a line break would end the comment and run the
 * rest of a name as a statement, which a database or user renamed by a `db_owner` could use, so
 * every control character is shown as a visible escape instead. Brackets protect the statements
 * themselves, which keep the name as it is.
 */
function escapedForComment(text: string): string {
  return Array.from(text, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (!isControlCharacter(codePoint)) {
      return character;
    }
    return NAMED_ESCAPES.get(character) ?? `\\u${codePoint.toString(16).padStart(4, "0")}`;
  }).join("");
}

/**
 * The least-privilege script that lets a login read the whole schema of `database`:
 * `VIEW DEFINITION` on the database, which reveals no data and allows no change. SchemaCraft only
 * copies it; a DBA runs it. The comments say what it grants, including what SQL Server 2022 adds
 * to that permission, and every identifier is bracket-quoted, with control characters escaped
 * where a comment names it.
 */
export function grantScript({ database, principal, locale }: GrantScriptRequest): string {
  const text = (key: MessageKey, parameters?: MessageParameters) =>
    formatMessage(messageCatalogs[locale][key], parameters);
  const quotedDatabase = quoteIdentifier(database);
  const grantee = quoteIdentifier(principal ?? text("access.script.placeholder"));
  const named = {
    database: escapedForComment(quotedDatabase),
    principal: escapedForComment(grantee),
  };

  const lines = [
    `-- ${text("access.script.header", named)}`,
    `-- ${text("access.script.readOnly")}`,
    `-- ${text("access.script.sqlServer2022")}`,
    ...(principal === null
      ? [`-- ${text("access.script.replace", { placeholder: named.principal })}`]
      : []),
    `USE ${quotedDatabase};`,
    `GRANT VIEW DEFINITION TO ${grantee};`,
  ];
  return `${lines.join("\n")}\n`;
}
