import type { Issue } from "./reporting";

export type ParsedToken = {
  id: string;
  raw: string;
  line: number;
  resolution?: string;
};

export type ParsedFile = {
  definitions: ParsedToken[];
  references: ParsedToken[];
  issues: Issue[];
};

export type ParserOptions = {
  filePath: string;
  text: string;
  layerIdPatterns: RegExp[];
  upstreamIdPatterns: RegExp[];
  resolution?: {
    enabled: boolean;
    layerNames: Set<string>;
    aliasToName: Record<string, string>;
  };
  grouping: {
    start: string;
    end: string;
    separator: string;
    passthroughPrefix?: string;
  };
};

type TokenContext = "definition" | "reference";

const GLOBAL_ID_REGEX = /^[A-Za-z](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function isAllowedTokenChar(char: string): boolean {
  return /[A-Za-z0-9._-]/.test(char);
}

function isAllowedTokenCharWithResolution(char: string, allowResolution: boolean): boolean {
  return isAllowedTokenChar(char) || (allowResolution && char === ":");
}

function findResolutionSplit(value: string): { id: string; level: string } | null {
  let index = value.indexOf(":");
  while (index > 0) {
    const candidate = value.slice(0, index);
    if (GLOBAL_ID_REGEX.test(candidate)) {
      return { id: candidate, level: value.slice(index + 1) };
    }
    index = value.indexOf(":", index + 1);
  }
  return null;
}

function resolveResolutionLevel(
  level: string,
  options: ParserOptions["resolution"]
): string | undefined {
  if (!options) {
    return undefined;
  }
  if (options.layerNames.has(level)) {
    return level;
  }
  return options.aliasToName[level];
}

function buildContextSnippet(lines: string[], lineIndex: number): string[] {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length - 1, lineIndex + 1);
  return lines.slice(start, end + 1);
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

function matchesAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function resolveTokenLineFromSegment(segment: string, startIndex: number): number {
  let lineOffset = 0;
  for (let i = 0; i < startIndex; i += 1) {
    if (segment[i] === "\n") {
      lineOffset += 1;
    }
  }
  return lineOffset;
}

function splitGroupingTokens(
  content: string,
  startLine: number,
  separator: string
): Array<{ raw: string; line: number }> {
  const tokens: Array<{ raw: string; line: number }> = [];
  let index = 0;
  let lineOffset = 0;
  let segmentStartLineOffset = 0;
  let segment = "";

  const pushSegment = () => {
    const raw = segment;
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const leadingWhitespace = raw.length - raw.trimStart().length;
      const tokenLineOffset =
        segmentStartLineOffset + resolveTokenLineFromSegment(raw, leadingWhitespace);
      tokens.push({
        raw: trimmed,
        line: startLine + tokenLineOffset
      });
    }
    segment = "";
    segmentStartLineOffset = lineOffset;
  };

  while (index < content.length) {
    if (separator.length > 0 && content.startsWith(separator, index)) {
      pushSegment();
      index += separator.length;
      continue;
    }

    const char = content[index];
    segment += char;
    if (char === "\n") {
      lineOffset += 1;
    }
    index += 1;
  }

  pushSegment();
  return tokens;
}

function handleToken(
  raw: string,
  normalized: string,
  line: number,
  context: TokenContext,
  options: ParserOptions,
  lines: string[],
  output: ParsedFile,
  contextFlags: { inQuote: boolean; inGrouping: boolean }
): void {
  if (raw.length === 0) {
    return;
  }

  let normalizedId = normalized;
  let resolution: string | undefined;
  if (options.resolution?.enabled) {
    const split = findResolutionSplit(normalized);
    if (split) {
      if (contextFlags.inQuote || contextFlags.inGrouping) {
        output.issues.push(
          createIssue(
            "E111",
            "ResolutionOnNonDefinition",
            options.filePath,
            line,
            lines
          )
        );
        normalizedId = split.id;
      } else {
        const resolved = resolveResolutionLevel(split.level, options.resolution);
        if (!resolved) {
          output.issues.push(
            createIssue(
              "E110",
              `UnknownResolutionLevel: ${split.level}`,
              options.filePath,
              line,
              lines
            )
          );
          normalizedId = split.id;
        } else {
          normalizedId = split.id;
          resolution = resolved;
        }
      }
    }
  }

  const matchesLayer =
    options.layerIdPatterns.length > 0 && matchesAny(options.layerIdPatterns, normalizedId);
  const matchesUpstream =
    options.upstreamIdPatterns.length > 0 && matchesAny(options.upstreamIdPatterns, normalizedId);

  if (!matchesLayer && !matchesUpstream) {
    return;
  }

  const globalValid = GLOBAL_ID_REGEX.test(normalizedId);
  if (!globalValid) {
    output.issues.push(
      createIssue(
        "E020",
        `Bad ID token: ${raw}`,
        options.filePath,
        line,
        lines
      )
    );
    return;
  }

  const eligibleDefinition = context === "definition";
  if (matchesLayer && eligibleDefinition) {
    output.definitions.push({ id: normalizedId, raw, line, resolution });
    return;
  }

  output.references.push({ id: normalizedId, raw, line, resolution });
}

