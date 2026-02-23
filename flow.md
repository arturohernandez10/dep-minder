## Data Flow (current code)

### Inputs

- `TraceValidatorConfig` (layer names + regexes)
- `LayerFileCollection` (files per layer)
- CLI options (`--debug`, `--fix-resolution`, `--set-resolution`, layer filter)
- Optional `resolution` config

### Core data products (from `validateTraceability`)

1) **`parsedLayers`**  
   - For each layer:  
     - `definitions`: tokens with `id`, `filePath`, `line`, `offset`, `resolution`  
     - `references`: tokens with `id`, `filePath`, `line`
2) **`referencedIdsByLayer`**  
   - `Set<string>` per layer of every referenced ID found in that layer (no graph)
3) **`fileLines`**  
   - `Map<filePath, string[]>` used for diagnostics
4) **`issues[]`**  
   - Diagnostics produced during validation

### How each feature consumes data

- **E101/E030 (coverage & unknown refs):**  
  Uses `parsedLayers`, `layerRegexes`, plus adjacency loop that filters `references` by immediate upstream patterns.
- **Resolution checks (E211/E220):**  
  Uses `referencedIdsByLayer` via `traceDownstreamReach(id, startLayer)`.

- **`--set-resolution` / `--fix-resolution`:**  
  Uses `analysis.referencedIdsByLayer` and `traceDownstreamReach` to compute target resolution.

---

## Control Flow (current code)

### 1) Parse + normalize

- Parse all files in allowed layers
- Build `parsedLayers`, `referencedIdsByLayer`, `fileLines`

### 2) Adjacency validation loop (coverage + unknown refs)
For each adjacent layer pair `(upstreamIndex, downstreamIndex)`:

1. Compute:
   - `definedUpstream` = IDs defined in upstream layer
   - `referencedInDownstream` = references in downstream layer filtered by **upstream patterns**
2. Errors:
   - `E030` for references not in `definedUpstream`
   - `E101` for upstream definitions not in `referencedInDownstream`
3. Debug (if enabled): prints the same adjacency view

### 3) Resolution validation (E211 / E220)
For each definition token:

1. Determine declared resolution level
2. Compute **actual reach** with `traceDownstreamReach`  
   - Walks layer-by-layer: "does the *same ID* appear in next layer's reference set?"
3. If mismatch: emit `E220`  
4. If out-of-order: emit `E211`

### 4) Fix/Set resolution (writer path)

- After validation, `computeResolutionEdits` runs `traceDownstreamReach` and proposes edits

---

## Duplication Analysis

### The two "adjacency" encodings

The concept of "which IDs connect layer N to layer N+1" is computed **twice**,
in two different representations that cannot share results:

| Aspect | Adjacency loop (Phase 2) | `traceDownstreamReach` (Phase 3 + writer) |
|---|---|---|
| **Data source** | `parsedLayers[N].definitions` + `parsedLayers[N+1].references` filtered by upstream regex | `referencedIdsByLayer[N+1].has(id)` (flat set, no regex filter) |
| **Scope** | One pair at a time | Walks all layers from start to end |
| **Filtering** | Applies `upstreamPatterns` regex to downstream refs | No filtering — any ID in the set counts |
| **Output** | Two maps (`definedUpstream`, `referencedInDownstream`) | A single integer (deepest layer index) |
| **Consumers** | E030, E101, debug output | E220, E211, `computeResolutionEdits` |

### Why this is a problem

