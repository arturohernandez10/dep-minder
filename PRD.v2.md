# PRD: Namespaced Identifier & Comment Indexing Language Server (Langium-based)

## 1) Summary

Build a **resident Language Server Protocol (LSP) server** using **Langium** to provide fast, workspace-wide language features for a lightweight “annotation language” embedded in (or adjacent to) Markdown and other text files. The language’s core concerns are:

* **Namespaced identifiers** (e.g., `org.project.Entity`, `pkg::module::Symbol`, `a/b/c#Name` — exact syntax configurable)
* **Comments** (line/block) that may carry metadata (tags, docstrings, ownership, links)
* A **workspace index/graph** over these identifiers and their relationships
* Editor features: **go-to-definition**, **find references**, **hover**, **workspace symbols**, and basic **diagnostics**

We assume Markdown has a separate LSP; this server focuses on **the custom syntax and indexing**, optionally including extraction from Markdown code fences if configured.

---

## 2) Goals and Non-Goals

### Goals

1. **Fast, resident indexing** across a workspace with incremental updates.
2. Provide core LSP features for namespaced identifiers:

   * Definitions
   * References
   * Hover (doc extracted from comments)
   * Document/workspace symbol search
3. Provide **diagnostics** for:

   * Invalid identifier syntax
   * Duplicate definitions (configurable)
   * Unresolved references (configurable)
4. Support **multi-file namespaces** and a **graph model**:

   * Node = identifier
   * Edges = relationships inferred from syntax (e.g., `uses`, `defines`, `linksTo`)
5. Play well with common editors (VS Code first; LSP-compliant elsewhere).

### Non-Goals

* Full Markdown parsing & features (handled by markdown LSP).
* Python/TypeScript semantic analysis (handled by their LSPs).
* Complex formatting/refactoring initially (can be v2).

---

## 3) Users & Use Cases

### Primary Users

* Engineers authoring documentation/spec files where identifiers link concepts across files.
* Teams maintaining a knowledge graph or “entity registry” stored in files.

### Key Use Cases

1. Author writes `foo.bar.Baz` and wants **hover** to show doc comment.
2. Author references `foo.bar.Baz` and wants **go-to-definition**.
3. Team wants **workspace symbol search** by partial namespace.
4. CI/editor should warn on **duplicate identifiers** or **dangling references**.
5. File changes should update index **instantly** without full workspace rescans.

---

## 4) Scope: Files & Embedding

### File types (configurable)

