# Test cases

## Core

- **Core 1: Full pass with coverage + soundness**  
  Upstream IDs defined in `l0-*.md`, downstream `l1-*.md` references all of them exactly once inside groupings; no extra refs. Expect: zero errors; exit success.

- **Core 2: Passthrough counts as reference**  
  `l1-*.md` uses `PT:<UPSTREAM_ID>` in groupings for every upstream ID, no direct same-layer definitions. Expect: zero errors; coverage satisfied via passthrough normalization.

- **Core 3: Resolution markers pass — mixed annotations and defaults**  
  Three layers (`intents` → `capabilities` → `invariants`), resolution enabled with alias `L1: capabilities`. `l0-intents.md` defines `INTENT-1` and `INTENT-2`. `l1-capabilities.md` defines `CAP-1:invariants` and `CAP-2` (no marker), references `[INTENT-1, INTENT-2]`. `l2-invariants.md` defines `INV-1`, references `[CAP-1, CAP-2]`. Expect: zero errors. `CAP-1:invariants` annotation matches trace (referenced in invariants layer). `CAP-2` has no marker but still participates in adjacent-layer coverage.

- **Core 4: Transitive dependencies across layers (pending)**  
  Three layers (`constraints` → `invariants` → `capabilities`). `l0-constraints.md` defines `CON-3.1`. `l1-invariants.md` defines `INV-6.0`, references `[CON-3.1]`. `l2-capabilities.md` defines `CAP-1.1`, references `[INV-6.0]`. Expected behavior: `CAP-1.1` is treated as transitively reaching `CON-3.1`.

## Corner

- **Corner 1: Groupings mid-line and multiple per file**  
  A single downstream file has two groupings on separate lines and one grouping mid-line. Expect: all groupings parsed; refs deduped; no parse errors.

- **Corner 2: Quoted IDs become references (not definitions)**  
  A layer file includes an ID string in quotes that matches its own layer pattern. Expect: it is treated as a reference, not a definition.

- **Corner 3: Both layers as directories with multiple files**  
  `l0` and `l1` are directories; one layer has two files while the other has one. Expect: all files are aggregated per layer and coverage checks span all files.

## Resolution

- **Resolution 1: Resolution enabled suppresses E101**  
  Two layers with resolution enabled. `l0-intents.md` defines `INTENT-3.1` and `INTENT-3.2`, `l1-capabilities.md` defines `CAP-2.7` and references both via `[[...]]`. Expect: zero errors; no `E101` for unmapped upstream IDs.

- **Resolution 2: --set-resolution dry run lists missing markers**  
  Two layers with resolution enabled, no markers present. Run with `--set-resolution --dry-run`. Expect: zero errors; output lists updates for `INTENT-1`, `INTENT-2`, and `CAP-1` with inferred markers and summary count.

- **Resolution 3: --fix-resolution dry run fixes incorrect markers**  
  Two layers with resolution enabled. `l0-intents.md` has `INTENT-1@intents` but it should resolve to `capabilities`. Run with `--fix-resolution --dry-run`. Expect: zero errors; output lists the single corrected marker update.

## Error

- **Error 1: E010 MalformedGrouping (unclosed)**  
  Downstream file has a `[` without a matching `]` (spans to EOF). Expect: `E010 MalformedGrouping` with snippet.

- **Error 2: E030 UnknownUpstreamReference**  
  Downstream grouping includes `INV-999` not defined upstream. Expect: `E030 UnknownUpstreamReference` once for `INV-999`.

- **Error 3: E101 UnmappedUpstreamId**  
  Upstream defines `CAP-1` and `CAP-2`, downstream references only `CAP-1`. Resolution off. Expect: `E101 UnmappedUpstreamId` for `CAP-2` once.

- **Error 4: E110 UnknownResolutionLevel**  
  Two layers, resolution enabled. `l0-intents.md` defines `INTENT-1:unknown`. Expect: `E110 UnknownResolutionLevel` once for the invalid marker.

- **Error 5: E111 ResolutionOnNonDefinition**  
  Two layers, resolution enabled. `l1-capabilities.md` contains a quoted `CAP-1:capabilities` token while still referencing `[INTENT-1]`. Expect: `E111 ResolutionOnNonDefinition` for the quoted token only.

- **Error 6: E211 OutOfOrderResolutionLevel**  
  Two layers, resolution enabled. `l1-capabilities.md` defines `CAP-1:intents` (annotated to an upstream layer) and references `[INTENT-1]`. Expect: `E211 OutOfOrderResolutionLevel` for the invalid direction.

- **Error 7: E220 MismatchedResolution — annotation overshoots trace**  
  Three layers (`intents` → `capabilities` → `invariants`), resolution enabled. `l0-intents.md` defines `INTENT-1`. `l1-capabilities.md` defines `CAP-1:invariants`, references `[INTENT-1]`. `l2-invariants.md` has no reference to `CAP-1`. Expect: `E220 MismatchedResolution` for `CAP-1` — annotated resolution level `invariants` but trace falls short.
