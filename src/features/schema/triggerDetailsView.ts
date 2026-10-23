import type { PostgresqlTrigger, Trigger } from "@/shared/contracts";
import { qualifiedNameLabel } from "./entities";
import { formatMessageParts } from "@/shared/i18n/formatMessage";
import type { MessagePart } from "@/shared/i18n/formatMessage";
import type { MessageKey } from "@/shared/i18n/messages/en";
import type { CatalogTranslator } from "@/shared/i18n/translator";

export type TriggerMessageKey = Extract<MessageKey, `trigger.${string}`>;
export type TriggerTranslator = CatalogTranslator<TriggerMessageKey>;
export type TriggerMetadata = Pick<
  Trigger,
  "timing" | "events" | "isEnabled" | "isNotForReplication"
> & { provider?: "postgreSql"; native?: PostgresqlTrigger };
export interface TriggerEventView {
  parts: readonly MessagePart<string>[];
  order: string | null;
}

/** One sentence per event keeps First/Last attached to the statement to which it applies. */
export function presentTriggerEvents(
  trigger: TriggerMetadata,
  { t, template }: TriggerTranslator,
): TriggerEventView[] {
  const order = { insert: 0, update: 1, delete: 2, truncate: 3, unknown: 4 };
  return [...trigger.events]
    .sort((left, right) => order[left.event] - order[right.event])
    .map((item) => {
      const event =
        item.event === "unknown" ? t("trigger.event.unknownName") : item.event.toUpperCase();
      return {
        parts: formatMessageParts(template(`trigger.event.${trigger.timing}`), { event }),
        order:
          item.order === "first" || item.order === "last"
            ? t(`trigger.order.${item.order}`, { event })
            : item.order === "unknown"
              ? t("trigger.order.unknown")
              : null,
      };
    });
}

export function presentTriggerBadges(trigger: TriggerMetadata, { t }: TriggerTranslator): string[] {
  if (trigger.provider === "postgreSql")
    return [
      ...(!trigger.isEnabled ? [t("trigger.badge.disabled")] : []),
      ...(trigger.native?.level === "row" || trigger.native?.level === "statement"
        ? [t(`trigger.native.level.${trigger.native.level}`)]
        : []),
      ...(trigger.native?.enabledMode === "origin" ||
      trigger.native?.enabledMode === "replica" ||
      trigger.native?.enabledMode === "always"
        ? [t(`trigger.native.mode.${trigger.native.enabledMode}`)]
        : []),
      ...(trigger.native?.isConstraint === true ? [t("trigger.native.constraint")] : []),
    ];
  return [
    ...(!trigger.isEnabled ? [t("trigger.badge.disabled")] : []),
    ...(trigger.isNotForReplication ? ["NOT FOR REPLICATION"] : []),
  ];
}

/** The same timing and exception rules serve a trigger page and the entity's trigger list. */
export function triggerListNotes(
  triggers: readonly TriggerMetadata[],
  parentKind: "table" | "view" | null,
  { t }: TriggerTranslator,
): string[] {
  if (triggers.some((trigger) => trigger.provider === "postgreSql"))
    return triggers.length > 0 ? [t("trigger.native.order")] : [];
  const notes: string[] = [];
  if (triggers.some((trigger) => trigger.timing === "after")) notes.push(t("trigger.note.order"));
  return [...notes, ...triggerExceptionNotes(triggers, parentKind, t)];
}

function triggerExceptionNotes(
  triggers: readonly TriggerMetadata[],
  parentKind: "table" | "view" | null,
  t: TriggerTranslator["t"],
): string[] {
  const notes: string[] = [];
  if (
    parentKind === "table" &&
    triggers.some((trigger) => trigger.events.some((item) => item.event === "delete"))
  )
    notes.push(t("trigger.note.truncate"));
  if (triggers.some((trigger) => trigger.events.some((item) => item.event === "insert")))
    notes.push(t("trigger.note.bulk"));
  return notes;
}

export function triggerRunNotes(
  trigger: TriggerMetadata,
  parentKind: "table" | "view" | null,
  translator: TriggerTranslator,
): string[] {
  const { t } = translator;
  if (trigger.provider === "postgreSql") {
    const native = trigger.native;
    const functionRef = native?.function;
    const functionName =
      functionRef?.kind === "routine" || functionRef?.kind === "routineOverload"
        ? qualifiedNameLabel(functionRef.name)
        : null;
    return [
      ...(!trigger.isEnabled ? [t("trigger.state.disabled")] : []),
      t("trigger.native.order"),
      ...(native === undefined
        ? []
        : [
            t("trigger.native.deferrable", {
              value: t(
                native.isDeferrable ? "trigger.native.value.yes" : "trigger.native.value.no",
              ),
              deferred: t(
                native.isInitiallyDeferred ? "trigger.native.value.yes" : "trigger.native.value.no",
              ),
            }),
          ]),
      ...(native?.updateColumns.length
        ? [t("trigger.native.updateColumns", { columns: native.updateColumns.join(", ") })]
        : []),
      ...(functionName === null ? [] : [t("trigger.native.function", { name: functionName })]),
    ];
  }
  const notes: string[] = [];
  if (!trigger.isEnabled) notes.push(t("trigger.state.disabled"));
  if (trigger.timing === "after" || trigger.timing === "insteadOf")
    notes.push(t(`trigger.note.${trigger.timing}`));
  if (trigger.timing === "after") notes.push(t("trigger.note.order"));
  if (trigger.isNotForReplication) notes.push(t("trigger.note.replication"));
  return [...notes, ...triggerExceptionNotes([trigger], parentKind, t)];
}
