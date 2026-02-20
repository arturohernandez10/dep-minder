import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runCli } from "./helpers/run";

test("core-1: full pass with coverage + soundness", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "core-1");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /no errors found/i);
});
