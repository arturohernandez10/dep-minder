import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type TraceValidatorConfig = {
  version: number;
  error_root?: string;
  errors: {
    max_errors_env: string;
    default_max_errors: number;
  };
  grouping: {
    start_grouping: string;
    end_grouping: string;
    separator: string;
    passthrough_prefix?: string;
  };
  resolution?: {
    enabled: boolean;
    aliases?: Record<string, string>;
  };
  layers: Array<{
    name: string;
    globs: string[];
    ids: string[];
  }>;
  exclude?: string[];
};

const DEFAULT_CONFIG_NAME = "trace-validator.yml";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function validateConfig(raw: unknown): TraceValidatorConfig {
  assert(typeof raw === "object" && raw !== null, "Config must be a YAML object");
  const config = raw as Record<string, unknown>;

  assert(config.version === 1, "Config version must be 1");

  const errors = config.errors;
  assert(typeof errors === "object" && errors !== null, "Config.errors is required");
  const errorsObj = errors as Record<string, unknown>;
  assert(
    isNonEmptyString(errorsObj.max_errors_env),
    "errors.max_errors_env must be a non-empty string"
  );
  assert(
    Number.isInteger(errorsObj.default_max_errors) && (errorsObj.default_max_errors as number) > 0,
    "errors.default_max_errors must be a positive integer"
  );

  const grouping = config.grouping;
  assert(typeof grouping === "object" && grouping !== null, "Config.grouping is required");
  const groupingObj = grouping as Record<string, unknown>;
  assert(
    isNonEmptyString(groupingObj.start_grouping),
    "grouping.start_grouping must be a non-empty string"
  );
  assert(
    isNonEmptyString(groupingObj.end_grouping),
    "grouping.end_grouping must be a non-empty string"
  );
  assert(
    isNonEmptyString(groupingObj.separator),
    "grouping.separator must be a non-empty string"
  );
  if (
    groupingObj.passthrough_prefix !== undefined &&
    !isNonEmptyString(groupingObj.passthrough_prefix)
  ) {
    throw new Error("grouping.passthrough_prefix must be a non-empty string when provided");
  }

  const layers = config.layers;
  assert(Array.isArray(layers) && layers.length > 0, "Config.layers must be a non-empty array");
  const parsedLayers = layers.map((layer, index) => {
    assert(typeof layer === "object" && layer !== null, `layers[${index}] must be an object`);
    const layerObj = layer as Record<string, unknown>;
    assert(isNonEmptyString(layerObj.name), `layers[${index}].name must be a non-empty string`);
    assert(
      isStringArray(layerObj.globs) && layerObj.globs.length > 0,
      `layers[${index}].globs must be a non-empty string array`
    );
    assert(
      isStringArray(layerObj.ids) && layerObj.ids.length > 0,
      `layers[${index}].ids must be a non-empty string array`
    );
    return {
      name: layerObj.name,
      globs: layerObj.globs,
      ids: layerObj.ids
    };
  });
  const layerNames = new Set(parsedLayers.map((layer) => layer.name));

  if (config.exclude !== undefined) {
    assert(isStringArray(config.exclude), "exclude must be a string array when provided");
  }

  if (config.error_root !== undefined) {
    assert(isNonEmptyString(config.error_root), "error_root must be a non-empty string");
  }

  let resolutionConfig: TraceValidatorConfig["resolution"];
  if (config.resolution !== undefined) {
    assert(
      typeof config.resolution === "object" && config.resolution !== null,
      "resolution must be an object when provided"
    );
    const resolutionObj = config.resolution as Record<string, unknown>;
    assert(typeof resolutionObj.enabled === "boolean", "resolution.enabled must be a boolean");

    let aliases: Record<string, string> | undefined;
    if (resolutionObj.aliases !== undefined) {
      assert(
        typeof resolutionObj.aliases === "object" &&
          resolutionObj.aliases !== null &&
          !Array.isArray(resolutionObj.aliases),
        "resolution.aliases must be an object when provided"
      );
      const aliasesObj = resolutionObj.aliases as Record<string, unknown>;
      aliases = {};
      for (const [alias, value] of Object.entries(aliasesObj)) {
        assert(
          isNonEmptyString(value),
          `resolution.aliases.${alias} must be a non-empty string`
        );
        if (resolutionObj.enabled) {
          assert(
            layerNames.has(value),
            `resolution.aliases.${alias} must map to a configured layer name`
          );
        }
        aliases[alias] = value;
      }
    }

    resolutionConfig = {
      enabled: resolutionObj.enabled,
      aliases
    };
  }

  return {
    version: 1,
    error_root: config.error_root as string | undefined,
    errors: {
      max_errors_env: errorsObj.max_errors_env,
      default_max_errors: errorsObj.default_max_errors as number
    },
    grouping: {
      start_grouping: groupingObj.start_grouping,
      end_grouping: groupingObj.end_grouping,
      separator: groupingObj.separator,
      passthrough_prefix: groupingObj.passthrough_prefix as string | undefined
    },
    resolution: resolutionConfig,
    layers: parsedLayers,
    exclude: config.exclude as string[] | undefined
  };
}

function resolveConfigPath(rootPath: string, configFile?: string): string {
  if (configFile) {
    if (path.isAbsolute(configFile)) {
      return configFile;
    }

    const cwdCandidate = path.resolve(process.cwd(), configFile);
    if (fs.existsSync(cwdCandidate)) {
      return cwdCandidate;
    }

    return path.resolve(rootPath, configFile);
  }

  const candidateInRoot = path.resolve(rootPath, DEFAULT_CONFIG_NAME);
  if (fs.existsSync(candidateInRoot)) {
    return candidateInRoot;
  }

  return path.resolve(process.cwd(), DEFAULT_CONFIG_NAME);
}

export type LoadedConfig = {
  path: string;
  config: TraceValidatorConfig;
  resolution?: ResolutionLookup;
};

export type ResolutionLookup = {
  enabled: boolean;
  layerNames: Set<string>;
  aliasToName: Record<string, string>;
};

function buildResolutionLookup(config: TraceValidatorConfig): ResolutionLookup | undefined {
  if (!config.resolution) {
    return undefined;
  }

  const layerNames = new Set(config.layers.map((layer) => layer.name));
  return {
    enabled: config.resolution.enabled,
    layerNames,
    aliasToName: config.resolution.aliases ?? {}
  };
}

export function loadConfig(rootPath: string, configFile?: string): LoadedConfig {
  const configPath = resolveConfigPath(rootPath, configFile);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const rawText = fs.readFileSync(configPath, "utf-8");
  const parsed = parseYaml(rawText);
  const config = validateConfig(parsed);
  return {
    path: configPath,
    config,
    resolution: buildResolutionLookup(config)
  };
}
