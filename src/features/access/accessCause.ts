// Why a login sees less than the whole schema, worked out from the access profile frozen in a
// capture, and whether a GRANT can fix it. Every notice names one of these causes, so the user
// reads a specific reason and a specific next step instead of a vague warning.
import type { AccessProfile, SchemaAccess, SchemaSnapshot } from "@/shared/contracts";
import type { Translator } from "@/shared/i18n/useI18n";

export type AccessCause =
  /** The login holds no permission that reveals a table or view. A GRANT fixes it. */
  | { kind: "nothingVisible.noGrant" }
  /**
   * The login holds some permission and sees nothing: the database may be empty, or a DENY the
   * login cannot see may hide everything. SQL Server cannot tell the two apart.
   */
  | { kind: "nothingVisible.hidden" }
  /** The login could see every object, and the database has none. */
  | { kind: "empty" }
  /** Explicit denials limit what the login sees; a GRANT does not lift them. */
  | { kind: "denied"; count: number }
  /** The login cannot see its own denials, so some objects may be hidden. */
  | { kind: "denialsUnknown" }
  /** No `CHECK` or `DEFAULT` text is readable: `VIEW DEFINITION` is missing. */
  | { kind: "noDefinitions" }
  /** `VIEW DEFINITION` is missing on these schemas, so their texts are not visible. */
  | { kind: "someSchemas"; schemas: readonly string[] }
  /** Some texts are not visible although every schema grants `VIEW DEFINITION`. */
  | { kind: "someDefinitions" }
  /** Some tables or views may exist that the login cannot see. */
  | { kind: "someObjects" };

type AccessCauseKind = AccessCause["kind"];

/** Causes only the database administrator can resolve; a GRANT script would not help. */
const DENIAL_KINDS: ReadonlySet<AccessCauseKind> = new Set([
  "nothingVisible.hidden",
  "denied",
  "denialsUnknown",
]);

/** Causes a `GRANT VIEW DEFINITION` on the database resolves. */
const GRANTABLE_KINDS: ReadonlySet<AccessCauseKind> = new Set([
  "nothingVisible.noGrant",
  "noDefinitions",
  "someSchemas",
  "someObjects",
]);

function holdsAnyGrant(profile: AccessProfile): boolean {
  const { probe } = profile;
  return (
    probe.canReadDefinitions ||
    probe.canReadData ||
    probe.schemas.some((schema) => schema.canReadDefinitions || schema.canReadData)
  );
}

/** Schemas of the capture's scope that hold visible objects. */
function visibleSchemasInScope(profile: AccessProfile): SchemaAccess[] {
  const { schemas } = profile.scope;
  return profile.probe.schemas.filter(
    (access) => access.hasVisibleObjects && (schemas.length === 0 || schemas.includes(access.name)),
  );
}

/**
 * Every reason the capture is not complete, most important first: what hides the whole schema,
 * then explicit denials, then missing texts, then missing objects. A full capture has none.
 */
export function accessCauses(profile: AccessProfile): AccessCause[] {
  switch (profile.level) {
    case "full":
      return [];
    case "empty":
      return [{ kind: "empty" }];
    case "nothingVisible":
      return [
        holdsAnyGrant(profile) || profile.probe.explicitDenials !== 0
          ? { kind: "nothingVisible.hidden" }
          : { kind: "nothingVisible.noGrant" },
      ];
    case "partial":
      break;
  }

  const causes: AccessCause[] = [];
  const { explicitDenials } = profile.probe;
  if (explicitDenials === null) {
    causes.push({ kind: "denialsUnknown" });
  } else if (explicitDenials > 0) {
    causes.push({ kind: "denied", count: explicitDenials });
  }

  const { definitions, objects } = profile.coverage;
  if (definitions !== "complete") {
    const visible = visibleSchemasInScope(profile);
    const withoutDefinitions = visible.filter((access) => !access.canReadDefinitions);
    if (definitions === "notAvailable" || withoutDefinitions.length === visible.length) {
      causes.push({ kind: "noDefinitions" });
    } else if (withoutDefinitions.length > 0) {
      causes.push({
        kind: "someSchemas",
        schemas: withoutDefinitions.map((access) => access.name),
      });
    } else {
      causes.push({ kind: "someDefinitions" });
    }
  }

  // A denial already explains missing objects; naming them twice would only add noise.
  if (objects !== "complete" && !causes.some((cause) => DENIAL_KINDS.has(cause.kind))) {
    causes.push({ kind: "someObjects" });
  }
  return causes;
}

