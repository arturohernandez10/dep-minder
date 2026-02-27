import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runCli } from "./helpers/run";

test("core-3: resolution markers pass", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "core-3");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.stderr.trim(), "");
});
