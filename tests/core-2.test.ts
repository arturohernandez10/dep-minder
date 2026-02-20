import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runCli } from "./helpers/run";

test("core-2: passthrough counts as reference", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "core-2");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /no errors found/i);
});
