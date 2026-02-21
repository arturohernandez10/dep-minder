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

## Sensitive Inputs

`dep-minder` does not store secrets in source files, but it does read external
inputs that can be sensitive depending on the environment:

- Environment variable: `process.env[config.errors.max_errors_env]`
  (defaults to `TRACE_MAX_ERRORS` via config).
- Local filesystem paths and file contents (YAML config + layer files).

No network calls are made, and no credentials are required by the codebase.
