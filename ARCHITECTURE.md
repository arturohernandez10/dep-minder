# Architecture Overview

This document summarizes the runtime architecture, each `src` file, and any
secret inputs or sensitive material the tool consumes.

## System Overview

`dep-minder` is a CLI that validates traceability between ordered layered specs.
The core flow is:

1. Load and validate a YAML config (`trace-validator.yml` by default).
2. Collect layer files from the repository using globs.
3. Parse files for IDs, definitions, references, and resolution markers.
4. Validate adjacency rules between layers.
5. Validate resolution annotations (when enabled).
6. Report issues in text or JSON, with error limiting.

## Source Files and Responsibilities

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | CLI entrypoint. Parses arguments, loads config, orchestrates collection + validation, prints reports, and sets exit code. |
| `src/config.ts` | Loads YAML config, validates schema and types (including optional `resolution` block), resolves config path. |
| `src/collection.ts` | Uses globs to collect files per layer, first-match-wins, respects exclude patterns. Resolution markers do not affect layer assignment. |
| `src/parser.ts` | Parses files into definitions and references, enforces ID token rules, parses groupings, extracts resolution markers from definitions, emits parse errors (E010, E020, E111, E110). |
| `src/validate.ts` | Validates adjacency between layers (E030, E101/E220), validates resolution annotations (E211, E220), and handles debug output. |
| `src/reporting.ts` | Formats issues, limits error output, builds summary and exit code logic, reads env max errors. Supports error/warning severity and `--strict` promotion. |

## Coverage Models

The tool supports two mutually exclusive coverage models, selected by the
`resolution.enabled` config flag. This keeps the tool backwards compatible:
when the flag is absent or `false`, behaviour is unchanged.

### Resolution off (default)

Every upstream definition must appear as a reference in the next downstream
layer. If not → `E101 UnmappedUpstreamId`.

### Resolution on (`resolution.enabled: true`)

Each definition may carry a resolution marker (`ID:<level>`) that declares
how far downstream it is expected to propagate. Coverage is validated
per-definition against its annotation:

- A definition **with** a marker claims resolution through a specific layer.
  The tool validates the trace actually reaches that layer — if it falls
  short or overshoots → `E220 MismatchedResolution`.
- A definition **without** a marker defaults to "resolved at its own layer."
  No downstream reference is required.

`E101` does not fire when resolution is on. `E220` absorbs its
responsibility under the annotation-driven model.

`E030 UnknownUpstreamReference` (soundness) is always active in both modes —
a downstream reference to a nonexistent upstream ID is always wrong.

## Validation Pipeline

The pipeline runs in strict phase order. Errors in earlier phases do not
short-circuit later phases, but within a phase, dependency ordering prevents
meaningless follow-on errors (e.g. E111 suppresses E110 for the same token).

```text
Phase 1 — Parse (per file, per token)
  ├─ E010  MalformedGrouping           structural syntax
  ├─ E020  BadIdToken                   token validity
  ├─ E111  ResolutionOnNonDefinition    marker in quote/grouping context
  └─ E110  UnknownResolutionLevel       marker names unknown layer/alias

Phase 2 — Validate adjacency (per layer pair)
  ├─ E030  UnknownUpstreamReference     soundness (always active)
  └─ E101  UnmappedUpstreamId           coverage (resolution OFF only)

Phase 3 — Validate resolution (per definition with marker, resolution ON only)
  ├─ E211  OutOfOrderResolutionLevel    marker points backward in layer order
  └─ E220  MismatchedResolution         trace doesn't match annotation
```

### Phase 1 detail

E111 and E110 only fire when `resolution.enabled: true`. During parsing,
if the parser encounters a colon-bearing token (`ID:level`):

- **E111** fires if the token is inside quotes or inside a grouping (those
  contexts produce references, not definitions — a resolution marker on a
  reference is structurally invalid). When E111 fires, E110 is suppressed
  for that token.
- **E110** fires if the level portion does not match any configured layer
  name or alias.

The parser produces a new optional field on definitions:
`ParsedToken.resolution?: string` (the resolved layer name).

### Phase 2 detail

Adjacency validation is unchanged except for the E101 gate: when resolution
is on, E101 is skipped entirely — its job is handled by E220 in Phase 3.

### Phase 3 detail

Runs only when `resolution.enabled: true`. For each definition that carries
a `resolution` value:

- **E211**: compare the definition's layer index against the resolution
  layer's index. If resolution index <= definition index, the marker points
  backward (or at itself without being the default) — emit E211. Checked
  before E220 because a directionally invalid marker makes trace comparison
  meaningless.
- **E220**: using the adjacency data from Phase 2, trace how far downstream
  the definition's ID actually propagates. Compare against the annotated
  resolution layer. Emit E220 if the trace falls short or extends past it.

## Data Flow

```text
cli.ts
  → config.ts          TraceValidatorConfig (+ optional resolution block)
  → collection.ts      LayerFileCollection  (unchanged by resolution)
  → parser.ts          ParsedFile per layer file
  │                      definitions: ParsedToken[] (with optional .resolution)
  │                      references:  ParsedToken[]
  │                      issues:      Issue[] (E010, E020, E111, E110)
  → validate.ts        Issue[] (E030, E101 or E211+E220)
  → reporting.ts       formatted output, exit code
```

## Config Schema

```yaml
version: 1
errors:
  max_errors_env: "TRACE_MAX_ERRORS"
  default_max_errors: 25
grouping:
  start_grouping: "["
  end_grouping: "]"
  separator: ","
  passthrough_prefix: "PT:"       # optional

# Optional. Absent or enabled: false preserves pre-resolution behaviour.
resolution:
  enabled: true
  aliases:                         # optional, alias → layer name
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
```

Config validation (in `config.ts`): when `resolution` is present and
`enabled: true`, every alias value must match a `layers[].name`. This is a
config-time assertion, not a runtime error code.

## Sensitive Inputs

`dep-minder` does not store secrets in source files, but it does read external
inputs that can be sensitive depending on the environment:

- Environment variable: `process.env[config.errors.max_errors_env]`
  (defaults to `TRACE_MAX_ERRORS` via config).
- Local filesystem paths and file contents (YAML config + layer files).

No network calls are made, and no credentials are required by the codebase.
