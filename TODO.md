# TODO

- Regression test suite + basic CI (node LTS).
- Release checklist: bump version, changelog, `npm pack` sanity check.

## Resolution markers feature

1. `src/config.ts` — Add optional `resolution` block to `TraceValidatorConfig` type and `validateConfig`. Validate alias values against layer names.
2. `src/parser.ts` — Split `ID:level` tokens on definitions. Add `resolution?: string` to `ParsedToken`. Emit E111 (marker in quote/grouping context) and E110 (unknown level). Accept `resolutionLayers` and `resolutionAliases` in `ParserOptions`.
3. `src/validate.ts` — Gate E101 on `resolution.enabled: false`. Add Phase 3: E211 (out-of-order level) and E220 (trace vs annotation mismatch).
4. Test fixtures — Core 3, Corner 4, Error 4 (see `tests/cases.md`).
