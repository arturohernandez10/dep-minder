import fs from "node:fs";
import path from "node:path";
import { runCli } from "./helpers/run";

type CliOptions = {
  debug: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { debug: false };
  for (const arg of argv) {
    if (arg === "--debug") {
      options.debug = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function listFixtures(fixturesRoot: string): string[] {
  const entries = fs.readdirSync(fixturesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function printDivider(name: string, exitCode: number): void {
  const line = "=".repeat(Math.max(8, name.length + 12));
  console.log(`${line}\n${name} (exit: ${exitCode})\n${line}`);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const fixturesRoot = path.resolve(process.cwd(), "tests", "fixtures");
  const fixtureNames = listFixtures(fixturesRoot);

  if (fixtureNames.length === 0) {
    console.log("No fixtures found.");
    return;
  }

  let failures = 0;
  for (const name of fixtureNames) {
    const fixtureRoot = path.join(fixturesRoot, name);
    const args = options.debug ? ["--debug", fixtureRoot] : [fixtureRoot];
    const result = runCli(args, fixtureRoot);

    printDivider(name, result.exitCode);
    if (result.stdout) {
      console.log(result.stdout.trimEnd());
    }
    if (result.stderr) {
      console.error(result.stderr.trimEnd());
    }

    if (result.exitCode !== 0) {
      failures += 1;
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
