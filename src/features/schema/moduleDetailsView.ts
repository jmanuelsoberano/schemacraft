import { formatDate } from "@/shared/i18n/formatDate";
import { formatMessageParts } from "@/shared/i18n/formatMessage";
import type { MessagePart } from "@/shared/i18n/formatMessage";
import type { MessageKey } from "@/shared/i18n/messages/en";
import type { CatalogTranslator } from "@/shared/i18n/translator";

import { formatDataType } from "./dataType";
import { entityKey } from "./entities";
import type { ModuleDefinitionFacts, ModuleDetails, ModuleSection } from "./moduleDetails";
import type { ModuleKind } from "./modules";
import type { BadgeView, ColumnsSectionView } from "./objectDetailsView";

/** This catalogue is deliberately excluded from the standalone HTML viewer. */
export type ModuleTranslator = CatalogTranslator<Extract<MessageKey, `module.${string}`>>;

export interface DefinitionSectionView {
  kind: "definition";
  title: string;
  state: ModuleDefinitionFacts["status"] | "notChecked";
  stateLabel: string;
  explanation: string | null;
  text: string | null;
  notice: string | null;
  canExplainAccess: boolean;
  badges: readonly { label: string; hint: string }[];
}

export interface ParametersSectionView {
  kind: "parameters";
  title: string;
  headers: { name: string; type: string };
  items: readonly { name: string; type: string; badges: readonly string[] }[];
  emptyText: string | null;
  note: string | null;
}

export interface ReturnsSectionView {
  kind: "returns";
  title: string;
  scalarType: string | null;
  columns: ColumnsSectionView | null;
  emptyText: string | null;
}

export interface RunsSectionView {
  kind: "runs";
  title: string;
  parent: { label: string; key: string | null; goLabel: string; stateLabel: string | null };
  events: readonly { parts: readonly MessagePart<string>[]; order: string | null }[];
  emptyText: string | null;
  badges: readonly string[];
  notes: readonly string[];
}

export type ModuleSectionView =
  ParametersSectionView | ReturnsSectionView | RunsSectionView | DefinitionSectionView;

export interface ModuleDetailsView {
  key: string;
  kind: ModuleKind;
  kindLabel: string;
  schema: string;
  name: string;
  notice: string | null;
  sections: readonly ModuleSectionView[];
}

export function presentModuleDefinition(
  facts: ModuleDefinitionFacts,
  translator: ModuleTranslator,
): DefinitionSectionView {
  const { t } = translator;
  const state =
    facts.status === "readable" && facts.notCheckedSince !== null ? "notChecked" : facts.status;
  const keptInvisible = facts.status === "notVisible" && facts.notCheckedSince !== null;
  const notice =
    facts.notCheckedSince === null
      ? null
      : t("module.definition.notChecked", {
          date: formatDate(facts.notCheckedSince, translator.locale),
        });
  const explanation = keptInvisible
    ? t("module.definition.keptNotVisible.body")
    : facts.status === "readable"
      ? null
      : facts.status === "notRead"
        ? t(
            facts.reason === "optionOff"
              ? "module.definition.optionOff"
              : facts.reason === "timedOut"
                ? "module.definition.timedOut"
                : "module.definition.readFailed",
          )
        : t(`module.definition.${facts.status}.body`);
  const badges = [];
  if (facts.viewSettings?.hasCheckOption)
    badges.push({ label: "WITH CHECK OPTION", hint: t("module.view.checkOption") });
  if (facts.viewSettings?.isIndexed)
    badges.push({ label: t("module.view.indexed"), hint: t("module.view.indexedHint") });
  return {
    kind: "definition",
    title: t("module.section.definition"),
    state,
    stateLabel: t(
      keptInvisible ? "module.definition.keptNotVisible.title" : `module.definition.${state}.title`,
    ),
    explanation,
    text: facts.text,
    notice,
    canExplainAccess: facts.status === "notVisible",
    badges,
  };
}

function parametersView(
  section: Extract<ModuleSection, { kind: "parameters" }>,
  { t }: ModuleTranslator,
): ParametersSectionView {
  return {
    kind: "parameters",
    title: t("module.section.parameters"),
    headers: { name: t("module.column.name"), type: t("module.column.type") },
    items: section.items.map((item) => ({
      name: item.name,
      type: formatDataType(item.dataType),
      badges: [...(item.isOutput ? ["OUTPUT"] : []), ...(item.isReadOnly ? ["READONLY"] : [])],
    })),
    emptyText: section.items.length === 0 ? t("module.parameters.empty") : null,
    note: section.hasSqlDefaultsNote ? t("module.parameters.defaults") : null,
  };
}

