import fs from "node:fs";
import path from "node:path";
import type { LayerFileCollection } from "./collection";
import type { ResolutionLookup, TraceValidatorConfig } from "./config";
import type { Issue } from "./reporting";
import { parseLayerFile } from "./parser";

type TokenWithSource = {
  id: string;
  raw: string;
  line: number;
  filePath: string;
  resolution?: string;
};

type ParsedLayer = {
  definitions: TokenWithSource[];
  references: TokenWithSource[];
};

export type ValidationOptions = {
  layer?: string;
  debug?: boolean;
  quiet?: boolean;
};

function matchesAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function buildContextSnippet(lines: string[], lineIndex: number): string[] {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length - 1, lineIndex + 1);
  return lines.slice(start, end + 1);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveIssuePath(
  rootPath: string,
  config: TraceValidatorConfig,
  relativePath: string
): string {
  const absolutePath = path.resolve(rootPath, relativePath);
  if (!config.error_root) {
    return absolutePath;
  }
  const errorRoot = path.isAbsolute(config.error_root)
    ? config.error_root
    : path.resolve(rootPath, config.error_root);
  return normalizeRelativePath(path.relative(errorRoot, absolutePath));
}

function createIssue(
  code: string,
  message: string,
  filePath: string,
  line: number,
  lines: string[]
): Issue {
  const lineIndex = Math.max(0, Math.min(lines.length - 1, line - 1));
  return {
    code,
    message,
    filePath,
    line,
    context: buildContextSnippet(lines, lineIndex),
    level: "error"
  };
}

function compileLayerRegexes(config: TraceValidatorConfig): RegExp[][] {
  return config.layers.map((layer) =>
    layer.ids.map((pattern) => new RegExp(`^${pattern}$`))
  );
}

function resolveLayerIndex(config: TraceValidatorConfig, layer?: string): number | undefined {
  if (!layer) {
    return undefined;
  }
  const index = config.layers.findIndex((entry) => entry.name === layer);
  return index >= 0 ? index : undefined;
}

function toTokenWithSource(
  token: { id: string; raw: string; line: number; resolution?: string },
  filePath: string
) {
  return { id: token.id, raw: token.raw, line: token.line, filePath, resolution: token.resolution };
}

function addToMapIfMissing(map: Map<string, TokenWithSource>, token: TokenWithSource): void {
  if (!map.has(token.id)) {
    map.set(token.id, token);
  }
}

function isResolutionPathInScope(
  allowedLayerIndices: Set<number>,
  fromIndex: number,
  toIndex: number
): boolean {
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  for (let index = start; index <= end; index += 1) {
    if (!allowedLayerIndices.has(index)) {
      return false;
    }
  }
  return true;
}