/** The cause a one-line notice names, or `null` for a full capture. */
export function primaryCause(profile: AccessProfile): AccessCause | null {
  return accessCauses(profile)[0] ?? null;
}

/**
 * What a read with partial access leaves out, so the notice promises only the marks the user
 * will find: tables and views the login cannot see are simply absent from the diagram, while
 * `CHECK` and `DEFAULT` texts it cannot read are shown as not available.
 */
export type PartialReadOutcome = "objects" | "definitions" | "both";

/** What `profile`, a partial capture, leaves out; a complete one leaves out nothing. */
export function partialReadOutcome(profile: AccessProfile): PartialReadOutcome {
  const { objects, definitions } = profile.coverage;
  if (objects !== "complete" && definitions !== "complete") {
    return "both";
  }
  return objects === "complete" ? "definitions" : "objects";
}

/**
 * Whether a `GRANT VIEW DEFINITION` would let this login read what it misses. Never with an
 * explicit denial, seen or unseen: a GRANT does not lift a DENY, so only the administrator can
 * help, and offering a script would send the user the wrong way.
 */
export function grantHelps(profile: AccessProfile): boolean {
  const causes = accessCauses(profile);
  return (
    !causes.some((cause) => DENIAL_KINDS.has(cause.kind)) &&
    causes.some((cause) => GRANTABLE_KINDS.has(cause.kind))
  );
}

/** The sentence that explains `cause`, in the translator's language. */
export function describeAccessCause(cause: AccessCause, translator: Translator): string {
  const { t, tCount, locale } = translator;
  switch (cause.kind) {
    case "nothingVisible.noGrant":
      return t("access.cause.nothingVisible.noGrant");
    case "nothingVisible.hidden":
      return t("access.cause.nothingVisible.hidden");
    case "empty":
      return t("access.cause.empty");
    case "denied":
      return tCount("access.cause.denied", cause.count);
    case "denialsUnknown":
      return t("access.cause.denialsUnknown");
    case "noDefinitions":
      return t("access.cause.noDefinitions");
    case "someSchemas":
      return t("access.cause.someSchemas", {
        schemas: new Intl.ListFormat(locale, { type: "conjunction" }).format(cause.schemas),
      });
    case "someDefinitions":
      return t("access.cause.someDefinitions");
    case "someObjects":
      return t("access.cause.someObjects");
  }
}

/** Code gaps are reported apart from the access verdict used by diagrams and exports. */
export function codeCaptureCause(
  snapshot: SchemaSnapshot,
  family: "objects" | "definitions",
  translator: Translator,
): string | null {
  const { t } = translator;
  const state = snapshot.programmability?.capture[family];
  if (state === undefined) return t("access.code.notRecorded");
  if (state.status === "unknown") return t("access.code.unknown");
  if (state.status === "notRead") return t(`access.code.${state.reason}`);
  const profile = snapshot.access;
  const completeness =
    family === "objects" ? profile?.coverage.programmability : profile?.coverage.moduleDefinitions;
  if (completeness === undefined || completeness === "complete") return null;
  if (family === "definitions") return t("access.code.textsPartial");
  if (profile?.probe.executeDenials === undefined) return t("access.code.executeUnknown");
  if (profile.probe.executeDenials > 0) return t("access.code.executeDenied");
  return t("access.code.objectsPartial");
}

/** A failed query or an option is never diagnosed as a missing permission. */
export function codeGrantHelps(snapshot: SchemaSnapshot): boolean {
  const access = snapshot.access;
  const capture = snapshot.programmability?.capture;
  return (
    access !== undefined &&
    capture !== undefined &&
    access.probe.explicitDenials === 0 &&
    access.probe.executeDenials === 0 &&
    ((capture.objects.status === "read" &&
      access.coverage.programmability !== undefined &&
      access.coverage.programmability !== "complete") ||
      (capture.definitions.status === "read" &&
        access.coverage.moduleDefinitions !== undefined &&
        access.coverage.moduleDefinitions !== "complete"))
  );
}
