import { describe, expect, it } from "vitest";

import type {
  CarriedFact,
  NotReadReason,
  Programmability,
  SchemaSnapshot,
  Trigger,
} from "@/shared/contracts";
import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

import { triggerCapture, triggerReadAt, triggersOf } from "./triggerDetails";

const PARENT = { schema: "sales", name: "Orders" };
const READ_AT = "2026-10-12T08:00:00Z";
const REF = { kind: "trigger", parent: PARENT, name: "Audit" } as const;

function snapshot(overrides: Partial<Programmability> = {}): SchemaSnapshot {
  return {
    ...previewSnapshot("Shop", "partial"),
    programmability: {
      capture: {
        objects: { status: "read" },
        definitions: { status: "notRead", reason: "optionOff" },
      },
      routines: [],
      views: [],
      triggers: [],
      ...overrides,
    },
  };
}

function trigger(name: string, timing: Trigger["timing"], isEnabled: boolean): Trigger {
  return {
    parent: PARENT,
    name,
    timing,
    isEnabled,
    isNotForReplication: false,
    events: [{ event: "insert", order: "unspecified" }],
    body: { language: "sql", definition: { status: "notRecorded" } },
  };
}

describe("triggerCapture", () => {
  it("vouches for a current parent's metadata independently of database or text coverage", () => {
    expect(triggerCapture(snapshot(), PARENT)).toEqual({ status: "complete" });
    const old = snapshot();
    delete old.programmability;
    expect(triggerCapture(old, PARENT)).toEqual({ status: "notRecorded" });
    expect(
      triggerCapture(
        snapshot({
          capture: { objects: { status: "unknown" }, definitions: { status: "unknown" } },
        }),
        PARENT,
      ),
    ).toEqual({ status: "notRecorded" });
  });

  it.each<NotReadReason>(["optionOff", "queryFailed", "timedOut", "unknown"])(
    "preserves the %s reason without asserting an empty list",
    (reason) => {
      const result = triggerCapture(
        snapshot({
          capture: { objects: { status: "notRead", reason }, definitions: { status: "unknown" } },
        }),
        PARENT,
      );
      expect(result).toEqual({ status: "notRead", reason });
    },
  );

  it("dates a whole parent even when an exported snapshot has no code ledger or trigger rows", () => {
    const kept: CarriedFact[] = [{ object: PARENT, fact: { kind: "table" }, readAt: READ_AT }];
    expect(triggerCapture(snapshot(), PARENT, kept)).toEqual({
      status: "notChecked",
      readAt: READ_AT,
    });
    expect(triggerCapture(snapshot(), { schema: "sales", name: "Other" }, kept)).toEqual({
      status: "complete",
    });
  });

  it("dates whole triggers but not definition-only retention, including exact parent/name identity", () => {
    const held = snapshot({ carriedOver: [{ object: REF, part: "whole", readAt: READ_AT }] });
    expect(triggerCapture(held, PARENT)).toEqual({ status: "notChecked", readAt: READ_AT });
    expect(triggerReadAt(held, REF)).toBe(READ_AT);
    expect(triggerReadAt(held, { ...REF, name: "Other" })).toBeNull();
    expect(triggerCapture(held, { schema: "other", name: "Orders" })).toEqual({
      status: "complete",
    });
    const text = snapshot({ carriedOver: [{ object: REF, part: "definition", readAt: READ_AT }] });
    expect(triggerCapture(text, PARENT)).toEqual({ status: "complete" });
    expect(triggerReadAt(text, REF)).toBeNull();
  });

  it("keeps an explicit opt-out instead of reviving old metadata claims", () => {
    const data = snapshot({
      capture: {
        objects: { status: "notRead", reason: "optionOff" },
        definitions: { status: "notRead", reason: "optionOff" },
      },
    });
    expect(
      triggerCapture(data, PARENT, [{ object: PARENT, fact: { kind: "table" }, readAt: READ_AT }]),
    ).toEqual({ status: "notRead", reason: "optionOff" });
  });

  it("uses the oldest relevant date when a newer parent read did not confirm older code", () => {
    const earlier = "2026-10-10T08:00:00Z";
    const data = snapshot({
      carriedOver: [
        { object: { ...REF, name: "Other" }, part: "whole", readAt: READ_AT },
        { object: REF, part: "whole", readAt: earlier },
      ],
    });
    const parent = {
      object: PARENT,
      fact: { kind: "table" },
      readAt: "2026-10-14T08:00:00Z",
    } as const;
    expect(triggerCapture(data, PARENT, [parent])).toEqual({
      status: "notChecked",
      readAt: earlier,
    });
    expect(triggerCapture(data, PARENT)).toEqual({ status: "notChecked", readAt: earlier });
    expect(triggerReadAt(data, REF)).toBe(earlier);
  });
});

describe("triggersOf", () => {
  it("sorts INSTEAD OF before AFTER, enabled first within each group, then exact name without mutating the snapshot", () => {
    const triggers = [
      trigger("A_disabled", "after", false),
      trigger("Z_enabled", "after", true),
      trigger("Z_instead_disabled", "insteadOf", false),
      trigger("B_instead_enabled", "insteadOf", true),
      trigger("A_instead_enabled", "insteadOf", true),
      trigger("Unknown", "unknown", true),
      { ...trigger("Other", "after", true), parent: { schema: "elsewhere", name: "Orders" } },
    ];
    const data = snapshot({ triggers });
    const original = triggers.map((item) => item.name);
    expect(triggersOf(data, PARENT).map((item) => item.name)).toEqual([
      "A_instead_enabled",
      "B_instead_enabled",
      "Z_instead_disabled",
      "Z_enabled",
      "A_disabled",
      "Unknown",
    ]);
    expect(triggers.map((item) => item.name)).toEqual(original);
  });
});
