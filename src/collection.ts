import path from "node:path";
import fg from "fast-glob";
import type { TraceValidatorConfig } from "./config";

export type LayerFile = {
  relativePath: string;
  absolutePath: string;
};

export type LayerFileCollection = {
  layers: Array<{
    name: string;
    files: LayerFile[];
  }>;
};

function toAbsolute(rootPath: string, relativePath: string): string {
  return path.resolve(rootPath, relativePath);
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

export async function collectLayerFiles(
  rootPath: string,
  config: TraceValidatorConfig
): Promise<LayerFileCollection> {
  const assigned = new Set<string>();
  const layers = [];

  for (const layer of config.layers) {
    const layerFiles: LayerFile[] = [];
    const seenInLayer = new Set<string>();

    for (const pattern of layer.globs) {
      const matches = await fg(pattern, {
        cwd: rootPath,
        onlyFiles: true,
        unique: true,
        dot: true,
        ignore: config.exclude ?? []
      });

      for (const match of matches) {
        const normalized = normalizeRelativePath(match);
        if (assigned.has(normalized) || seenInLayer.has(normalized)) {
          continue;
        }
        seenInLayer.add(normalized);
        assigned.add(normalized);
        layerFiles.push({
          relativePath: normalized,
          absolutePath: toAbsolute(rootPath, normalized)
        });
      }
    }

    layers.push({
      name: layer.name,
      files: layerFiles
    });
  }

  return { layers };
}
