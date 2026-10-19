import type { MessageKey } from "@/shared/i18n/messages/en";
import type { CatalogTranslator } from "@/shared/i18n/translator";

import type { TriggerBadge } from "./geometry";

type TriggerBadgeTranslator = CatalogTranslator<Extract<MessageKey, `entity.triggers.${string}`>>;

/** Full sentences shared by accessible names, tooltips and exported SVG titles. */
export function triggerBadgeLabel(badge: TriggerBadge, { tCount }: TriggerBadgeTranslator): string {
  const sentences = [];
  if (badge.enabled > 0) sentences.push(tCount("entity.triggers.enabled", badge.enabled));
  if (badge.insteadOf > 0) sentences.push(tCount("entity.triggers.insteadOf", badge.insteadOf));
  if (badge.disabled > 0) sentences.push(tCount("entity.triggers.disabled", badge.disabled));
  if (badge.allDisabled && badge.disabledInsteadOf > 0)
    sentences.push(tCount("entity.triggers.disabledInsteadOf", badge.disabledInsteadOf));
  return sentences.join(" ");
}