export function validateTraceability(
  rootPath: string,
  config: TraceValidatorConfig,
  collection: LayerFileCollection,
  options: ValidationOptions,
  resolution?: ResolutionLookup
): Issue[] {
  const issues: Issue[] = [];
  const layerRegexes = compileLayerRegexes(config);
  const layerIndex = resolveLayerIndex(config, options.layer);
  const allowedLayerIndices =
    layerIndex === undefined
      ? new Set(config.layers.map((_, index) => index))
      : new Set(
          [layerIndex - 1, layerIndex].filter((index) => index >= 0)
        );

  const parsedLayers: ParsedLayer[] = config.layers.map(() => ({
    definitions: [],
    references: []
  }));
  const fileLines = new Map<string, string[]>();
  const referencedIdsByLayer = config.layers.map(() => new Set<string>());

  for (let index = 0; index < collection.layers.length; index += 1) {
    if (!allowedLayerIndices.has(index)) {
      continue;
    }
    const layer = collection.layers[index];
    const layerPatterns = layerRegexes[index] ?? [];
    const upstreamPatterns = index > 0 ? layerRegexes[index - 1] ?? [] : [];

    for (const file of layer.files) {
      const text = fs.readFileSync(file.absolutePath, "utf-8");
      const lines = text.split(/\r?\n/);
      fileLines.set(file.relativePath, lines);
      const issuePath = resolveIssuePath(rootPath, config, file.relativePath);

      const parsed = parseLayerFile({
        filePath: issuePath,
        text,
        layerIdPatterns: layerPatterns,
        upstreamIdPatterns: upstreamPatterns,
        resolution: resolution?.enabled ? resolution : undefined,
        grouping: {
          start: config.grouping.start_grouping,
          end: config.grouping.end_grouping,
          separator: config.grouping.separator,
          passthroughPrefix: config.grouping.passthrough_prefix
        }
      });

      issues.push(...parsed.issues);
      parsedLayers[index].definitions.push(
        ...parsed.definitions.map((token) => toTokenWithSource(token, file.relativePath))
      );
      parsedLayers[index].references.push(
        ...parsed.references.map((token) => toTokenWithSource(token, file.relativePath))
      );
      for (const token of parsed.references) {
        referencedIdsByLayer[index].add(token.id);
      }
    }
  }

  const pairsToValidate =
    layerIndex === undefined
      ? config.layers.map((_, index) => index).filter((index) => index > 0)
      : layerIndex > 0
        ? [layerIndex]
        : [];

  for (const downstreamIndex of pairsToValidate) {
    if (!allowedLayerIndices.has(downstreamIndex)) {
      continue;
    }
    const upstreamIndex = downstreamIndex - 1;
    if (!allowedLayerIndices.has(upstreamIndex)) {
      continue;
    }
    const upstreamPatterns = layerRegexes[upstreamIndex] ?? [];
    const upstreamTokens = parsedLayers[upstreamIndex].definitions;
    const downstreamTokens = parsedLayers[downstreamIndex].references;

    const definedUpstream = new Map<string, TokenWithSource>();
    for (const token of upstreamTokens) {
      addToMapIfMissing(definedUpstream, token);
    }

    const referencedInDownstream = new Map<string, TokenWithSource>();
    for (const token of downstreamTokens) {
      if (!matchesAny(upstreamPatterns, token.id)) {
        continue;
      }
      addToMapIfMissing(referencedInDownstream, token);
    }

    if (options.debug && !options.quiet) {
      const upstreamName = config.layers[upstreamIndex]?.name ?? "(unknown)";
      const downstreamName = config.layers[downstreamIndex]?.name ?? "(unknown)";
      const definedIds = [...definedUpstream.keys()].sort();
      const referencedIds = [...referencedInDownstream.keys()].sort();
      console.log(
        `Adjacency ${upstreamName} -> ${downstreamName}: DefinedUpstream=${definedIds.join(
          ", "
        ) || "(none)"}`
      );
      console.log(
        `Adjacency ${upstreamName} -> ${downstreamName}: ReferencedInDownstream=${referencedIds.join(
          ", "
        ) || "(none)"}`
      );
    }

    const unknownReferences = [...referencedInDownstream.entries()]
      .filter(([id]) => !definedUpstream.has(id))
      .sort(([idA], [idB]) => idA.localeCompare(idB));
    for (const [id, token] of unknownReferences) {
      const lines = fileLines.get(token.filePath) ?? [];
      const issuePath = resolveIssuePath(rootPath, config, token.filePath);
      issues.push(
        createIssue(
          "E030",
          `UnknownUpstreamReference: ${id}`,
          issuePath,
          token.line,
          lines
        )
      );
    }

    const missingUpstream = [...definedUpstream.entries()]
      .filter(([id]) => !referencedInDownstream.has(id))
      .sort(([idA], [idB]) => idA.localeCompare(idB));
    for (const [id, token] of missingUpstream) {
      const lines = fileLines.get(token.filePath) ?? [];
      const issuePath = resolveIssuePath(rootPath, config, token.filePath);
      issues.push(
        createIssue(
          "E101",
          `UnmappedUpstreamId: ${id}`,
          issuePath,
          token.line,
          lines
        )
      );
    }
  }

  if (resolution?.enabled) {
    for (let layerIndexToCheck = 0; layerIndexToCheck < parsedLayers.length; layerIndexToCheck += 1) {
      const layer = parsedLayers[layerIndexToCheck];
      for (const token of layer.definitions) {
        if (!token.resolution) {
          continue;
        }
        const resolutionIndex = config.layers.findIndex(
          (entry) => entry.name === token.resolution
        );
        if (resolutionIndex <= layerIndexToCheck) {
          const lines = fileLines.get(token.filePath) ?? [];
          const issuePath = resolveIssuePath(rootPath, config, token.filePath);
          issues.push(
            createIssue(
              "E211",
              `OutOfOrderResolutionLevel: ${token.resolution}`,
              issuePath,
              token.line,
              lines
            )
          );
          continue;
        }

        if (!isResolutionPathInScope(allowedLayerIndices, layerIndexToCheck, resolutionIndex)) {
          continue;
        }

        let actualIndex = layerIndexToCheck;
        while (actualIndex + 1 < referencedIdsByLayer.length) {
          const nextIndex = actualIndex + 1;
          if (!referencedIdsByLayer[nextIndex].has(token.id)) {
            break;
          }
          actualIndex = nextIndex;
        }

        if (actualIndex !== resolutionIndex) {
          const lines = fileLines.get(token.filePath) ?? [];
          const issuePath = resolveIssuePath(rootPath, config, token.filePath);
          const resolvedName = config.layers[resolutionIndex]?.name ?? token.resolution;
          const actualName = config.layers[actualIndex]?.name ?? "(unknown)";
          issues.push(
            createIssue(
              "E220",
              `MismatchedResolution: expected ${resolvedName}, found ${actualName}`,
              issuePath,
              token.line,
              lines
            )
          );
        }
      }
    }
  }

  return issues;
}
