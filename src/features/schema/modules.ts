import type {
  CodeObjectRef,
  ModuleBody,
  Routine,
  SchemaSnapshot,
  Trigger,
} from "@/shared/contracts";

/** Objects inspected outside the diagram; views keep their existing entity selection. */
export type ModuleRef = Extract<CodeObjectRef, { kind: "routine" | "trigger" }>;
export type ModuleKind = "procedure" | "function" | "trigger" | "unknown";

export type ModuleRecord =
  { kind: "routine"; routine: Routine } | { kind: "trigger"; trigger: Trigger };

/** Stable list identity, distinct from a diagram entity and from a trigger on another parent. */
export function moduleKey(ref: ModuleRef): string {
  return ref.kind === "routine"
    ? JSON.stringify(["routine", ref.name.schema, ref.name.name])
    : JSON.stringify(["trigger", ref.parent.schema, ref.parent.name, ref.name]);
}

export function routineModuleKind(kind: Routine["kind"]): Exclude<ModuleKind, "trigger"> {
  return kind === "procedure" ? "procedure" : kind === "unknown" ? "unknown" : "function";
}

/** A lookup preserves the stored type instead of inferring it from an object's name. */
export function findModule(snapshot: SchemaSnapshot, ref: ModuleRef): ModuleRecord | null {
  if (ref.kind === "routine") {
    const routine = snapshot.programmability?.routines.find(
      (item) => item.name.schema === ref.name.schema && item.name.name === ref.name.name,
    );
    return routine === undefined ? null : { kind: "routine", routine };
  }
  const trigger = snapshot.programmability?.triggers.find(
    (item) =>
      item.parent.schema === ref.parent.schema &&
      item.parent.name === ref.parent.name &&
      item.name === ref.name,
  );
  return trigger === undefined ? null : { kind: "trigger", trigger };
}

/** List metadata contains no SQL text; bodies stay in the snapshot and Inspector. */
export interface ModuleListItem {
  key: string;
  ref: ModuleRef;
  kind: ModuleKind;
  schema: string;
  name: string;
  parameterCount: number;
  implementation: ModuleBody["language"];
  isEncrypted: boolean;
}

function bodyMark(body: ModuleBody): Pick<ModuleListItem, "implementation" | "isEncrypted"> {
  return {
    implementation: body.language,
    isEncrypted: body.language === "sql" && body.definition.status === "encrypted",
  };
}

export function listModules(snapshot: SchemaSnapshot): ModuleListItem[] {
  const code = snapshot.programmability;
  if (code === undefined) return [];
  return [
    ...code.routines.map((routine): ModuleListItem => {
      const ref: ModuleRef = { kind: "routine", name: routine.name };
      return {
        key: moduleKey(ref),
        ref,
        kind: routineModuleKind(routine.kind),
        schema: routine.name.schema,
        name: routine.name.name,
        parameterCount: routine.parameters.length,
        ...bodyMark(routine.body),
      };
    }),
    ...code.triggers.map((trigger): ModuleListItem => {
      const ref: ModuleRef = { kind: "trigger", parent: trigger.parent, name: trigger.name };
      return {
        key: moduleKey(ref),
        ref,
        kind: "trigger",
        schema: trigger.parent.schema,
        name: trigger.name,
        parameterCount: 0,
        ...bodyMark(trigger.body),
      };
    }),
  ];
}
