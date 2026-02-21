import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runCli } from "./helpers/run";

type ErrorBlock = {
  code: string;
  message: string;
  file: string;
  line: number;
  context: string[];
};

function normalizeOutput(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function expectErrorBlock(stderr: string, block: ErrorBlock): void {
  const header = `${block.code} ${block.message} — ${block.file}:${block.line}`;
  const expected = [header, "```error", ...block.context, "```"].join("\n");
  assert.ok(
    normalizeOutput(stderr).includes(expected),
    `Expected error block missing:\n${expected}`
  );
}

test("corner-1: groupings mid-line and multiple per file", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "corner-1");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.stderr.trim(), "");
});

test("corner-2: quoted IDs become references", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "corner-2");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 1);
  expectErrorBlock(result.stderr, {
    code: "E030",
    message: "UnknownUpstreamReference: CAP-1",
    file: "l2-invariants.md",
    line: 2,
    context: [
      "# Invariants",
      "INV-1: Must map capability. [CAP-1]",
      "Additional invariant note."
    ]
  });
});

test("corner-3: directory layers with multiple files", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "corner-3");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.stderr.trim(), "");
});

test("error-1: unclosed grouping emits E010", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "error-1");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 1);
  expectErrorBlock(result.stderr, {
    code: "E010",
    message: "Malformed grouping",
    file: "l1-capabilities.md",
    line: 2,
    context: [
      "# Capabilities",
      "CAP-1: Broken grouping starts here [INTENT-1",
      "CAP-2: Filler line after broken grouping."
    ]
  });
});

test("error-2: unknown upstream reference emits E030", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "error-2");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 1);
  expectErrorBlock(result.stderr, {
    code: "E030",
    message: "UnknownUpstreamReference: INTENT-999",
    file: "l1-capabilities.md",
    line: 2,
    context: [
      "# Capabilities",
      "CAP-1: Uses one missing ref. [INTENT-1, INTENT-999]",
      "CAP-2: Another line for context."
    ]
  });
});

test("error-3: unmapped upstream ID emits E101", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "error-3");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 1);
  expectErrorBlock(result.stderr, {
    code: "E101",
    message: "UnmappedUpstreamId: INTENT-2",
    file: "l0-intents.md",
    line: 3,
    context: [
      "INTENT-1: User can sign in.",
      "INTENT-2: User can reset password.",
      "Notes: keep this for context."
    ]
  });
});

test("error-020: bad ID token emits E020", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "error-020");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 1);
  expectErrorBlock(result.stderr, {
    code: "E020",
    message: "Bad ID token: PT:",
    file: "l1-capabilities.md",
    line: 2,
    context: [
      "# Capabilities",
      "CAP-1: Includes bad passthrough. [INTENT-1, PT:]",
      "CAP-2: Extra line for context."
    ]
  });
});
