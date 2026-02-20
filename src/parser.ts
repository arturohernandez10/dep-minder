import type { Issue } from "./reporting";

export type ParsedToken = {
  id: string;
  raw: string;
  line: number;
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
  line: number,
  context: TokenContext,
  options: ParserOptions,
  lines: string[],
  output: ParsedFile
): void {
  if (raw.length === 0) {
    return;
  }

  const globalValid = GLOBAL_ID_REGEX.test(raw);
  const requiredPatterns =
    context === "definition" ? options.layerIdPatterns : options.upstreamIdPatterns;
  const matchesRequired = requiredPatterns.length > 0 && matchesAny(requiredPatterns, raw);

  if (matchesRequired && globalValid) {
    const entry = { id: raw, raw, line };
    if (context === "definition") {
      output.definitions.push(entry);
    } else {
      output.references.push(entry);
    }
    return;
  }

  if (matchesRequired || globalValid) {
    output.issues.push(
      createIssue(
        "E020",
        `Bad ID token: ${raw}`,
        options.filePath,
        line,
        lines
      )
    );
  }
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
    handleToken(tokenBuffer, tokenLine, context, options, lines, output);
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
            let raw = token.raw;
            if (passthroughPrefix && raw.startsWith(passthroughPrefix)) {
              raw = raw.slice(passthroughPrefix.length);
              if (raw.trim().length === 0) {
                output.issues.push(
                  createIssue(
                    "E020",
                    `Bad ID token: ${token.raw}`,
                    options.filePath,
                    token.line,
                    lines
                  )
                );
                continue;
              }
            }
            handleToken(raw, token.line, "reference", options, lines, output);
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

    if (isWhitespace || !isAllowedTokenChar(options.text[index])) {
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
