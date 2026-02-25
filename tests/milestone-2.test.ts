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

test("corner-2: IDs in prose define", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "corner-2");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.stderr.trim(), "");
});

test("corner-3: directory layers with multiple files", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "corner-3");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.stderr.trim(), "");
});

test("transitive-1: downstream transitive reach counts as reference", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "transitive-1");
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
    message: "UnknownUpstreamReference: INTENT-999.0",
    file: "l1-capabilities.md",
    line: 2,
    context: [
      "# Capabilities",
      "CAP-1.0 Uses one missing ref. [INTENT-1.0, INTENT-999.0]",
      "CAP-2.0 Another line for context."
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

test("resolution-1: resolution enabled suppresses E101", () => {
  const fixtureRoot = path.resolve(
    process.cwd(),
    "tests",
    "fixtures",
    "resolution-1"
  );
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.stderr.trim(), "");
});

test("set-resolution-1: dry run lists missing markers", () => {
  const fixtureRoot = path.resolve(
    process.cwd(),
    "tests",
    "fixtures",
    "set-resolution-1"
  );
  const result = runCli([fixtureRoot, "--set-resolution", "--dry-run"], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr.trim(), "");
  const output = normalizeOutput(result.stdout);
  assert.ok(
    output.includes("Dry run: 3 update(s) across 2 file(s)."),
    "Expected dry-run summary"
  );
  assert.ok(
    output.includes("l0-intents.md:2 INTENT-1 -> INTENT-1@capabilities"),
    "Expected INTENT-1 update"
  );
  assert.ok(
    output.includes("l0-intents.md:3 INTENT-2 -> INTENT-2@intents"),
    "Expected INTENT-2 update"
  );
  assert.ok(
    output.includes("l1-capabilities.md:2 CAP-1 -> CAP-1@capabilities"),
    "Expected CAP-1 update"
  );
});

test("fix-resolution-1: dry run lists incorrect markers", () => {
  const fixtureRoot = path.resolve(
    process.cwd(),
    "tests",
    "fixtures",
    "fix-resolution-1"
  );
  const result = runCli([fixtureRoot, "--fix-resolution", "--dry-run"], fixtureRoot);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr.trim(), "");
  const output = normalizeOutput(result.stdout);
  assert.ok(
    output.includes("Dry run: 1 update(s) across 1 file(s)."),
    "Expected dry-run summary"
  );
  assert.ok(
    output.includes("l0-intents.md:2 INTENT-1@intents -> INTENT-1@capabilities"),
    "Expected INTENT-1 fix"
  );
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

test("error-110: unknown resolution level emits E110", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "error-110");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 1);
  expectErrorBlock(result.stderr, {
    code: "E110",
    message: "UnknownResolutionLevel: unknown",
    file: "l0-intents.md",
    line: 2,
    context: ["# Intents", "INTENT-1:unknown Invalid resolution marker.", ""]
  });
});

test("error-111: resolution on non-definition emits E111", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "error-111");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 1);
  expectErrorBlock(result.stderr, {
    code: "E111",
    message: "ResolutionOnNonDefinition",
    file: "l1-capabilities.md",
    line: 3,
    context: [
      "CAP-1 Supports sign-in. [INTENT-1]",
      "[CAP-2@capabilities] should not be a definition.",
      ""
    ]
  });
});

test("error-211: out of order resolution emits E211", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "error-211");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 1);
  expectErrorBlock(result.stderr, {
    code: "E211",
    message: "OutOfOrderResolutionLevel: intents",
    file: "l1-capabilities.md",
    line: 2,
    context: ["# Capabilities", "CAP-1@intents Supports sign-in. [INTENT-1]", ""]
  });
});

test("error-220: mismatched resolution emits E220", () => {
  const fixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "error-220");
  const result = runCli([fixtureRoot], fixtureRoot);

  assert.equal(result.exitCode, 1);
  expectErrorBlock(result.stderr, {
    code: "E220",
    message: "MismatchedResolution: definition annotated invariants, trace ends at capabilities",
    file: "l0-intents.md",
    line: 2,
    context: ["# Intents", "INTENT-1@invariants User can sign in.", ""]
  });
});
