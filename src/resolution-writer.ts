import fs from "node:fs";
import path from "node:path";
import type { ResolutionLookup, TraceValidatorConfig } from "./config";
import { decodeFileWithEncoding, type WriterEncoding } from "./encoding";
import { type TraceAnalysis } from "./validate";

export type ResolutionEdit = {
  filePath: string;
  line: number;
  offset: number;
  length: number;
  oldText: string;
  newText: string;
  definitionId: string;
  oldResolution?: string;
  newResolution: string;
};

export type WriterResult = {
  edits: ResolutionEdit[];
  filesWritten: number;
};

function encodeWithEncoding(text: string, encoding: WriterEncoding): Buffer {
  if (encoding.encoding === "utf8") {
    return Buffer.from(text, "utf8");
  }
  if (encoding.encoding === "utf16le") {
    const payload = Buffer.from(text, "utf16le");
    if (!encoding.hasBom) {
      return payload;
    }
    return Buffer.concat([Buffer.from([0xff, 0xfe]), payload]);
  }
  const payload = Buffer.from(text, "utf16le");
  const swapped = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i + 1 < payload.length; i += 2) {
    swapped[i] = payload[i + 1];
    swapped[i + 1] = payload[i];
  }
  if (!encoding.hasBom) {
    return swapped;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), swapped]);
}

export function computeResolutionEdits(
  config: TraceValidatorConfig,
  analysis: TraceAnalysis,
  resolution: ResolutionLookup,
  options: { set: boolean; fix: boolean }
): ResolutionEdit[] {
  const edits: ResolutionEdit[] = [];
  const separator = resolution.separator;

  for (let layerIndex = 0; layerIndex < analysis.parsedLayers.length; layerIndex += 1) {
    const layer = analysis.parsedLayers[layerIndex];
    for (const token of layer.definitions) {
      const reach = analysis.traceGraph.reachById.get(token.id);
      const actualIndex = reach?.terminal ?? layerIndex;
      const actualResolution = config.layers[actualIndex]?.name ?? token.resolution ?? "";

      const hasMarker = token.length > token.raw.length;
      if (options.set && !token.resolution && !hasMarker) {
        edits.push({
          filePath: token.filePath,
          line: token.line,
          offset: token.offset,
          length: token.length,
          oldText: "",
          newText: `${token.id}${separator}${actualResolution}`,
          definitionId: token.id,
          oldResolution: token.resolution,
          newResolution: actualResolution
        });
      }

      if (options.fix && token.resolution && token.resolution !== actualResolution) {
        edits.push({
          filePath: token.filePath,
          line: token.line,
          offset: token.offset,
          length: token.length,
          oldText: "",
          newText: `${token.id}${separator}${actualResolution}`,
          definitionId: token.id,
          oldResolution: token.resolution,
          newResolution: actualResolution
        });
      }
    }
  }

  return edits;
}

export function applyResolutionEdits(
  rootPath: string,
  edits: ResolutionEdit[],
  dryRun: boolean
): WriterResult {
  if (edits.length === 0) {
    return { edits: [], filesWritten: 0 };
  }

  const editsByFile = new Map<string, ResolutionEdit[]>();
  for (const edit of edits) {
    const bucket = editsByFile.get(edit.filePath);
    if (bucket) {
      bucket.push(edit);
    } else {
      editsByFile.set(edit.filePath, [edit]);
    }
  }

  let filesWritten = 0;
  const appliedEdits: ResolutionEdit[] = [];

  for (const [relativePath, fileEdits] of editsByFile) {
    const absolutePath = path.resolve(rootPath, relativePath);
    const encoding = decodeFileWithEncoding(absolutePath);
    let text = encoding.text;

    const sorted = [...fileEdits].sort((a, b) => b.offset - a.offset);
    for (const edit of sorted) {
      const existing = text.slice(edit.offset, edit.offset + edit.length);
      if (!existing) {
        throw new Error(`Resolution update failed: empty token at ${relativePath}:${edit.line}`);
      }
      const updated: ResolutionEdit = {
        ...edit,
        oldText: existing
      };
      appliedEdits.push(updated);
      text =
        text.slice(0, edit.offset) +
        edit.newText +
        text.slice(edit.offset + edit.length);
    }

    if (!dryRun) {
      const buffer = encodeWithEncoding(text, encoding);
      fs.writeFileSync(absolutePath, buffer);
      filesWritten += 1;
    }
  }

  return { edits: appliedEdits, filesWritten };
}
