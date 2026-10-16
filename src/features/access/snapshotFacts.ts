import type { SnapshotFact } from "@/shared/contracts";
import type { Translator } from "@/shared/i18n/useI18n";

/**
 * Which fact of an object a carried or newly available entry is about, e.g. "Table",
 * "Default of PlacedAt" or "Check CK_Orders_Status".
 */
export function describeSnapshotFact(fact: SnapshotFact, t: Translator["t"]): string {
  switch (fact.kind) {
    case "table":
      return t("access.fact.table");
    case "view":
      return t("access.fact.view");
    case "columnDefault":
      return t("access.fact.columnDefault", { column: fact.column });
    case "checkConstraint":
      return t("access.fact.checkConstraint", { name: fact.name });
    case "foreignKey":
      return t("access.fact.foreignKey", { name: fact.name });
  }
}
