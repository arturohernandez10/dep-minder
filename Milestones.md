# Milestones

## Milestone 1 — CLI + Config Baseline

- Implement CLI `trace-validate` with args: `--config`, `--max-errors`, `--format`, `--layer`, `--strict`, `--quiet`, `--debug`, default path behavior.
- Load and validate `trace-validator.yml` (layers, grouping, error limits, exclude globs).
- File collection via ordered layer globs (first-match-wins), ignore unmatched, apply `exclude`.
- Output: text format only, exit codes wired, minimal error limiting.
- Tests: Core 1 + Core 2 (from `tests/cases.md`).

## Milestone 2 — Parser + Traceability Engine

- Tokenization, ID acceptance rules, quoting handling, grouping parsing (multi, mid-line, non-nesting, span lines).
- Build adjacency sets, passthrough normalization, dedup references.
- Validate coverage + soundness with bounded error emission.
- Implement error codes E010, E020, E030, E101 with 3-line context snippets.
- Tests: Corner 1 + Corner 2 + Error 1–3.

## Milestone 3 — Packaging + JSON Output + Polish

- JSON output format, `--format` switch, strict mode semantics, clean summary footer.
- Version/help output, README usage, example `trace-validator.yml`.
- npm package build (tsconfig, bin mapping, `files`/`exports`), publish-ready.
- Regression test suite + basic CI (node LTS).
- Release checklist: bump version, changelog, `npm pack` sanity check.