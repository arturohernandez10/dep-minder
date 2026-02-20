import { spawnSync } from "node:child_process";
import path from "node:path";

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function runCli(args: string[], cwd: string): RunResult {
  const cliPath = path.resolve(__dirname, "..", "..", "cli.js");
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8"
  });

  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}
