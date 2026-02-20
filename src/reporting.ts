import type { TraceValidatorConfig } from "./config";

export type IssueLevel = "error" | "warning";

export type Issue = {
  code: string;
  message: string;
  filePath: string;
  line: number;
  context: string[];
  level: IssueLevel;
};

export type IssueLimitResult = {
  issues: Issue[];
  truncated: boolean;
};

export function resolveMaxErrors(
  config: TraceValidatorConfig,
  cliMaxErrors?: number
): number {
  if (cliMaxErrors !== undefined) {
    return cliMaxErrors;
  }

  const envName = config.errors.max_errors_env;
  const envValue = process.env[envName];
  if (envValue !== undefined && envValue.trim().length > 0) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return config.errors.default_max_errors;
}

export function limitIssues(issues: Issue[], maxErrors: number): IssueLimitResult {
  if (issues.length <= maxErrors) {
    return { issues, truncated: false };
  }

  return { issues: issues.slice(0, maxErrors), truncated: true };
}

export function formatIssueText(issue: Issue): string {
  const header = `${issue.code} ${issue.message} — ${issue.filePath}:${issue.line}`;
  return ["```error", header, ...issue.context, "```"].join("\n");
}

export function formatLimitFooter(maxErrors: number, envName: string): string {
  return `... ${maxErrors} errors shown (${envName}=${maxErrors}). More errors exist; fix these and re-run.`;
}

export function countIssues(issues: Issue[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if (issue.level === "warning") {
      warnings += 1;
    } else {
      errors += 1;
    }
  }
  return { errors, warnings };
}
