import type { RuleView } from "@/features/schema/objectDetailsView";

/**
 * Whether a rule item shows its SQL, with what that was decided for. The SQL is shown from the
 * start when the rule cannot be put into words, since it is all the item has, and hidden
 * otherwise; Show SQL and Hide SQL change that while the item shows the same rule. Given a rule
 * with another SQL text or another readability, as when a refresh leaves a `CHECK` unreadable,
 * the item starts over.
 */
export interface SqlDisclosure {
  sql: string | null;
  isUnread: boolean;
  isOpen: boolean;
}

/** The disclosure for `rule`: `current` while it is still for that rule, a fresh one otherwise. */
export function sqlDisclosure(rule: RuleView, current?: SqlDisclosure): SqlDisclosure {
  const isUnread = rule.unread !== null;
  return current?.sql === rule.sql && current.isUnread === isUnread
    ? current
    : { sql: rule.sql, isUnread, isOpen: isUnread };
}
