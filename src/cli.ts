#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { collectLayerFiles } from "./collection";
import {
  buildIssueSummary,
  formatIssueText,
  formatLimitFooter,
  formatSummaryText,
  limitIssues,
  resolveMaxErrors
} from "./reporting";
import { validateTraceability } from "./validate";
import { applyResolutionEdits, computeResolutionEdits } from "./resolution-writer";

type OutputFormat = "text" | "json";

type CliOptions = {
  path: string;
  configFile?: string;
  maxErrors?: number;
  format: OutputFormat;
  layer?: string;
  strict: boolean;
  quiet: boolean;
  verbose: boolean;
  debug: boolean;
  setResolution: boolean;
  fixResolution: boolean;
  dryRun: boolean;
  help: boolean;
  version: boolean;
};

const DEFAULTS: CliOptions = {
  path: ".",
  format: "text",
  strict: false,
  quiet: true,
  verbose: false,
  debug: false,
  setResolution: false,
  fixResolution: false,
  dryRun: false,
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
dep-minder [PATH]
Default PATH: .

Options:
  -c, --config <file>     Path to config YAML (default: trace-validator.yml)
  --max-errors <n>        Override max error output limit
  --format <text|json>    Output format (default: text)
  --layer <name>          Validate only one layer pair
  --set-resolution        Add resolution markers when missing
  --fix-resolution        Update incorrect resolution markers
  --dry-run               Preview resolution updates without writing
  --strict                Treat all emitted issues as errors
  -q, --quiet             Suppress non-error output (default)
  --verbose               Show non-error output
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
      options.verbose = false;
      continue;
    }

    if (arg === "--verbose") {
      options.quiet = false;
      options.verbose = true;
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

    if (arg === "--set-resolution") {
      options.setResolution = true;
      continue;
    }

    if (arg === "--fix-resolution") {
      options.fixResolution = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
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
      console.log("dep-minder: project scaffolding ready.");
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

    if (
      options.layer &&
      !collection.layers.some((layer) => layer.name === options.layer)
    ) {
      throw new Error(`Unknown layer: ${options.layer}`);
    }

    const analysis = validateTraceability(
      resolvedPath,
      config,
      collection,
      {
        layer: options.layer,
        debug: options.debug,
        quiet: options.quiet
      },
      loaded.resolution
    );

    const updateRequested = options.setResolution || options.fixResolution;
    if (updateRequested) {
      if (!loaded.resolution?.enabled) {
        throw new Error("Resolution markers are disabled. Enable resolution in config first.");
      }

      const parseErrors = analysis.issues.filter(
        (issue) => issue.code === "E010" || issue.code === "E020"
      );
      if (parseErrors.length > 0) {
        const codes = [...new Set(parseErrors.map((issue) => issue.code))].join(", ");
        throw new Error(`Cannot update resolutions due to parse errors: ${codes}`);
      }

      if (options.fixResolution && analysis.issues.some((issue) => issue.code === "E110")) {
        throw new Error("Cannot fix resolutions with unknown resolution levels (E110).");
      }

      const edits = computeResolutionEdits(config, analysis, loaded.resolution, {
        set: options.setResolution,
        fix: options.fixResolution
      });
      const result = applyResolutionEdits(resolvedPath, edits, options.dryRun);

      if (result.edits.length === 0) {
        console.log("No resolution updates needed.");
        return;
      }

      const filesTouched = new Set(result.edits.map((edit) => edit.filePath)).size;
      if (options.dryRun || options.verbose) {
        console.log(
          `${options.dryRun ? "Dry run" : "Applied"}: ${result.edits.length} update(s) across ${filesTouched} file(s).`
        );
        const sorted = [...result.edits].sort((a, b) =>
          a.filePath === b.filePath ? a.line - b.line : a.filePath.localeCompare(b.filePath)
        );
        for (const edit of sorted) {
          console.log(`${edit.filePath}:${edit.line} ${edit.oldText} -> ${edit.newText}`);
        }
      } else {
        console.log(
          `${result.edits.length} update(s) applied across ${filesTouched} file(s).`
        );
        const editCounts = new Map<string, number>();
        for (const edit of result.edits) {
          editCounts.set(edit.filePath, (editCounts.get(edit.filePath) ?? 0) + 1);
        }
        const sortedFiles = [...editCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        for (const [filePath, count] of sortedFiles) {
          console.log(`  ${filePath} (${count} update${count === 1 ? "" : "s"})`);
        }
      }
      return;
    }

    const maxErrors = resolveMaxErrors(config, options.maxErrors);
    const limited = limitIssues(analysis.issues, maxErrors);
    const summary = buildIssueSummary(analysis.issues, options.strict);

    if (options.format === "json") {
      const report = {
        format: "dep-minder/v1",
        summary,
        limit: {
          maxErrors,
          envName: config.errors.max_errors_env,
          truncated: limited.truncated,
          displayed: limited.issues.length
        },
        issues: limited.issues
      };
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = summary.exitCode;
      return;
    }

    for (const issue of limited.issues) {
      console.error(formatIssueText(issue));
    }

    if (limited.truncated) {
      console.error(formatLimitFooter(maxErrors, config.errors.max_errors_env));
    }

    const summaryText = formatSummaryText(summary);
    if (summary.errors > 0 || summary.warnings > 0) {
      console.error(summaryText);
    } else if (!options.quiet) {
      console.log(summaryText);
    }

    process.exitCode = summary.exitCode;
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