1. **Semantic drift risk.** The adjacency loop filters downstream references by
   upstream regex patterns — a reference to `CAP-1` in layer 2 only counts if
   `CAP-1` matches layer 1's ID patterns. But `traceDownstreamReach` checks the
   raw `referencedIdsByLayer` set which was populated *without* that filter. If a
   downstream layer references an ID that matches its *own* layer pattern (not
   the upstream's), the adjacency loop ignores it but `traceDownstreamReach`
   counts it. The two views of "is this ID traced?" can disagree.

2. **Transitive blindness.** The adjacency loop only sees direct pairs. It
   cannot answer "does `CON-3.1` eventually reach the capabilities layer?" — it
   only knows whether `CON-3.1` is referenced in the *immediately next* layer.
   `traceDownstreamReach` can walk further, but it looks for the *same literal
   ID* in each layer's reference set, which is wrong for transitive chains where
   the ID changes at each hop (e.g. `CON-3.1` → `INV-6.0` → `CAP-1.1`).

3. **Code duplication.** `decodeFileContents` in `validate.ts` and
   `decodeFileWithEncoding` in `resolution-writer.ts` are near-identical
   implementations of BOM-aware file reading.

---

## Proposed Refactoring: Unified Trace Graph

Replace the two separate adjacency encodings with a single **trace graph**
built once after parsing, consumed by all downstream phases.

### New data product: `TraceGraph`

```text
TraceGraph = {
  edges: Map<layerIndex, Map<upstreamId, Set<downstreamId>>>
  reach: Map<definitionId, { origin: layerIndex, terminal: layerIndex }>
}
```

- **`edges[layerIndex]`**: for layer pair `(layerIndex-1, layerIndex)`, maps
  each upstream definition ID to the set of downstream definition IDs whose
  groupings reference it. This replaces both the adjacency loop's filtered maps
  and `referencedIdsByLayer`.

- **`reach[definitionId]`**: the transitive closure — the deepest layer a
  definition's influence reaches through the chain of edges. This replaces
  `traceDownstreamReach`.

### How to build it

```text
Phase 1 — Parse (unchanged)
  → parsedLayers, fileLines, parse issues

Phase 1.5 — Build TraceGraph (NEW)
  For each adjacent pair (upstream, downstream):
    1. Collect definedUpstream = definitions in upstream layer
    2. Collect referencedInDownstream = downstream references filtered by upstream patterns
    3. For each matched reference in downstream:
       a. Find which downstream definition "owns" that reference (by file + line range)
       b. Record edge: edges[downstream][upstreamId].add(downstreamDefId)
    4. Collect unknownRefs = references not in definedUpstream → E030

  After all pairs:
    For each definition in layer 0..N:
      Walk edges transitively to compute reach[defId].terminal
```

### Updated control flow

```text
Phase 2 — Validate coverage + soundness (uses TraceGraph)
  E030: emitted during graph construction (unknown refs)
  E101: for each upstream def where reach[defId].terminal == origin layer
        (nothing references it downstream) — resolution OFF only

Phase 3 — Validate resolution (uses TraceGraph)
  E211: definition's annotated layer < definition's own layer (unchanged)
  E220: reach[defId].terminal != annotated layer

Phase 4 — Fix/Set resolution (uses TraceGraph)
  computeResolutionEdits reads reach[defId].terminal directly
  (no separate traceDownstreamReach call)
```

### What this fixes

| Problem | Before | After |
|---|---|---|
| Semantic drift | Two different filtering strategies | Single filtered edge set, used everywhere |
| Transitive chains | `traceDownstreamReach` follows same-ID only | Graph edges track ID-to-ID links across layers |
| Code duplication (adjacency) | Adjacency loop + `traceDownstreamReach` | One graph build, multiple consumers |
| Code duplication (file decode) | `decodeFileContents` + `decodeFileWithEncoding` | Extract shared `decodeFile` into `src/encoding.ts` |

### Transitive example (Core 4)

```text
Layer 0 (constraints):  CON-3.1 defined
Layer 1 (invariants):   INV-6.0 defined, references [CON-3.1]
Layer 2 (capabilities): CAP-1.1 defined, references [INV-6.0]

Graph edges:
  edges[1]["CON-3.1"] = {"INV-6.0"}
  edges[2]["INV-6.0"] = {"CAP-1.1"}

Transitive reach:
  reach["CON-3.1"] = { origin: 0, terminal: 2 }  (via INV-6.0 → CAP-1.1)
  reach["INV-6.0"] = { origin: 1, terminal: 2 }  (via CAP-1.1)
  reach["CAP-1.1"] = { origin: 2, terminal: 2 }  (leaf)
```

`CON-3.1` now correctly reaches layer 2 through the transitive chain, even
though the literal string `CON-3.1` never appears in layer 2.

---

## Migration steps

1. **Extract `src/encoding.ts`** — move `decodeFileContents` /
   `decodeFileWithEncoding` into a shared module. Both `validate.ts` and
   `resolution-writer.ts` import from it.

2. **Build `TraceGraph` in `validate.ts`** — after parsing, construct the edge
   map and transitive reach. Keep the existing adjacency loop temporarily so
   both paths run side-by-side for comparison in tests.

3. **Migrate E030/E101 to graph** — emit E030 during graph construction, E101
   from `reach`. Remove the old adjacency loop.

4. **Migrate E220/E211 to graph** — replace `traceDownstreamReach` calls with
   `reach` lookups.

5. **Migrate `computeResolutionEdits`** — pass `TraceGraph` instead of
   `referencedIdsByLayer`. Remove `traceDownstreamReach` export.

6. **Update debug output** — reconstruct adjacency debug view from graph edges
   instead of the old loop's local maps.
