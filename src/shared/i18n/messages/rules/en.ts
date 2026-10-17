import type { PluralBase } from "../../translator";

/**
 * The words of the readable rules (`src/features/schema/rules`): the sentences that put
 * `CHECK` constraints and foreign keys into words, their group headings and notes. They are
 * spread into the English catalogue, which makes them part of `MessageKey`, and the viewer
 * embeds them by their `rule.` prefix. Sentences end without a period because they are drawn
 * as list items; notes are whole sentences.
 *
 * Every sentence states only what SQL Server enforces when a value is written: a `CHECK`
 * accepts a row whose expression is unknown, so rules over nullable columns sit under a
 * "When … has a value:" heading, and a disabled constraint's rules sit under "When enabled:".
 */
export const englishRuleMessages = {
  "rule.check.eq": "{column} must be equal to {value}",
  "rule.check.ne": "{column} must be different from {value}",
  "rule.check.gt": "{column} must be greater than {value}",
  "rule.check.ge": "{column} must be greater than or equal to {value}",
  "rule.check.lt": "{column} must be less than {value}",
  "rule.check.le": "{column} must be less than or equal to {value}",
  "rule.check.after": "{column} must be after {value}",
  "rule.check.onOrAfter": "{column} must be on or after {value}",
  "rule.check.before": "{column} must be before {value}",
  "rule.check.onOrBefore": "{column} must be on or before {value}",
  "rule.check.range": "{column} must be between {low} and {high}, both included",
  "rule.check.oneOf": "{column} must be one of {values}",
  "rule.check.noneOf": "{column} must be different from {values}",
  "rule.check.required": "{column} must have a value",
  "rule.check.null": "{column} must be NULL",
  "rule.check.notBlank": "{column} must not be empty or contain only spaces",
  "rule.check.notEmpty": "{column} must not be empty",
  "rule.check.startsWith": "{column} must start with {value}",
  "rule.check.endsWith": "{column} must end with {value}, not counting trailing spaces",
  "rule.check.endsWithExactly": "{column} must end with {value}, with no spaces after it",
  "rule.check.contains": "{column} must contain {value}",
  "rule.check.notContains": "{column} must not contain {value}",
  "rule.check.matches": "{column} must match the pattern {pattern}",
  "rule.check.notMatches": "{column} must not match the pattern {pattern}",
  "rule.check.onlyDigits":
    "{column} must contain only digits from 0 to 9; an empty value is accepted too",
  "rule.check.length.exactly.one":
    "{column} must have exactly {count} character, not counting trailing spaces",
  "rule.check.length.exactly.other":
    "{column} must have exactly {count} characters, not counting trailing spaces",
  "rule.check.length.atLeast.one":
    "{column} must have at least {count} character, not counting trailing spaces",
  "rule.check.length.atLeast.other":
    "{column} must have at least {count} characters, not counting trailing spaces",
  "rule.check.length.atMost.one":
    "{column} must have at most {count} character, not counting trailing spaces",
  "rule.check.length.atMost.other":
    "{column} must have at most {count} characters, not counting trailing spaces",
  "rule.check.length.between":
    "{column} must have between {low} and {high} characters, both included, not counting trailing spaces",
  "rule.check.bytes.exactly.one": "{column} must take exactly {count} byte",
  "rule.check.bytes.exactly.other": "{column} must take exactly {count} bytes",
  "rule.check.bytes.atLeast.one": "{column} must take at least {count} byte",
  "rule.check.bytes.atLeast.other": "{column} must take at least {count} bytes",
  "rule.check.bytes.atMost.one": "{column} must take at most {count} byte",
  "rule.check.bytes.atMost.other": "{column} must take at most {count} bytes",
  "rule.check.bytes.between": "{column} must take between {low} and {high} bytes, both included",
  "rule.check.whenPresent.one": "When {columns} has a value:",
  "rule.check.whenPresent.other": "When {columns} have values:",
  "rule.check.anyOf": "At least one of these must hold:",
  "rule.check.unread":
    "This rule can't be put into words. Its definition, as SQL Server stores it:",

  "rule.fk.required": "Each row in {child} belongs to exactly one row in {parent}",
  "rule.fk.optional.one":
    "Each row in {child} belongs to at most one row in {parent}, and to none when {columns} is NULL",
  "rule.fk.optional.other":
    "Each row in {child} belongs to at most one row in {parent}, and to none when any of {columns} is NULL",
  "rule.fk.unknown": "Rows in {child} refer to rows in {parent} through {columns}",
  "rule.fk.self.required":
    "Each row in {child} belongs to exactly one row of the same table, which may be itself",
  "rule.fk.self.optional.one":
    "Each row in {child} belongs to at most one row of the same table, which may be itself, and to none when {columns} is NULL",
  "rule.fk.self.optional.other":
    "Each row in {child} belongs to at most one row of the same table, which may be itself, and to none when any of {columns} is NULL",
  "rule.fk.invisible.required":
    "Each row in {child} belongs to exactly one row in a table not visible to this login",
  "rule.fk.invisible.optional.one":
    "Each row in {child} belongs to at most one row in a table not visible to this login, and to none when {columns} is NULL",
  "rule.fk.invisible.optional.other":
    "Each row in {child} belongs to at most one row in a table not visible to this login, and to none when any of {columns} is NULL",
  "rule.fk.invisible.unknown":
    "Rows in {child} refer through {columns} to rows in a table not visible to this login",
  "rule.fk.parentMany":
    "A row in {parent} can be referenced by any number of rows in {child}, or by none",
  "rule.fk.parentOne": "A row in {parent} can be referenced by at most one row in {child}",
  "rule.fk.self.parentMany":
    "A row in {parent} can be referenced by any number of rows of the same table, or by none",
  "rule.fk.self.parentOne":
    "A row in {parent} can be referenced by at most one row of the same table",
  "rule.fk.delete.noAction":
    "Deleting a row in {parent} is blocked if, once the statement has run, rows in {child} still point to it",
  "rule.fk.self.delete.noAction":
    "Deleting a row in {parent} is blocked if, once the statement has run, rows of the same table still point to it",
  "rule.fk.delete.cascade":
    "Deleting a row in {parent} also deletes the rows in {child} that point to it",
  "rule.fk.delete.setNull":
    "Deleting a row in {parent} sets {columns} to NULL in the rows of {child} that point to it",
  "rule.fk.delete.setDefault.one":
    "Deleting a row in {parent} sets {columns} to its default value in the rows of {child} that point to it; the delete is blocked unless another row in {parent} has that value",
  "rule.fk.delete.setDefault.other":
    "Deleting a row in {parent} sets {columns} to their default values in the rows of {child} that point to it; the delete is blocked unless another row in {parent} has those values",
  "rule.fk.delete.setDefaultNull.one":
    "Deleting a row in {parent} sets {columns} to NULL in the rows of {child} that point to it, as it has no default value",
  "rule.fk.delete.setDefaultNull.other":
    "Deleting a row in {parent} sets {columns} to NULL in the rows of {child} that point to it, as they have no default values",
  "rule.fk.delete.setDefaultNeutral.one":
    "Deleting a row in {parent} sets {columns} to its default value, or to NULL if it has none, in the rows of {child} that point to it; unless the new value is NULL, the delete is blocked when no other row in {parent} has it",
  "rule.fk.delete.setDefaultNeutral.other":
    "Deleting a row in {parent} sets {columns} to their default values, or to NULL where there is none, in the rows of {child} that point to it; unless one of the new values is NULL, the delete is blocked when no other row in {parent} has them",
  "rule.fk.update.noAction.one":
    "Changing {parentColumns} of a row in {parent} is blocked if, once the statement has run, rows in {child} still point to its old value and no row in {parent} has it",
  "rule.fk.update.noAction.other":
    "Changing {parentColumns} of a row in {parent} is blocked if, once the statement has run, rows in {child} still point to its old values and no row in {parent} has them",
  "rule.fk.self.update.noAction.one":
    "Changing {parentColumns} of a row in {parent} is blocked if, once the statement has run, rows of the same table still point to its old value and no row has it",
  "rule.fk.self.update.noAction.other":
    "Changing {parentColumns} of a row in {parent} is blocked if, once the statement has run, rows of the same table still point to its old values and no row has them",
  "rule.fk.update.cascade":
    "Changing {parentColumns} of a row in {parent} also changes {columns} in the rows of {child} that point to it",
  "rule.fk.update.setNull":
    "Changing {parentColumns} of a row in {parent} sets {columns} to NULL in the rows of {child} that pointed to it",
  "rule.fk.update.setDefault.one":
    "Changing {parentColumns} of a row in {parent} sets {columns} to its default value in the rows of {child} that pointed to it; the change is blocked unless, after it, a row in {parent} has that value",
  "rule.fk.update.setDefault.other":
    "Changing {parentColumns} of a row in {parent} sets {columns} to their default values in the rows of {child} that pointed to it; the change is blocked unless, after it, a row in {parent} has those values",
  "rule.fk.update.setDefaultNull.one":
    "Changing {parentColumns} of a row in {parent} sets {columns} to NULL in the rows of {child} that pointed to it, as it has no default value",
  "rule.fk.update.setDefaultNull.other":
    "Changing {parentColumns} of a row in {parent} sets {columns} to NULL in the rows of {child} that pointed to it, as they have no default values",
  "rule.fk.update.setDefaultNeutral.one":
    "Changing {parentColumns} of a row in {parent} sets {columns} to its default value, or to NULL if it has none, in the rows of {child} that pointed to it; unless the new value is NULL, the change is blocked when, after it, no row in {parent} has it",
  "rule.fk.update.setDefaultNeutral.other":
    "Changing {parentColumns} of a row in {parent} sets {columns} to their default values, or to NULL where there is none, in the rows of {child} that pointed to it; unless one of the new values is NULL, the change is blocked when, after it, no row in {parent} has them",
  "rule.fk.update.identity":
    "{parentColumns} is an identity column and never changes, so ON UPDATE {action} has no effect",
  "rule.fk.sqlNote": "Scripted from the catalog, not the statement that created it",

  "rule.whenEnabled": "When enabled:",
  "rule.whenEnabled.notRecorded": "If enabled (this file did not record whether it is):",
  "rule.value.now": "the server's date and time when the value is saved",
  "rule.value.utcNow": "the UTC date and time when the value is saved",
  "rule.value.referencedTable": "the referenced table",
  "rule.value.referencedKey": "the referenced key",
  "rule.note.pattern":
    "In a pattern, % stands for any text, _ for any one character and [ ] for one character from a set.",
  "rule.note.collation":
    "Text comparisons follow the column's collation, which may ignore case, accents or some characters, and two texts that differ only in trailing spaces count as equal.",
  "rule.note.derived":
    "SchemaCraft words these rules from their definitions. SQL Server checks them when values are written, so rows saved before a rule existed may not follow it.",
  "rule.sql.show": "Show SQL",
  "rule.sql.hide": "Hide SQL",
  "rule.sql.copy": "Copy SQL",
  "rule.sql.copied": "Copied",
  "rule.sql.copyFailed": "Could not copy",
} as const;

export type RuleMessageKey = keyof typeof englishRuleMessages;

/** The rule messages that come in `one`/`other` forms, by their common prefix. */
export type RulePluralBase = PluralBase<RuleMessageKey>;

export type RuleMessageCatalog = Readonly<Record<RuleMessageKey, string>>;