function returnsView(
  section: Extract<ModuleSection, { kind: "returns" }>,
  { t }: ModuleTranslator,
): ReturnsSectionView {
  const columns: ColumnsSectionView | null =
    section.columns === null
      ? null
      : {
          kind: "columns",
          title: t("module.section.returns"),
          count: section.columns.length,
          completeness: "complete",
          emptyText: null,
          footnote: null,
          notes: [],
          headers: {
            name: t("module.column.name"),
            type: t("module.column.type"),
            nullable: t("module.column.nullable"),
          },
          items: section.columns.map((column) => ({
            name: column.name,
            type: formatDataType(column.dataType),
            isNullable: column.isNullable,
            nullable: t(column.isNullable ? "module.value.yes" : "module.value.no"),
            badges: [
              ...(column.isIdentity
                ? [{ kind: "identity", label: "IDENTITY" } satisfies BadgeView]
                : []),
              ...(column.isComputed
                ? [{ kind: "computed", label: "COMPUTED" } satisfies BadgeView]
                : []),
            ],
            defaultValue: null,
          })),
        };
  return {
    kind: "returns",
    title: t("module.section.returns"),
    scalarType: section.scalarType,
    columns,
    emptyText:
      section.scalarType === null && (columns === null || columns.items.length === 0)
        ? t("module.returns.notRecorded")
        : null,
  };
}

function runsView(
  section: Extract<ModuleSection, { kind: "runs" }>,
  translator: ModuleTranslator,
): RunsSectionView {
  const { t, template } = translator;
  const { trigger, parent } = section;
  const notes: string[] = [];
  if (!trigger.isEnabled) notes.push(t("module.runs.disabled"));
  if (trigger.timing !== "unknown") notes.push(t(`module.runs.note.${trigger.timing}`));
  if (trigger.timing === "after") notes.push(t("module.runs.note.order"));
  if (trigger.isNotForReplication) notes.push(t("module.runs.note.replication"));
  if (parent.kind === "table" && trigger.events.some((item) => item.event === "delete"))
    notes.push(t("module.runs.note.truncate"));
  if (trigger.events.some((item) => item.event === "insert"))
    notes.push(t("module.runs.note.bulk"));
  const order = { insert: 0, update: 1, delete: 2, unknown: 3 };
  const events = [...trigger.events]
    .sort((left, right) => order[left.event] - order[right.event])
    .map((item) => ({
      parts: formatMessageParts(template(`module.runs.${trigger.timing}`), {
        event: item.event === "unknown" ? t("module.runs.unknownEvent") : item.event.toUpperCase(),
      }),
      order:
        item.order === "first" || item.order === "last"
          ? t(`module.runs.order.${item.order}`, {
              event:
                item.event === "unknown" ? t("module.runs.unknownEvent") : item.event.toUpperCase(),
            })
          : item.order === "unknown"
            ? t("module.runs.order.unknown")
            : null,
    }));
  return {
    kind: "runs",
    title: t("module.section.runs"),
    parent: {
      label: entityKey(parent.name),
      key: parent.key,
      goLabel: t("module.parent.go", { name: entityKey(parent.name) }),
      stateLabel: parent.unavailable === null ? null : t(`module.parent.${parent.unavailable}`),
    },
    events,
    emptyText: events.length === 0 ? t("module.runs.empty") : null,
    badges: [
      ...(!trigger.isEnabled ? [t("module.badge.disabled")] : []),
      ...(trigger.isNotForReplication ? ["NOT FOR REPLICATION"] : []),
    ],
    notes,
  };
}

/** All prose is translated here; renderers only arrange facts and links. */
export function presentModuleDetails(
  details: ModuleDetails,
  translator: ModuleTranslator,
): ModuleDetailsView {
  return {
    key: details.key,
    kind: details.kind,
    kindLabel: translator.t(`module.kind.${details.kind}`),
    schema: details.name.schema,
    name: details.name.name,
    notice:
      details.notCheckedSince === null
        ? null
        : translator.t("module.notice.notChecked", {
            date: formatDate(details.notCheckedSince, translator.locale),
          }),
    sections: details.sections.map((section) => {
      switch (section.kind) {
        case "parameters":
          return parametersView(section, translator);
        case "returns":
          return returnsView(section, translator);
        case "runs":
          return runsView(section, translator);
        case "definition":
          return presentModuleDefinition(section.definition, translator);
      }
    }),
  };
}
