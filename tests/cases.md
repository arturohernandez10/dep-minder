# Test cases

## Core

- **Core 1: Full pass with coverage + soundness**  
  Upstream IDs defined in `l0-*.md`, downstream `l1-*.md` references all of them exactly once inside groupings; no extra refs. Expect: zero errors; exit success.

- **Core 2: Passthrough counts as reference**  
  `l1-*.md` uses `PT:<UPSTREAM_ID>` in groupings for every upstream ID, no direct same-layer definitions. Expect: zero errors; coverage satisfied via passthrough normalization.

## Corner

- **Corner 1: Groupings mid-line and multiple per file**  
  A single downstream file has two groupings on separate lines and one grouping mid-line. Expect: all groupings parsed; refs deduped; no parse errors.

- **Corner 2: Quoted IDs become references (not definitions)**  
  A layer file includes an ID string in quotes that matches its own layer pattern. Expect: it is treated as a reference, not a definition.

## Error

- **Error 1: E010 MalformedGrouping (unclosed)**  
  Downstream file has a `[` without a matching `]` (spans to EOF). Expect: `E010 MalformedGrouping` with snippet.

- **Error 2: E030 UnknownUpstreamReference**  
  Downstream grouping includes `INV-999` not defined upstream. Expect: `E030 UnknownUpstreamReference` once for `INV-999`.

- **Error 3: E101 UnmappedUpstreamId**  
  Upstream defines `CAP-1` and `CAP-2`, downstream references only `CAP-1`. Expect: `E101 UnmappedUpstreamId` for `CAP-2` once.
