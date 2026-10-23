import assert from "node:assert/strict";
import test from "node:test";

import { importViolation, invokedCommands, moduleReferences } from "./architecture-boundaries.mjs";

test("module parsing includes types, re-exports and dynamic imports but ignores commented text", () => {
  assert.deepEqual(
    moduleReferences(
      "src/shared/example.ts",
      `
      // import "@/app/comment";
      import type { Item } from "@/features/schema/entity";
      export { value } from "../features/store";
      const load = () => import("@tauri-apps/api/core");
      const legacy = require("./legacy");
    `,
    ),
    ["../features/store", "./legacy", "@/features/schema/entity", "@tauri-apps/api/core"],
  );
});

test("boundaries reject alias and normalized relative bypasses", () => {
  assert.ok(importViolation("src/shared/connections/key.ts", "@/features/project/store"));
  assert.ok(importViolation("src/shared/connections/key.ts", "../../features/project/store"));
  assert.ok(importViolation("src/features/schema/types.ts", "../project/projectStore"));
  assert.ok(importViolation("src/features/connection/Form.tsx", "../../app/shell"));
  assert.ok(importViolation("src/viewer/main.ts", "../app/actions"));
  assert.ok(importViolation("src/features/export/page.ts", "../../viewer/main"));
  assert.ok(importViolation("src/features/project/store.ts", "@tauri-apps/api/core"));
  assert.equal(
    importViolation("src/shared/ipc/projectBackend.ts", "@tauri-apps/plugin-dialog"),
    null,
  );
  assert.equal(importViolation("src/features/schema/types.ts", "./entities"), null);
  assert.equal(importViolation("src/viewer/main.ts", "@/features/schema/objectDetails"), null);
});

test("IPC extraction handles generic multiline calls and ignores unrelated strings", () => {
  assert.deepEqual(
    invokedCommands(
      "src/shared/ipc/backend.ts",
      `
      const ignored = "invokeCommand('not_a_call')";
      invokeCommand<Result>("read_project", {});
      invokeCommand(
        "compare_project_source", {}
      );
    `,
    ),
    ["compare_project_source", "read_project"],
  );
});
