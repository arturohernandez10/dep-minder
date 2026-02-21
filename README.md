# dep-minder

Trace validator for laddered specs (L0 -> L6) that enforces deterministic
propagation of meaning between adjacent layers. It ensures every upstream ID is
accounted for downstream (or explicitly acknowledged) and prevents silent drops.

## Why

When specs are layered, drift is easy to miss. This tool makes traceability
mechanically checkable with bounded, actionable errors so fixes are fast and
local.

## What it does

- Assigns files to layers by ordered globs (first match wins).
- Parses IDs as definitions or references (with quoting + grouping rules).
- Validates coverage and soundness between adjacent layers.
- Emits explicit, capped errors with file, line, and 3-line context.

## Install

This repo is designed to be used as a CLI. If you are hacking locally:

```bash
npm install
```

## Usage

```bash
dep-minder [PATH]
```

Options:

- `-c, --config <file>`: path to config YAML (default `trace-validator.yml`)
- `--max-errors <n>`: override error cap for this run
- `--format <text|json>`: output format (default `text`)
- `--layer <name>`: validate only one downstream layer pair
- `--strict`: treat all emitted issues as errors
- `-q, --quiet`: suppress non-error output
- `--debug`: print debug information
- `--version`, `-h, --help`

## Configuration (minimal)

Create a `trace-validator.yml` at repo root:

```yaml
version: 1

errors:
  max_errors_env: "TRACE_MAX_ERRORS"
  default_max_errors: 25

grouping:
  start_grouping: "["
  end_grouping: "]"
  separator: ","
  passthrough_prefix: "PT:"

layers:
  - name: intents
    globs: ["l0-*.md"]
    ids: ["INTENT-[0-9]+(\\.[0-9]+)*"]

  - name: capabilities
    globs: ["l1-*.md"]
    ids: ["CAP-[0-9]+(\\.[0-9]+)*"]

exclude:
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/build/**"
  - "**/.git/**"
  - "**/.venv/**"
```

## Rules (high level)

- Definitions are IDs that match the file's layer patterns and are not quoted
  and not inside a grouping.
- References come from groupings and quoted IDs.
- Groupings can appear anywhere, can span lines, and do not nest.
- Passthrough `PT:<UPSTREAM_ID>` counts as referencing the upstream ID.

## Errors

The tool emits bounded, single-block errors with context:

```error
E101 UnmappedUpstreamId — path/to/file.md:12
```

Common codes:

- `E010` MalformedGrouping
- `E020` BadIdToken
- `E030` UnknownUpstreamReference
- `E101` UnmappedUpstreamId

## Tests

```bash
npm test
```

## Notes

- Source files are treated as content like any other file; selection is purely
  by glob and layer ordering.
- Unmatched files are ignored.

