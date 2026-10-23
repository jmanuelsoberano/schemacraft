import { escapeXml } from "@/features/export/svg/text";
import type { ComparisonItem, ComparisonValue, ProjectComparison } from "@/shared/contracts";
import type { Locale } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import type { Translator } from "@/shared/i18n/useI18n";

import {
  dependencyTargetIdentityCounts,
  isDependencyTargetIdentityPath,
} from "./comparisonDependencyEvidence";
import { comparisonObjectLabel } from "./comparisonModel";
import { projectReportCapture, reportCaptureFields } from "./comparisonReportCapture";
import type { ReportCapture } from "./comparisonReportCapture";

/** Translated fixed labels; source projects and connection labels are deliberately absent. */
export interface ComparisonReportLabels {
  title: string;
  reference: string;
  compared: string;
  property: string;
  scope: string;
  limitations: string;
  sourceChanged: string;
  filter: string;
  outcome: (value: ComparisonItem["result"]) => string;
  status: (value: ComparisonValue["observation"]["status"]) => string;
  propertyName: (path: readonly string[]) => string;
  propertyValue: (value: ComparisonValue, path: readonly string[]) => string;
}

/** Side identity survives even when the other side has no contextual diagram. */
export interface ComparisonReportDiagram {
  side: "reference" | "compared";
  svg: string;
}

function observationValue(
  value: ComparisonValue,
  path: readonly string[],
  labels: ComparisonReportLabels,
): string {
  const parts = [labels.status(value.observation.status)];
  if (value.value !== null) {
    if (isDependencyTargetIdentityPath(path)) {
      const counts = dependencyTargetIdentityCounts(value.value);
      if (counts !== null)
        parts.push(
          labels.propertyValue(
            {
              observation: {
                status: value.observation.status,
                readAt: value.observation.readAt,
              },
              value: JSON.stringify(counts),
            },
            path,
          ),
        );
    } else parts.push(labels.propertyValue(value, path));
  }
  if (value.observation.readAt !== null) parts.push(value.observation.readAt);
  return parts.join(" · ");
}

function captureDescription(capture: ReportCapture, translator: Translator): string {
  const fields = reportCaptureFields(capture, translator)
    .map(
      (field) => `<div><dt>${escapeXml(field.label)}</dt><dd>${escapeXml(field.value)}</dd></div>`,
    )
    .join("");
  const limitation = capture.hasUnknownExtensions
    ? `<p>${escapeXml(translator.t("comparison.capture.unknownExtensions"))}</p>`
    : "";
  return `<dl class="capture-facts">${fields}</dl>${limitation}`;
}

/** New comparison properties need an explicit report decision; a generic source slot cannot leak. */
function reportPropertyAllowed(path: readonly string[]): boolean {
  const root = path[0];
  if (root === "dependencies") return path.length === 1 || isDependencyTargetIdentityPath(path);
  if (root === "columns")
    return (
      path.length === 2 ||
      ["dataType", "nullability", "identity", "computed", "defaultExpression"].includes(
        path[2] ?? "",
      )
    );
  if (root === "primaryKey")
    return ["name", "columns", "clustered", "enabled"].includes(path[1] ?? "");
  if (root === "indexes")
    return ["columns", "kind", "clustered", "includedColumns", "filtered", "enabled"].includes(
      path[2] ?? "",
    );
  if (root === "checkConstraints")
    return ["expression", "enabled", "trusted"].includes(path[2] ?? "");
  if (root === "viewSettings") return ["checkOption", "indexed"].includes(path[1] ?? "");
  if (root === "postgresql") {
    const fields: Record<string, readonly string[]> = {
      table: ["kind"],
      view: ["isMaterialized", "isPopulated", "checkOption"],
      columns: ["typeName", "typeKind", "identityGeneration", "generation", "generationExpression"],
      indexes: [
        "method",
        "definition",
        "keyTerms",
        "keyColumns",
        "includedColumns",
        "predicate",
        "isUnique",
        "isValid",
        "isReady",
        "isLive",
        "nullsNotDistinct",
        "wasClustered",
        "constraint",
      ],
      constraints: [
        "kind",
        "definition",
        "isValidated",
        "isEnforced",
        "isDeferrable",
        "isInitiallyDeferred",
        "matchType",
        "deleteSetColumns",
      ],
      routine: [
        "language",
        "returnsSet",
        "result",
        "argumentModes",
        "definitionIsReconstructed",
        "routineBodyTracking",
      ],
      trigger: [
        "level",
        "enabledMode",
        "isConstraint",
        "isDeferrable",
        "isInitiallyDeferred",
        "updateColumns",
      ],
    };
    const family = path[1] ?? "";
    return fields[family]?.includes(path.at(-1) ?? "") ?? false;
  }
  return (
    path.length === 1 &&
    [
      "referencedTable",
      "referencingColumns",
      "referencedColumns",
      "onDelete",
      "onUpdate",
      "enabled",
      "trusted",
      "routineKind",
      "parameters",
      "returns",
      "language",
      "timing",
      "events",
      "notForReplication",
      "definitionState",
    ].includes(root ?? "")
  );
}

