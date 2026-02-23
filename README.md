# dep-minder

Trace validator for ordered laddered specs that enforces deterministic
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
- Optionally validates per-definition resolution markers and reports completion gaps.
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

# Optional: enable parsing/validation of per-definition resolution markers.
# Resolution markers do not affect layer assignment (still by globs) and do not
# count as references.
resolution:
  enabled: true
  # Optional aliases for marker tokens. Using layer names directly is recommended.
  aliases:
    L0: intents
    L1: capabilities

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

### Resolution markers (optional)

If `resolution.enabled: true`, a definition may include a resolution marker:

- Syntax: `ID:<level> ...`
- `<level>` is a configured layer name (recommended) or an alias from `resolution.aliases`.
- The marker is metadata only:

  - It does **not** change which layer the file belongs to.
  - It does **not** count as a reference.
- If a definition has no marker, it is treated as resolved through its own layer.

Examples:

- `CAP-12:capabilities User can export reports` (resolved through `capabilities`)
- `CAP-13:L1 User can export reports` (same, using an alias)

## Issues (errors and warnings)

The tool emits bounded, single-block issues with context:

```error
<ERROR_CODE> <short_message> — <file_path>:<line>
<triple-ticks>
  INTENT-1: User can sign in.
  INTENT-2: User can reset password.
  Notes: keep this for context.
</triple-ticks>
```

Severity:

- Errors (`E…`) always fail the run.
- Warnings (`W…`) do not fail the run unless `--strict` is set (then warnings are treated as errors).

Common codes:

- `E010` MalformedGrouping
- `E020` BadIdToken
- `E030` UnknownUpstreamReference
- `E110` UnknownResolutionLevel
  A definition uses `ID:<level>` where `<level>` is not a known layer name/alias.
- `E111` ResolutionOnNonDefinition
  A resolution marker appears on a quoted ID or inside a grouping (e.g. `"CAP-1:L2"` or `[CAP-1:L2]`).
- `E211` OutOfOrderResolutionLevel
  A definition in layer `D` is marked as resolved through a layer `R` where `R` precedes `D` in the layers list.
- `E220` MismatchedResolution
  Definition annotation does not match the observed downstream trace (falls short or extends past).

Notes on flags:

- `--strict` promotes all warnings (`W…`) to errors (counts toward `--max-errors`).
- `--layer <name>` scopes validation to one adjacent pair; resolution checks that require multi-hop
  paths are only evaluated when the full path is in scope.

## Tests

```bash
npm test
```

## Notes

- Source files are treated as content like any other file; selection is purely
  by glob and layer ordering.
- Unmatched files are ignored.
