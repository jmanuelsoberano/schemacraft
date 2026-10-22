import assert from "node:assert/strict";
import test from "node:test";
import { checkDistribution } from "./check-distribution.mjs";

function validInputs() {
  return {
    config: {
      identifier: "com.jmanuelsoberano.schemacraft",
      bundle: {
        active: true,
        targets: ["nsis"],
        windows: { nsis: { installMode: "currentUser" }, webviewInstallMode: { type: "skip" } },
      },
    },
    releaseWorkflow:
      "npm run distribution:check\ntarget/release/schemacraft.exe\ntarget/release/bundle/nsis/\nSHA256SUMS.txt",
    ciWorkflow: "npm run distribution:check",
    sources: [{ path: "src/example.ts", text: 'const title = "SchemaCraft";' }],
  };
}

test("independent releases need no Store configuration", () => {
  assert.deepEqual(checkDistribution(validInputs()), []);
});

test("removing the independent installer or portable fails the contract", () => {
  const input = validInputs();
  input.config.bundle.targets = ["msi"];
  input.releaseWorkflow = input.releaseWorkflow.replace("target/release/schemacraft.exe", "");
  const failures = checkDistribution(input);
  assert.ok(failures.some((failure) => failure.includes("NSIS")));
  assert.ok(failures.some((failure) => failure.includes("target/release/schemacraft.exe")));
});

test("disabling the bundler cannot silently remove the installer", () => {
  const input = validInputs();
  input.config.bundle.active = false;
  assert.ok(checkDistribution(input).some((failure) => failure.includes("remain enabled")));
});

test("requiring a Store identity for the ordinary release is rejected", () => {
  const input = validInputs();
  input.releaseWorkflow += "\nSTORE_IDENTITY: ${{ vars.STORE_IDENTITY }}";
  assert.ok(checkDistribution(input).some((failure) => failure.includes("Store account")));
});

test("product Store SDK imports and packaging imports are rejected", () => {
  const input = validInputs();
  input.sources.push({
    path: "crates/core.rs",
    text: "use windows::Services::Store::StoreContext;",
  });
  input.sources.push({
    path: "src/side-effect.ts",
    text: 'import "../../distribution/identity.json";',
  });
  input.sources.push({
    path: "src/dynamic.ts",
    text: 'import ( "../../distribution/identity.json");',
  });
  input.sources.push({
    path: "crates/include.rs",
    text: 'include_str!("../../distribution/identity.json");',
  });
  input.sources.push({
    path: "src/store.ts",
    text: 'import identity from "../../distribution/identity.json";',
  });
  assert.equal(
    checkDistribution(input).filter((failure) => failure.includes("outside the product")).length,
    5,
  );
});

test("changes to shared application identity and installer permissions fail", () => {
  const input = validInputs();
  input.config.identifier = "Some.StoreIdentity";
  input.config.bundle.windows.nsis.installMode = "perMachine";
  assert.equal(checkDistribution(input).length, 2);
});

test("removing the policy from either required workflow fails", () => {
  const input = validInputs();
  input.ciWorkflow = "npm test";
  assert.ok(checkDistribution(input).some((failure) => failure.startsWith("CI must")));
});