/** A scoped offline review. There is no embedded snapshot, module body, annotation or path. */
export function buildComparisonReport(
  comparison: ProjectComparison,
  includedItems: readonly ComparisonItem[],
  diagrams: readonly ComparisonReportDiagram[],
  labels: ComparisonReportLabels,
  locale: Locale,
): string {
  const includedSchemas = new Set(includedItems.map((item) => item.object.name.schema));
  const translator = createCatalogTranslator(messageCatalogs[locale], locale);
  const referenceCapture = projectReportCapture(comparison.reference, includedSchemas);
  const comparedCapture = projectReportCapture(comparison.compared, includedSchemas);
  const rows = includedItems
    .map((item) => {
      const properties = item.properties
        .filter((property) => reportPropertyAllowed(property.path))
        .map(
          (property) =>
            `<tr><th>${escapeXml(labels.propertyName(property.path))}</th><td>${escapeXml(observationValue(property.reference, property.path, labels))}</td><td>${escapeXml(observationValue(property.compared, property.path, labels))}</td></tr>`,
        )
        .join("");
      return `<details open><summary>${escapeXml(comparisonObjectLabel(item.object))} · ${escapeXml(labels.outcome(item.result))}</summary><p>${escapeXml(labels.status(item.reference.status))} → ${escapeXml(labels.status(item.compared.status))}</p>${item.definitionText?.differs ? `<p>${escapeXml(labels.sourceChanged)}</p>` : ""}<table><thead><tr><th>${escapeXml(labels.property)}</th><th>${escapeXml(labels.reference)}</th><th>${escapeXml(labels.compared)}</th></tr></thead><tbody>${properties}</tbody></table></details>`;
    })
    .join("\n");
  return [
    "<!doctype html>",
    `<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`,
    `<title>${escapeXml(labels.title)}</title>`,
    "<style>body{max-width:1200px;margin:2rem auto;padding:0 1rem;font:14px system-ui,sans-serif;color:#1a1c26;background:#fff}details{margin:1rem 0;padding:1rem;border:1px solid #bfc3ce;border-radius:8px}summary{font-weight:600;cursor:pointer}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{padding:.5rem;border:1px solid #bfc3ce;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}.capture-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.75rem 1.5rem}.capture-facts dt{font-weight:600}.capture-facts dd{margin:.25rem 0 0;overflow-wrap:anywhere}.diagram{overflow:auto;max-height:600px}.diagram svg{max-width:100%;height:auto}input{padding:.5rem;width:100%;box-sizing:border-box}[hidden]{display:none!important}</style></head><body>",
    `<h1>${escapeXml(labels.title)}</h1><p>${escapeXml(labels.scope)}</p><p>${escapeXml(labels.limitations)}</p>`,
    `<section class="capture-summary" aria-label="${escapeXml(labels.reference)}"><h2>${escapeXml(labels.reference)}</h2>${captureDescription(referenceCapture, translator)}</section>`,
    `<section class="capture-summary" aria-label="${escapeXml(labels.compared)}"><h2>${escapeXml(labels.compared)}</h2>${captureDescription(comparedCapture, translator)}</section>`,
    `<label>${escapeXml(labels.filter)}<input id="result-filter" type="search"></label>`,
    `<main>${rows}</main>`,
    ...diagrams.map(
      (diagram) =>
        `<section aria-label="${escapeXml(labels[diagram.side])}"><h2>${escapeXml(labels[diagram.side])}</h2><div class="diagram">${diagram.svg}</div></section>`,
    ),
    "<script>document.getElementById('result-filter').addEventListener('input',function(){const q=this.value.toLocaleLowerCase();for(const item of document.querySelectorAll('main>details'))item.hidden=!item.textContent.toLocaleLowerCase().includes(q)});</script>",
    "</body></html>\n",
  ].join("\n");
}
