# Architecture Overview

This document summarizes the runtime architecture, each `src` file, and any
secret inputs or sensitive material the tool consumes.

## System Overview

`dep-minder` is a CLI that validates traceability between layered specs.
The core flow is:

1. Load and validate a YAML config (`trace-validator.yml` by default).
2. Collect layer files from the repository using globs.
3. Parse files for IDs, definitions, and references.
4. Validate adjacency rules between layers.
5. Report issues in text or JSON, with error limiting.

## Source Files and Responsibilities

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | CLI entrypoint. Parses arguments, loads config, orchestrates collection + validation, prints reports, and sets exit code. |
| `src/config.ts` | Loads YAML config, validates schema and types, resolves config path. |
| `src/collection.ts` | Uses globs to collect files per layer, first-match-wins, respects exclude patterns. |
| `src/parser.ts` | Parses files into definitions and references, enforces ID token rules, parses groupings, emits parse errors. |
| `src/validate.ts` | Validates adjacency between layers, produces unknown/missing ID issues, and handles debug output. |
| `src/reporting.ts` | Formats issues, limits error output, builds summary and exit code logic, reads env max errors. |

## Implementation Secrets (Encapsulation)

Each module hides internal details so other files depend only on stable inputs/outputs.

- `src/cli.ts` isolates argument parsing and user-facing output. Other files
  do not need to know about CLI flags, stdout/stderr routing, or exit codes.
- `src/config.ts` isolates YAML parsing and schema validation. Callers receive
  a typed `TraceValidatorConfig` and do not depend on raw YAML shapes.
- `src/collection.ts` isolates filesystem globbing, dedupe rules, and path
  normalization. Callers work with `LayerFileCollection` only.
- `src/parser.ts` isolates tokenization, grouping parsing, and ID validation.
  Callers receive parsed definitions/references and parse issues.
- `src/validate.ts` isolates adjacency rules and issue generation for missing/
  unknown upstream IDs. Callers only pass config + collection.
- `src/reporting.ts` isolates formatting, error limiting, and summary/exit logic.
  Callers do not depend on the formatting or env variable details.

## Sensitive Inputs

`dep-minder` does not store secrets in source files, but it does read external
inputs that can be sensitive depending on the environment:

- Environment variable: `process.env[config.errors.max_errors_env]`
  (defaults to `TRACE_MAX_ERRORS` via config).
- Local filesystem paths and file contents (YAML config + layer files).

No network calls are made, and no credentials are required by the codebase.
