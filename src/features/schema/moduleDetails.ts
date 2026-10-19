import type {
  CodeObjectRef,
  Column,
  ModuleBody,
  NotReadReason,
  Parameter,
  Programmability,
  QualifiedName,
  SchemaSnapshot,
  Trigger,
} from "@/shared/contracts";

import { formatDataType } from "./dataType";
import { entityKey } from "./entities";
import { findModule, moduleKey, routineModuleKind } from "./modules";
import type { ModuleKind, ModuleRef } from "./modules";
import type { DetailsScope } from "./objectDetails";

/** Desktop-only facts: SQL text never enters the shared HTML detail model. */
export interface ModuleDefinitionFacts {
  status: "readable" | "notVisible" | "encrypted" | "clr" | "notRecorded" | "notRead";
  text: string | null;
  /** Kept states, as well as kept text, can be unverified after a failed read. */
  notCheckedSince: string | null;
  reason: NotReadReason | null;
  viewSettings: { hasCheckOption: boolean; isIndexed: boolean } | null;
}

export interface ModuleParentFacts {
  name: QualifiedName;
  key: string | null;
  unavailable: "hidden" | "unknown" | null;
  kind: "table" | "view" | null;
}

export type ModuleSection =
  | { kind: "parameters"; items: readonly Parameter[]; hasSqlDefaultsNote: boolean }
  | { kind: "returns"; scalarType: string | null; columns: readonly Column[] | null }
  | { kind: "runs"; trigger: Trigger; parent: ModuleParentFacts }
  | { kind: "definition"; definition: ModuleDefinitionFacts };

export interface ModuleDetails {
  key: string;
  kind: ModuleKind;
  name: QualifiedName;
  notCheckedSince: string | null;
  sections: readonly ModuleSection[];
}

function sameName(left: QualifiedName, right: QualifiedName): boolean {
  return left.schema === right.schema && left.name === right.name;
}

function sameCodeObject(left: CodeObjectRef, right: CodeObjectRef): boolean {
  switch (left.kind) {
    case "view":
      return right.kind === "view" && sameName(left.name, right.name);
    case "routine":
      return right.kind === "routine" && sameName(left.name, right.name);
    case "trigger":
      return (
        right.kind === "trigger" && sameName(left.parent, right.parent) && left.name === right.name
      );
    case "unknown":
      return false;
  }
}

function carriedDate(
  code: Programmability | undefined,
  ref: CodeObjectRef,
  part: "whole" | "definition",
): string | null {
  return (
    code?.carriedOver?.find((item) => item.part === part && sameCodeObject(item.object, ref))
      ?.readAt ?? null
  );
}

function describeDefinition(
  code: Programmability | undefined,
  ref: CodeObjectRef,
  body: ModuleBody | null,
): ModuleDefinitionFacts {
  const base = {
    text: null,
    notCheckedSince: carriedDate(code, ref, "definition") ?? carriedDate(code, ref, "whole"),
    reason: null,
    viewSettings: null,
  };
  if (body?.language === "clr") return { ...base, status: "clr" };
  if (body?.language === "unknown") return { ...base, status: "notVisible" };
  const definition = body?.definition;
  if (definition?.status === "readable")
    return { ...base, status: "readable", text: definition.text };
  if (definition?.status === "encrypted") return { ...base, status: "encrypted" };
  if (definition?.status === "notVisible" || definition?.status === "unknown") {
    return { ...base, status: "notVisible" };
  }
  const capture = code?.capture.definitions;
  if (capture?.status === "notRead") return { ...base, status: "notRead", reason: capture.reason };
  return { ...base, status: "notRecorded" };
}

function parentFacts(
  snapshot: SchemaSnapshot,
  name: QualifiedName,
  scope: DetailsScope,
): ModuleParentFacts {
  const key = entityKey(name);
  const kind = snapshot.tables.some((table) => sameName(table.name, name))
    ? "table"
    : snapshot.views.some((view) => sameName(view.name, name))
      ? "view"
      : null;
  const unavailable = kind === null ? "unknown" : scope.hiddenKeys.has(key) ? "hidden" : null;
  return { name, kind, unavailable, key: unavailable === null ? key : null };
}

/** Parameters keep declaration order; defaults remain solely in the stored SQL text. */
export function describeModuleDetails(
  snapshot: SchemaSnapshot,
  ref: ModuleRef,
  scope: DetailsScope,
): ModuleDetails | null {
  const record = findModule(snapshot, ref);
  if (record === null) return null;
  const code = snapshot.programmability;
  const base = { key: moduleKey(ref), notCheckedSince: carriedDate(code, ref, "whole") };
  if (record.kind === "trigger") {
    const { trigger } = record;
    return {
      ...base,
      kind: "trigger",
      name: { schema: trigger.parent.schema, name: trigger.name },
      sections: [
        { kind: "runs", trigger, parent: parentFacts(snapshot, trigger.parent, scope) },
        { kind: "definition", definition: describeDefinition(code, ref, trigger.body) },
      ],
    };
  }
  const { routine } = record;
  const kind = routineModuleKind(routine.kind);
  const sections: ModuleSection[] = [
    {
      kind: "parameters",
      items: [...routine.parameters].sort(
        (left, right) => left.ordinalPosition - right.ordinalPosition,
      ),
      hasSqlDefaultsNote: routine.body.language === "sql",
    },
  ];
  if (kind === "function") {
    const table = routine.kind === "tableFunction" || routine.kind === "inlineTableFunction";
    sections.push({
      kind: "returns",
      scalarType: routine.returns === null ? null : formatDataType(routine.returns),
      columns: table
        ? [...routine.columns].sort((left, right) => left.ordinalPosition - right.ordinalPosition)
        : null,
    });
  }
  sections.push({ kind: "definition", definition: describeDefinition(code, ref, routine.body) });
  return { ...base, kind, name: routine.name, sections };
}

/** Appended only by the desktop Inspector, even for a project that predates code capture. */
export function describeViewDefinition(
  snapshot: SchemaSnapshot,
  key: string,
): ModuleDefinitionFacts | null {
  const view = snapshot.views.find((item) => entityKey(item.name) === key);
  if (view === undefined) return null;
  const code = snapshot.programmability;
  const module = code?.views.find((item) => sameName(item.view, view.name));
  const facts = describeDefinition(
    code,
    { kind: "view", name: view.name },
    module === undefined ? null : { language: "sql", definition: module.definition },
  );
  return {
    ...facts,
    viewSettings:
      module === undefined
        ? null
        : { hasCheckOption: module.hasCheckOption, isIndexed: module.isIndexed },
  };
}
