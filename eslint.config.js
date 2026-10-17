import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/*
 * Layer boundaries (docs/architecture.md, ADR-031): app -> features -> shared, the viewer reuses
 * features but never app, and only src/shared/ipc talks to the Tauri API. features/schema is a
 * leaf among the features: it holds entity identity and schema facts that every other feature
 * and the viewer read, so it imports only shared/ and itself. One rule per folder, because a
 * later no-restricted-imports entry replaces an earlier one for the same file.
 */
const forbid = {
  app: {
    group: ["@/app/*"],
    message: "Only app/ composes the application; import from features/ or shared/.",
  },
  features: {
    group: ["@/features/*"],
    message: "shared/ sits below the features; move the code down or pass it in.",
  },
  otherFeatures: {
    group: ["@/features/*", "!@/features/schema"],
    message: "features/schema is a leaf; it imports only shared/ and itself.",
  },
  viewer: {
    group: ["@/viewer/*"],
    message: "The standalone viewer is a separate bundle; nothing imports it.",
  },
  tauri: {
    group: ["@tauri-apps/*"],
    message: "Only src/shared/ipc calls the Tauri API; add or use a wrapper there.",
  },
};
const layer = (files, patterns, ignores = []) => ({
  files,
  ignores,
  rules: { "no-restricted-imports": ["error", { patterns }] },
});

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "src-tauri", "target", "src/shared/contracts/generated"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  layer(["src/app/**/*.{ts,tsx}", "src/main.tsx"], [forbid.viewer, forbid.tauri]),
  layer(["src/features/**/*.{ts,tsx}"], [forbid.app, forbid.viewer, forbid.tauri]),
  layer(
    ["src/features/schema/**/*.{ts,tsx}"],
    [forbid.app, forbid.otherFeatures, forbid.viewer, forbid.tauri],
  ),
  layer(["src/shared/ipc/**/*.{ts,tsx}"], [forbid.app, forbid.features, forbid.viewer]),
  layer(
    ["src/shared/**/*.{ts,tsx}"],
    [forbid.app, forbid.features, forbid.viewer, forbid.tauri],
    ["src/shared/ipc/**"],
  ),
  layer(["src/viewer/**/*.{ts,tsx}"], [forbid.app, forbid.tauri]),
  prettier,
);
