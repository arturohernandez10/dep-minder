# Problem this tool addresses

In a laddered spec (e.g. L0 → L6), you want deterministic propagation of meaning:

* Every concept introduced in a layer must be **accounted for** in the next layer (refined or explicitly acknowledged).
* Downstream layers must not silently drop upstream items.
* Agents need **precise, bounded** feedback (not 300 cascading parse errors) so they can fix issues quickly and correctly.

Without automation, traceability becomes inconsistent and drift becomes invisible until late (tests/code), when it’s expensive.

This tool makes traceability **mechanically checkable**.

---

## What the tool will do

Given:

* a repository root,
* a small YAML config that defines:
  * an ordered list of layers (glob + ID patterns),
  * the grouping delimiters and passthrough marker,
  * the error output limit,

the tool will:

### Collect files by glob

* Walk the ordered `layers` array; assign each file to the **first** layer whose glob matches (first-match-wins).
* Unmatched files are ignored.
* “Code is content”: source files are treated the same as markdown/text; no special casing beyond file selection.

## command line interface

* `dep-minder [PATH]`
  *Default:* `PATH=.` (repo root)

* `-c, --config <file>`
  Path to config YAML. *Default:* `trace-validator.yml` (look in `PATH`, then current dir).

* `--max-errors <n>`
  Overrides config/env for this run (still keep `TRACE_MAX_ERRORS` as an env override if you want, but CLI is nicer).
  *Default:* config default.

* `--format <text|json>`
  `text` for human/AI diff-friendly blocks; `json` for tooling/CI annotations.
  *Default:* `text`.

* `--layer <name>`
  Validate only one downstream layer against its upstream neighbor (e.g., `capabilities` validates `intents -> capabilities`).
  *Default:* validate all adjacent pairs.

* `--strict`
  Non-zero exit if *any* error; without strict you can still exit non-zero on errors, but `--strict` is useful if you later introduce warnings/info.
  *Default:* treat all emitted issues as errors (so `--strict` is mostly future-proofing).

* `-q, --quiet`
  Suppress non-error output (only errors + final summary).
  *Default:* normal verbosity.

* `--version`, `-h, --help`

* ` --debug`
  Print debug information.

### Parse IDs appearing in each file

#### Definitions vs references (single rule)

An ID occurrence is a **definition** iff it:

* matches the file’s assigned layer `ids` patterns, and
* is **not** inside quotes, and
* is **not** inside a grouping.

Otherwise it is a **reference**.

#### Tokenization / candidate extraction

* The tool scans text and extracts **candidate tokens** using simple boundaries:
  * tokens are maximal substrings delimited by whitespace or grouping/`separator` delimiters
  * punctuation outside the allowed ID charset breaks tokens
* Error messages preserve the original token (no normalization).

#### Candidate acceptance

A candidate token is accepted as an ID only if:

* it satisfies the global start/end rules, and
* it matches a required layer regex for its role:
  * In a layer-i file: IDs matching layer-i patterns are candidates for **definitions**.
  * IDs matching layer-(i−1) patterns are candidates for **references** (from groupings + quoted IDs).

* **Quoting rule:** if an ID appears inside quotes (`"..."` or `'...'`), it is considered a **reference** (not a definition).

### Parse groupings everywhere

* Groupings are delimited by configurable `start_grouping` and `end_grouping` (default `[` and `]`).
* A file may contain **multiple groupings**, and groupings **do not have to be at the end of an item**.
* Groupings are **non-nesting** and **may span lines**; the first matching `end_grouping` closes the grouping.
* All IDs found inside groupings count as **references** (never definitions).
* Inside a grouping:
  * split by `separator` (e.g. commas),
  * trim whitespace,
  * each token is either:
    * an upstream ID (e.g. `INV-4`), or
    * a passthrough form (e.g. `PT:INV-7`) which counts as referencing `INV-7`.

### Build adjacency mapping sets

For each adjacent layer pair `(i-1 -> i)`:

* `DefinedUpstream = all IDs defined in layer i-1`
* `ReferencedInDownstream = set of all upstream IDs referenced by layer i` (from groupings + quoted IDs, after passthrough normalization)

Notes:

* Passthrough normalization: `PT:<UPSTREAM_ID>` contributes `<UPSTREAM_ID>` to `ReferencedInDownstream`.
* References are **deduplicated** before validation and before emitting reference-based errors (so repeated use doesn’t create noise).

### Validate traceability

* **Coverage:** `DefinedUpstream ⊆ ReferencedInDownstream` (passthrough counts).
* **Soundness:** `ReferencedInDownstream ⊆ DefinedUpstream`.
* **Parse correctness:** malformed groupings or malformed IDs produce explicit parse errors.