export function parseLayerFile(options: ParserOptions): ParsedFile {
  const lines = options.text.split(/\r?\n/);
  const output: ParsedFile = { definitions: [], references: [], issues: [] };

  const groupingStart = options.grouping.start;
  const groupingEnd = options.grouping.end;
  const separator = options.grouping.separator;
  const passthroughPrefix = options.grouping.passthroughPrefix;

  let index = 0;
  let line = 1;
  let column = 0;
  let inQuote: "'" | '"' | null = null;
  let inGrouping = false;
  let groupingStartLine = 1;
  let groupingBuffer = "";
  let tokenBuffer = "";
  let tokenLine = 1;

  const flushToken = (context: TokenContext) => {
    if (tokenBuffer.length === 0) {
      return;
    }
    handleToken(tokenBuffer, tokenBuffer, tokenLine, context, options, lines, output, {
      inQuote: inQuote !== null,
      inGrouping: false
    });
    tokenBuffer = "";
  };

  const advance = (count: number) => {
    for (let step = 0; step < count; step += 1) {
      const char = options.text[index + step];
      if (char === "\n") {
        line += 1;
        column = 0;
      } else {
        column += 1;
      }
    }
    index += count;
  };

  while (index < options.text.length) {
    if (inGrouping) {
      if (groupingEnd.length > 0 && options.text.startsWith(groupingEnd, index)) {
        const tokens = splitGroupingTokens(groupingBuffer, groupingStartLine, separator);
        if (tokens.length === 0) {
          output.issues.push(
            createIssue(
              "E010",
              "Malformed grouping",
              options.filePath,
              groupingStartLine,
              lines
            )
          );
        } else {
          for (const token of tokens) {
            const original = token.raw;
            let normalized = original;
            if (passthroughPrefix && original.startsWith(passthroughPrefix)) {
              normalized = original.slice(passthroughPrefix.length);
              if (normalized.trim().length === 0) {
                output.issues.push(
                  createIssue(
                    "E020",
                    `Bad ID token: ${original}`,
                    options.filePath,
                    token.line,
                    lines
                  )
                );
                continue;
              }
            }
            handleToken(original, normalized, token.line, "reference", options, lines, output, {
              inQuote: false,
              inGrouping: true
            });
          }
        }

        groupingBuffer = "";
        inGrouping = false;
        advance(groupingEnd.length);
        continue;
      }

      const char = options.text[index];
      groupingBuffer += char;
      advance(1);
      continue;
    }

    const isQuote = options.text[index] === '"' || options.text[index] === "'";
    const isWhitespace = /\s/.test(options.text[index]);
    const isSeparator =
      separator.length > 0 && options.text.startsWith(separator, index);
    const isStartGrouping =
      !inQuote && groupingStart.length > 0 && options.text.startsWith(groupingStart, index);
    const isEndGrouping =
      !inQuote && groupingEnd.length > 0 && options.text.startsWith(groupingEnd, index);

    if (isStartGrouping) {
      flushToken(inQuote ? "reference" : "definition");
      inGrouping = true;
      groupingStartLine = line;
      groupingBuffer = "";
      advance(groupingStart.length);
      continue;
    }

    if (isEndGrouping) {
      flushToken(inQuote ? "reference" : "definition");
      output.issues.push(
        createIssue("E010", "Malformed grouping", options.filePath, line, lines)
      );
      advance(groupingEnd.length);
      continue;
    }

    if (isQuote && !inQuote) {
      flushToken("definition");
      inQuote = options.text[index] as "'" | '"';
      advance(1);
      continue;
    }

    if (isQuote && inQuote === options.text[index]) {
      flushToken("reference");
      inQuote = null;
      advance(1);
      continue;
    }

    if (isSeparator) {
      flushToken(inQuote ? "reference" : "definition");
      advance(separator.length);
      continue;
    }

    if (
      isWhitespace ||
      !isAllowedTokenCharWithResolution(options.text[index], options.resolution?.enabled ?? false)
    ) {
      flushToken(inQuote ? "reference" : "definition");
      advance(1);
      continue;
    }

    if (tokenBuffer.length === 0) {
      tokenLine = line;
    }
    tokenBuffer += options.text[index];
    advance(1);
  }

  flushToken(inQuote ? "reference" : "definition");

  if (inGrouping) {
    output.issues.push(
      createIssue("E010", "Malformed grouping", options.filePath, groupingStartLine, lines)
    );
  }

  return output;
}