* Dedicated extension (recommended): e.g., `.ns`, `.id`, `.graph`, `.registry`
* Optional: Markdown extraction

  * Parse only fenced code blocks tagged with a language id (e.g., ```nsid)
  * OR parse inline directives (e.g., `@id(foo.bar.Baz)`)

**Default assumption**: dedicated files for v1. Markdown embedding is optional behind a feature flag.

---

## 5) Functional Requirements

### 5.1 Language Model (Langium)

Define grammar for:

* `QualifiedName` / namespaced identifier
* `Definition` statements
* `Reference` occurrences
* Comments and structured comment metadata
* Optional relationship syntax

Example conceptual constructs:

* `def foo.bar.Baz: "Title" #doc ...`
* `ref foo.bar.Baz`
* `Baz -> foo.bar.Qux` (edge)
* Comments that attach to next definition

### 5.2 LSP Features (v1)

**Must-have**

* `textDocument/definition`
* `textDocument/references`
* `textDocument/hover`
* `textDocument/documentSymbol`
* `workspace/symbol`
* `textDocument/publishDiagnostics`

**Should-have**

* `textDocument/completion` for namespaces (prefix-based)
* `textDocument/rename` (if safe)
* `workspace/didChangeWatchedFiles` support for non-open file updates

### 5.3 Indexing & Graph

* Maintain a workspace index keyed by **canonical identifier**:

  * `id -> { definitions[], references[], docs, tags, fileUris }`
* Store:

  * Definition range(s)
  * Reference ranges
  * Derived doc from leading/trailing comments
  * Optional edges inferred from syntax
* Support:

  * Lookup by exact id
  * Prefix search (`foo.bar.*`)
  * Fuzzy search (`Baz`)

### 5.4 Diagnostics Rules

Configurable severities:

* `InvalidIdentifier` (error)
* `DuplicateDefinition` (warning/error)
* `UnresolvedReference` (warning/info)
* `NamespaceStyle` (info) — optional linting rules

---

## 6) Non-Functional Requirements

### Performance

* **Open file change to updated diagnostics**: target < 150ms for typical files
* **Workspace index build**: reasonable for repo sizes (e.g., 5k–50k files) with progress reporting
* Incremental updates: only re-parse changed documents; update index deltas

### Reliability

* No crashes on malformed files; recoverable parse errors and best-effort indexing

### Compatibility

* LSP 3.x compliant
* VS Code extension packaging supported; other clients should work via standard LSP

### Observability

* Debug logging toggles
* Optional telemetry hooks (off by default)

---

## 7) Architecture

### 7.1 Components

1. **Langium Parser & AST**

   * Grammar → AST nodes
2. **Document Service**

   * Tracks open documents and versions
3. **Workspace Index Service**

   * Builds/updates global symbol index
4. **Linker/Resolver**

   * Resolves references to definitions (cross-file)
5. **LSP Handlers**

   * Definition, references, hover, symbols, completion
6. **File Watch Integration**

   * Use `workspace/didChangeWatchedFiles` when provided
   * Fallback: server-side FS watcher (optional; client support varies)

### 7.2 Data Flow

* On startup:

  * Discover workspace files (by glob)
  * Parse → extract definitions/references/comments → build index
  * Publish progress
* On `didOpen` / `didChange`:

  * Parse updated doc
  * Compute delta: removed/added definitions and references
  * Update index
  * Recompute diagnostics for impacted docs
* On `didChangeWatchedFiles`:

  * Re-parse changed files (from disk) and update index

### 7.3 Incremental Strategy

v1 approach:

* Re-parse entire changed document (Langium typical)
* Delta update index at the document level (remove old entries from this URI, add new)
* Only re-resolve references affected by:

  * changes in this document
  * changes in definitions with same identifier

---

## 8) Configuration

### User Settings (VS Code + generic LSP)

* File include globs / exclude globs
* Identifier syntax mode (dot-separated, `::`, `/`, mixed)
* Diagnostics toggles & severities
* Markdown embedding mode:

  * Off | fenced-only | directives-only | both
* Namespace normalization rules (case folding, separators)

---

## 9) UX / Behavior Details

### Hover

* Show canonical identifier
* Show doc text extracted from associated comments
* Show where defined + optional tags

### Definition

* If multiple definitions:

  * Jump to “best” (same workspace folder)
  * Provide list if client supports it (multiple locations)

### References

* Return all known reference ranges across workspace

### Symbols

* Document symbols: list of definitions in file
* Workspace symbols: prefix/fuzzy match over identifier index

### Completion (should-have)

* Offer next namespace segment suggestions based on index
* Offer known identifiers for `ref` contexts

---

## 10) Milestones

### M0: Skeleton

* Langium project scaffold
* Minimal grammar
* VS Code extension wiring / server launch

### M1: Index + Diagnostics

* Parse definitions/references/comments
* Workspace index build
* Publish diagnostics for invalid syntax and duplicates

### M2: Navigation Features

* Definition + references
* Hover
* Document/workspace symbols

### M3: Incremental + File Watching

* Delta updates on edits
* `didChangeWatchedFiles` integration
* Performance tuning and progress reporting

### M4: Optional Markdown Embedding

* Fenced block extraction
* Map ranges back into Markdown document coordinates

---

## 11) Open Questions / Risks

### Risks

* Markdown embedding range mapping can be tricky and editor-specific.
* Very large workspaces may require batching and indexing throttles.
* If identifier syntax is highly flexible, grammar complexity may grow.

### Open Questions

* Exact identifier syntax and allowed characters?
* Do we need explicit edge syntax or just implicit “references” edges?
* Should duplicate definitions be allowed with scoping rules (per folder, per module)?

---

## 12) Acceptance Criteria (v1)

* Server indexes workspace and provides:

  * go-to-definition, references, hover, symbols
* Updates correctly on edits and file changes
* Diagnostics appear for invalid ids and duplicates
* Works in VS Code on a sample workspace:

  * 500+ files
  * 10k+ identifiers
  * updates within target latency
