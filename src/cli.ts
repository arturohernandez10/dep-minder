#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

type OutputFormat = "text" | "json";

type CliOptions = {
  path: string;
  configFile?: string;
  maxErrors?: number;
  format: OutputFormat;
  layer?: string;
  strict: boolean;
  quiet: boolean;
  debug: boolean;
  help: boolean;
  version: boolean;
};

const DEFAULTS: CliOptions = {
  path: ".",
  format: "text",
  strict: false,
  quiet: false,
  debug: false,
  help: false,
  version: false
};

function getPackageVersion(): string {
  const packagePath = path.resolve(__dirname, "..", "package.json");
  try {
    const raw = fs.readFileSync(packagePath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function showHelp(): void {
  const text = `
trace-validate [PATH]
Default PATH: .

Options:
  -c, --config <file>     Path to config YAML (default: trace-validator.yml)
  --max-errors <n>        Override max error output limit
  --format <text|json>    Output format (default: text)
  --layer <name>          Validate only one layer pair
  --strict                Treat all emitted issues as errors
  -q, --quiet             Suppress non-error output
  --debug                 Print debug information
  --version               Print version
  -h, --help              Show help
`.trim();
  console.log(text);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { ...DEFAULTS };
  const args = [...argv];
  let pathProvided = false;

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) {
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--version") {
      options.version = true;
      continue;
    }

    if (arg === "-q" || arg === "--quiet") {
      options.quiet = true;
      continue;
    }

    if (arg === "--strict") {
      options.strict = true;
      continue;
    }

    if (arg === "--debug") {
      options.debug = true;
      continue;
    }

    if (arg === "-c" || arg === "--config") {
      const value = args.shift();
      if (!value) {
        throw new Error("Missing value for --config");
      }
      options.configFile = value;
      continue;
    }

    if (arg === "--max-errors") {
      const value = args.shift();
      if (!value) {
        throw new Error("Missing value for --max-errors");
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--max-errors must be a positive number");
      }
      options.maxErrors = parsed;
      continue;
    }

    if (arg === "--format") {
      const value = args.shift();
      if (value !== "text" && value !== "json") {
        throw new Error("--format must be text or json");
      }
      options.format = value;
      continue;
    }

    if (arg === "--layer") {
      const value = args.shift();
      if (!value) {
        throw new Error("Missing value for --layer");
      }
      options.layer = value;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (pathProvided) {
      throw new Error("Only one PATH argument is allowed");
    }
    options.path = arg;
    pathProvided = true;
  }

  return options;
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.version) {
      console.log(getPackageVersion());
      return;
    }

    if (options.help) {
      showHelp();
      return;
    }

    const resolvedPath = path.resolve(process.cwd(), options.path);
    const config = loadConfig(resolvedPath, options.configFile);

    if (!options.quiet) {
      console.log("trace-validate: project scaffolding ready.");
      console.log(`Path: ${resolvedPath}`);
      if (options.configFile) {
        console.log(`Config: ${options.configFile}`);
      }
    }

    if (options.debug && !options.quiet) {
      console.log(`Format: ${options.format}`);
      console.log(`Layer: ${options.layer ?? "(all)"}`);
      console.log(`Config version: ${config.version}`);
      console.log(`Max errors: ${options.maxErrors ?? "(config default)"}`);
      console.log(`Strict: ${options.strict ? "yes" : "no"}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

main();
