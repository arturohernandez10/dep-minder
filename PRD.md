## Problem this tool addresses

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

* Walk the ordered `layers` array; assign each file to the first layer whose glob matches.
* “Code is content”: source files are treated the same as markdown/text; no special casing beyond file selection.

### Parse IDs appearing in each file

* The tool scans each line and extracts IDs that match the configured patterns for that file’s layer.
* **Quoting rule:** if an ID appears inside quotes (`"..."` or `'...'`), it is considered a **reference** (not a definition). (This matters when computing “defined IDs” vs “referenced IDs.”)

### Parse groupings everywhere

* Groupings are delimited by configurable `start_grouping` and `end_grouping` (default `[` and `]`).
* A file may contain **multiple groupings**, and groupings **do not have to be at the end of an item**.
* All IDs found inside groupings count as **references**.
* The tool **deduplicates references** before running coverage checks and before emitting “unknown reference” errors (so repeated use doesn’t create noise).

### Build adjacency mapping sets

For each adjacent layer pair `(i-1 -> i)`:

* `DefinedUpstream = all IDs defined in layer i-1`
* `ReferencedInDownstream = all upstream IDs referenced by layer i` (from groupings + quoted IDs)

### Validate traceability

* **Coverage / no orphan upstream IDs:** every ID in `DefinedUpstream` must appear at least once in `ReferencedInDownstream` (either directly or as passthrough).
* **No unknown upstream references:** any referenced upstream ID must exist in `DefinedUpstream`.
* **Parse correctness:** malformed groupings or malformed IDs produce explicit parse errors.

### Emit explicit, bounded errors

* Errors include: error code, file, line, excerpt, and the offending ID(s).
* Output is capped using `TRACE_MAX_ERRORS` (env var), defaulting to a configured value.

### Error Limiting

* The tool does **not** require “each item must end with a grouping.”
* Instead: **the tool parses groupings wherever they appear**. If traceability is missing, **errors** will instruct what’s required.

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
    glob: "l0-*.md"
    ids: ["INTENT-[0-9]+(\\.[0-9]+)*"]

  - name: capabilities
    glob: "l1-*.md"
    ids: ["CAP-[0-9]+(\\.[0-9]+)*"]

  - name: invariants
    glob: "l2-*.md"
    ids: ["INV-[0-9]+(\\.[0-9]+)*"]

  - name: contracts
    glob: "l3-*.md"
    ids: ["(API|MSG|UI)-[0-9]+(\\.[0-9]+)*"]

  - name: rules
    glob: "l4-*.md"
    ids: ["RULE-[0-9]+(\\.[0-9]+)*"]

  - name: tests
    glob: "l5-*.md"
    ids: ["TEST-[0-9]+(\\.[0-9]+)*"]

  - name: code
    glob: "src/**"
    ids: ["CODE-[0-9]+(\\.[0-9]+)*"]

exclude:
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/build/**"
  - "**/.git/**"
  - "**/.venv/**"
```

That’s the whole config surface for V1.

---

## How IDs are recognized in text/code

* The tool scans each line and extracts candidate tokens that look like IDs.
* It does **not** mutate the token for error reporting (so hyphens/dots remain visible).
* A candidate token is accepted as an ID only if:

  * it satisfies the global start/end rules, and
  * it matches at least one mask for the file’s assigned layer (for definitions), or
  * it matches patterns for the upstream layer (when parsing references inside groupings for adjacency checks).

---

## How groupings work (important details)

* A grouping is any substring between `start_grouping` and `end_grouping` (e.g. `[...]`).
* Inside the grouping:

  * split by `separator` (e.g. commas),
  * trim whitespace,
  * each token is either:

    * an upstream ID (e.g. `INV-4`), or
    * a passthrough form (e.g. `PT:INV-7`) which still counts as referencing `INV-7`.
* Multiple groupings per file are allowed.
* References are **deduplicated** before validation:

  * repeated mention of `INV-4` does not produce repeated errors.

---

## What “passthrough” means in this tool

If a layer has no meaningful concept for an upstream ID but you still need to acknowledge it:

* include it as `PT:<UPSTREAM_ID>` in any grouping at a layer.

This satisfies the “no missing connection” requirement at that layer, while signaling “this must surface later.”

(Enforcing “must surface by a deeper layer” can be added later; V1 can simply track and report passthrough usage as informational output if you want.)

---

## Errors (explicit, accurate, bounded)

The tool emits a stream of errors up to the max (env override supported).

Typical codes:

* **E010 MalformedGrouping**

  * grouping start/end mismatch or empty token list
* **E020 BadIdToken**

  * token violates global start/end rule or fails regex pattern where required
* **E030 UnknownUpstreamReference**

  * a layer references an upstream ID not defined in the previous layer
* **E101 UnmappedUpstreamId**

  * an ID defined in the previous layer is never referenced anywhere in the current layer (after dedup)

Example bounded footer:

* `… 25 errors shown (TRACE_MAX_ERRORS=25). More errors exist; fix these and re-run.`

---

## What success looks like

When the tool passes:

* Every upstream ID is accounted for at the next layer (directly or via passthrough).
* No layer references non-existent upstream IDs.
* Agents get small, actionable error batches.
* Drift is caught immediately, so changes can propagate from L0 down to code in a controlled way.

If you want, the next natural add-on (still not “overdone”) is a `--emit-report` mode that writes a deduped JSON summary:

* per layer: defined IDs, referenced IDs, unmapped IDs, passthrough IDs, unknown references.
