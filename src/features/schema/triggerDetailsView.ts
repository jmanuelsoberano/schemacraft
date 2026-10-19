import type { Trigger } from "@/shared/contracts";
import { formatMessageParts } from "@/shared/i18n/formatMessage";
import type { MessagePart } from "@/shared/i18n/formatMessage";
import type { MessageKey } from "@/shared/i18n/messages/en";
import type { CatalogTranslator } from "@/shared/i18n/translator";

export type TriggerMessageKey = Extract<MessageKey, `trigger.${string}`>;
export type TriggerTranslator = CatalogTranslator<TriggerMessageKey>;
export type TriggerMetadata = Pick<
  Trigger,
  "timing" | "events" | "isEnabled" | "isNotForReplication"
>;
export interface TriggerEventView {
  parts: readonly MessagePart<string>[];
  order: string | null;
}

/** One sentence per event keeps First/Last attached to the statement to which it applies. */
export function presentTriggerEvents(
  trigger: TriggerMetadata,
  { t, template }: TriggerTranslator,
): TriggerEventView[] {
  const order = { insert: 0, update: 1, delete: 2, unknown: 3 };
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
  const notes: string[] = [];
  if (!trigger.isEnabled) notes.push(t("trigger.state.disabled"));
  if (trigger.timing !== "unknown") notes.push(t(`trigger.note.${trigger.timing}`));
  if (trigger.timing === "after") notes.push(t("trigger.note.order"));
  if (trigger.isNotForReplication) notes.push(t("trigger.note.replication"));
  return [...notes, ...triggerExceptionNotes([trigger], parentKind, t)];
}