### Emit explicit, bounded errors

* Errors include: error code, file, line, excerpt, and the offending ID(s).
* Output is capped using `TRACE_MAX_ERRORS` (env var), defaulting to a configured value.

### Error Limiting

* The tool does **not** require “each item must end with a grouping.”
* Instead: the tool parses groupings wherever they appear. If traceability is missing, errors instruct what’s required.

---

## Global ID rules (not configurable)

These are universal invariants for all IDs:

* IDs must **start with a letter** (`A–Z` / `a–z`).
* IDs must **end with an alphanumeric** (`A–Z a–z 0–9`).
* IDs may include separators in the middle (e.g. `-`, `.`, `_`).
  **Clarification:** “end with alphanum” ≠ “IDs are alphanum-only.” It only constrains the final character.

The patterns in config narrow this further per layer (e.g. `CAP-...`, `INV-...`).

---

## Configuration (minimal, not overdone)

### `trace-validator.yml` (example)

```yaml
version: 1

# Error limiting: keep agent feedback focused
errors:
  max_errors_env: "TRACE_MAX_ERRORS"
  default_max_errors: 25

# How groupings look. Groupings can appear anywhere; multiple per file allowed.
grouping:
  start_grouping: "["
  end_grouping: "]"
  separator: ","
  # Optional passthrough marker to acknowledge upstream IDs without adding a same-level concept
  passthrough_prefix: "PT:"

# Ordered layers (position = dependency; each layer validated against previous)
layers:
  - name: intents
    globs: ["l0-*.md"]
    ids: ["INTENT-[0-9]+(\\.[0-9]+)*"]

  - name: capabilities
    globs: ["l1-*.md"]
    ids: ["CAP-[0-9]+(\\.[0-9]+)*"]

  - name: invariants
    globs: ["l2-*.md"]
    ids: ["INV-[0-9]+(\\.[0-9]+)*"]

  - name: contracts
    globs: ["l3-*.md"]
    ids: ["(API|MSG|UI)-[0-9]+(\\.[0-9]+)*"]

  - name: rules
    globs: ["l4-*.md"]
    ids: ["RULE-[0-9]+(\\.[0-9]+)*"]

  - name: tests
    globs: ["l5-*.md"]
    ids: ["TEST-[0-9]+(\\.[0-9]+)*"]

  - name: code
    globs: ["src/**"]
    ids: ["CODE-[0-9]+(\\.[0-9]+)*"]

exclude:
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/build/**"
  - "**/.git/**"
  - "**/.venv/**"
````

That’s the whole config surface for V1.

---

## Errors (explicit, accurate, bounded)

The tool emits a stream of errors up to the max (env override supported).

Typical codes:

* **E010 MalformedGrouping**

  * unclosed/extra delimiter, or zero non-empty tokens after split+trim

* **E020 BadIdToken**

  * token violates global start/end rule or fails required layer regex

* **E030 UnknownUpstreamReference**

  * referenced upstream ID ∉ `DefinedUpstream` (after passthrough normalization + dedup)

* **E101 UnmappedUpstreamId**

  * upstream ID ∉ `ReferencedInDownstream` (after passthrough normalization + dedup)
  * emitted at most once per missing upstream ID for the `(i-1 -> i)` layer pair

Example bounded footer:

* `… 25 errors shown (TRACE_MAX_ERRORS=25). More errors exist; fix these and re-run.`

---

### Error output format (crisp, diff-friendly)

Each error is a single, self-contained block designed to be easy to locate and patch. It includes:

* **Code + short message**
* **File path + 1-based line number** (and optionally column if available)
* A **3-line context snippet** (previous / offending / next), bounded by triple backticks, with the **offending line isolated** so an AI can reliably generate a targeted diff.

Error output format template:

```error
<ERROR_CODE> <short_message> — <file_path>:<line>
<triple-ticks>
<line-1 context>
<offending line>
<line+1 context>
<triple-ticks>
```

Notes:

* Line numbers are **1-based**.
* If the offending line is the first/last line of file, missing context lines are omitted (but the snippet remains bounded by triple backticks).
* The snippet is **verbatim** from the file (no normalization), so diffs apply cleanly.

## What success looks like

When the tool passes:

* Every upstream ID is accounted for at the next layer (directly or via passthrough).
* No layer references non-existent upstream IDs.
* Agents get small, actionable error batches.
* Drift is caught immediately, so changes can propagate from L0 down to code in a controlled way.
