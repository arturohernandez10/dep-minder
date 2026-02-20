#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { collectLayerFiles } from "./collection";
import {
  countIssues,
  formatIssueText,
  formatLimitFooter,
  limitIssues,
  resolveMaxErrors
} from "./reporting";
import { validateTraceability } from "./validate";

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

async function main(): Promise<void> {
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
    const loaded = loadConfig(resolvedPath, options.configFile);
    const config = loaded.config;

    if (!options.quiet) {
      console.log("trace-validate: project scaffolding ready.");
      console.log(`Path: ${resolvedPath}`);
      console.log(`Config: ${loaded.path}`);
    }

    const collection = await collectLayerFiles(resolvedPath, config);

    if (options.debug && !options.quiet) {
      console.log(`Format: ${options.format}`);
      console.log(`Layer: ${options.layer ?? "(all)"}`);
      console.log(`Config version: ${config.version}`);
      console.log(`Max errors: ${options.maxErrors ?? "(config default)"}`);
      console.log(`Strict: ${options.strict ? "yes" : "no"}`);
      for (const layer of collection.layers) {
        console.log(`Layer "${layer.name}" files: ${layer.files.length}`);
      }
    }

    if (options.format !== "text") {
      throw new Error("Only text output is supported in this milestone");
    }

    if (
      options.layer &&
      !collection.layers.some((layer) => layer.name === options.layer)
    ) {
      throw new Error(`Unknown layer: ${options.layer}`);
    }

    const issues = validateTraceability(resolvedPath, config, collection, {
      layer: options.layer,
      debug: options.debug,
      quiet: options.quiet
    });
    const maxErrors = resolveMaxErrors(config, options.maxErrors);
    const limited = limitIssues(issues, maxErrors);

    for (const issue of limited.issues) {
      console.error(formatIssueText(issue));
    }

    if (limited.truncated) {
      console.error(formatLimitFooter(maxErrors, config.errors.max_errors_env));
    }

    const counts = countIssues(issues);
    const hasErrors = counts.errors > 0;
    const hasWarnings = counts.warnings > 0;

    if (hasErrors) {
      console.error(`trace-validate: ${counts.errors} error(s) found.`);
    } else if (!options.quiet) {
      console.log("trace-validate: no errors found.");
    }

    if (hasErrors || (options.strict && hasWarnings)) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
