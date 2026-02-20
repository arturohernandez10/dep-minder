import type { LayerFileCollection } from "./collection";
import type { TraceValidatorConfig } from "./config";
import type { Issue } from "./reporting";

export type ValidationOptions = {
  layer?: string;
};

export function validateTraceability(
  _rootPath: string,
  _config: TraceValidatorConfig,
  _collection: LayerFileCollection,
  _options: ValidationOptions
): Issue[] {
  return [];
}
