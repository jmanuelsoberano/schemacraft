import type {
  CodeObjectRef,
  ModuleBody,
  Routine,
  SchemaSnapshot,
  Trigger,
} from "@/shared/contracts";
import { qualifiedNameLabel } from "./entities";
import type { RoutineTrackingState } from "./routineDependencyTracking";

/** Objects inspected outside the diagram; views keep their existing entity selection. */
export type ModuleRef = Extract<CodeObjectRef, { kind: "routine" | "routineOverload" | "trigger" }>;
export type ModuleKind = "procedure" | "function" | "trigger" | "unknown";

export type ModuleRecord =
  { kind: "routine"; routine: Routine } | { kind: "trigger"; trigger: Trigger };

/** Stable list identity, distinct from a diagram entity and from a trigger on another parent. */
export function moduleKey(ref: ModuleRef): string {
  if (ref.kind === "trigger")
    return JSON.stringify(["trigger", ref.parent.schema, ref.parent.name, ref.name]);
  return ref.kind === "routine"
    ? JSON.stringify(["routine", ref.name.schema, ref.name.name])
    : JSON.stringify([
        "routineOverload",
        ref.name.schema,
        ref.name.name,
        ref.argumentTypes.map((type) => [type.schema, type.name]),
      ]);
}

/** PostgreSQL overload signatures include zero-argument routines; SQL Server keeps old identity. */
export function routineRef(routine: Routine): Exclude<ModuleRef, { kind: "trigger" }> {
  return routine.identityArguments == null
    ? { kind: "routine", name: routine.name }
    : { kind: "routineOverload", name: routine.name, argumentTypes: routine.identityArguments };
}

/** The same overload signature is visible in the sidebar and the module heading. */
export function routineDisplayName(routine: Routine): string {
  return routine.identityArguments === undefined
    ? routine.name.name
    : `${routine.name.name}(${routine.identityArguments.map(qualifiedNameLabel).join(", ")})`;
}

export function routineModuleKind(kind: Routine["kind"]): Exclude<ModuleKind, "trigger"> {
  return kind === "procedure" ? "procedure" : kind === "unknown" ? "unknown" : "function";
}

/** A lookup preserves the stored type instead of inferring it from an object's name. */
export function findModule(snapshot: SchemaSnapshot, ref: ModuleRef): ModuleRecord | null {
  if (ref.kind !== "trigger") {
    const routine = snapshot.programmability?.routines.find(
      (item) => moduleKey(routineRef(item)) === moduleKey(ref),
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
  routineBodyTracking?: RoutineTrackingState;
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
  const nativeTracking = new Map(
    (snapshot.postgresql?.routines ?? []).flatMap((routine) =>
      routine.object.kind === "routine" || routine.object.kind === "routineOverload"
        ? [[moduleKey(routine.object), routine.routineBodyTracking] as const]
        : [],
    ),
  );
  return [
    ...code.routines.map((routine): ModuleListItem => {
      const ref: ModuleRef = routineRef(routine);
      return {
        key: moduleKey(ref),
        ref,
        kind: routineModuleKind(routine.kind),
        schema: routine.name.schema,
        name: routineDisplayName(routine),
        parameterCount: routine.parameters.length,
        ...(snapshot.provider === "postgreSql"
          ? { routineBodyTracking: nativeTracking.get(moduleKey(ref)) ?? "notRecorded" }
          : {}),
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
