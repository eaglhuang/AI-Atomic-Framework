
import { execFileSync } from "node:child_process";

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

import path from "node:path";

import {
  actorIdEnvVar,
  actorRegistryRelativePath,
  findActorByResolvedId,
  inspectTrackedActorRegistryState,
  readRuntimeIdentityDefault,
  readRuntimeIdentityForActor,
  resolveActorId,
  writeRuntimeIdentityForActor,
} from "../../actor-registry.ts";

import { hasAtmCriticalNonDocSurface } from "../../framework-development/path-classification.ts";

import {
  extractGovernanceTaskIdFromPath,
  inspectTouchedPhysicalLineBudget,
  isProtectedStagedGovernanceOwnershipPath,
  normalizeRelativePath,
  normalizeTaskClaimIntent,
  pathMatchesTaskScope,
  uniqueSorted,
} from "../commit-scope-policy.ts";

import {
  CliError,
  makeResult,
  message,
  quoteCliValue,
  relativePathFrom,
} from "../../shared.ts";

import { isGovernedLedgerBoundaryPathForGitCommit } from './git-head-evidence-transaction.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;



export function resolveGitExecutable() {
  const configured = process.env.ATM_GIT_EXECUTABLE?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  if (process.platform === "win32") {
    const windowsGit = "C:\\Program Files\\Git\\cmd\\git.exe";
    if (existsSync(windowsGit)) {
      return windowsGit;
    }
  }
  return "git";
}

export const DEFAULT_GIT_COMMIT_TIMEOUT_MS = 420_000;

/**
 * Host Git push/failure-recovery calls are control-plane children too. Keep a
 * bounded default while allowing the governed command to pass an explicit
 * budget for a measured environment.
 */
export const DEFAULT_GIT_BOUNDARY_TIMEOUT_MS = 420_000;

export function resolveGitBoundaryTimeoutMs(explicitTimeoutMs: LegacyValue) {
  if (explicitTimeoutMs !== null && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }
  const envValue = Number(process.env.ATM_GIT_BOUNDARY_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) return envValue;
  return DEFAULT_GIT_BOUNDARY_TIMEOUT_MS;
}

export function resolveGitCommitTimeoutMs(explicitTimeoutMs: LegacyValue) {
  if (
    explicitTimeoutMs !== null &&
    Number.isFinite(explicitTimeoutMs) &&
    explicitTimeoutMs > 0
  ) {
    return explicitTimeoutMs;
  }
  const envValue = Number(process.env.ATM_GIT_COMMIT_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }
  return DEFAULT_GIT_COMMIT_TIMEOUT_MS;
}

export function gitCommitAttemptStatusRelativePath(actorId: LegacyValue, taskId: LegacyValue) {
  const safeActor = actorId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const safeTask = (taskId ?? "no-task").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `.atm/runtime/git-commit-attempts/${safeActor}__${safeTask}.json`;
}

export function writeGitCommitAttemptStatus(cwd: LegacyValue, statusRelativePath: LegacyValue, status: LegacyValue) {
  try {
    const absolutePath = path.join(cwd, statusRelativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  } catch {}
}

export function readGitCommitAttemptStatus(cwd: LegacyValue, actorId: LegacyValue, taskId: LegacyValue) {
  const absolutePath = path.join(
    cwd,
    gitCommitAttemptStatusRelativePath(actorId, taskId),
  );
  if (!existsSync(absolutePath)) return null;
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    return null;
  }
}

export function runGitCommand(cwd: LegacyValue, args: LegacyValue, stdio: LegacyValue = ["ignore", "pipe", "ignore"]) {
  return execFileSync(resolveGitExecutable(), args, {
    cwd,
    encoding: "utf8",
    stdio,
    env: createSanitizedGitEnv(),
  });
}

export function runGitCommandWithTimeout(
  cwd: LegacyValue,
  args: LegacyValue,
  timeoutMs: LegacyValue,
  stdio: LegacyValue = ["ignore", "pipe", "ignore"],
) {
  return execFileSync(resolveGitExecutable(), args, {
    cwd,
    encoding: "utf8",
    stdio,
    timeout: resolveGitBoundaryTimeoutMs(timeoutMs),
    killSignal: "SIGTERM",
    windowsHide: true,
    env: createSanitizedGitEnv(),
  });
}

export function runGitCommandWithEnv(
  cwd: LegacyValue,
  args: LegacyValue,
  env: LegacyValue,
  stdio: LegacyValue = ["ignore", "pipe", "ignore"],
) {
  return execFileSync(resolveGitExecutable(), args, {
    cwd,
    encoding: "utf8",
    stdio,
    env: createSanitizedGitEnv(env),
  });
}

export function inspectStdinPathspecGitAddProcesses() {
  if (process.env.ATM_GIT_STDIN_PATHSPEC_PREFLIGHT === "0") {
    return [];
  }
  const fixture = process.env.ATM_GIT_STDIN_PATHSPEC_PROCESS_FIXTURE;
  if (fixture) {
    try {
      const parsed = JSON.parse(fixture);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry: LegacyValue) => {
          if (!entry || typeof entry !== "object") return null;
          const record = entry;
          const commandLine =
            typeof record.commandLine === "string" ? record.commandLine : "";
          return {
            pid: typeof record.pid === "number" ? record.pid : null,
            commandLine,
          };
        })
        .filter((entry: LegacyValue) => Boolean(entry?.commandLine))
        .filter(isStdinPathspecGitAddProcess);
    } catch {
      return [];
    }
  }
  try {
    if (process.platform === "win32") {
      const raw = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name = 'git.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .map((entry: LegacyValue) => {
          if (!entry || typeof entry !== "object") return null;
          const record = entry;
          return {
            pid: typeof record.ProcessId === "number" ? record.ProcessId : null,
            commandLine:
              typeof record.CommandLine === "string" ? record.CommandLine : "",
          };
        })
        .filter((entry: LegacyValue) => Boolean(entry?.commandLine))
        .filter(isStdinPathspecGitAddProcess);
    }
    const raw = execFileSync("ps", ["-eo", "pid=,args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return raw
      .split(/\r?\n/)
      .map((line: LegacyValue) => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (!match) return null;
        return { pid: Number(match[1]), commandLine: match[2] ?? "" };
      })
      .filter((entry: LegacyValue) => Boolean(entry?.commandLine))
      .filter(isStdinPathspecGitAddProcess);
  } catch {
    return [];
  }
}

export function isStdinPathspecGitAddProcess(processInfo: LegacyValue) {
  const commandLine = processInfo.commandLine.toLowerCase();
  return (
    /\bgit(?:\.exe)?["']?\s/.test(commandLine) &&
    commandLine.includes(" add ") &&
    commandLine.includes("--pathspec-from-file=-") &&
    commandLine.includes("--pathspec-file-nul")
  );
}

export function assertNoStdinPathspecGitAddPreflight(cwd: LegacyValue) {
  const processes = inspectStdinPathspecGitAddProcesses();
  if (processes.length === 0) return;
  throw new CliError(
    "ATM_GIT_COMMIT_STDIN_PATHSPEC_ADD_ACTIVE",
    "ATM detected an active git add --pathspec-from-file=- process before commit. This usually means an editor staging helper is waiting on stdin and can make the commit appear hung.",
    {
      exitCode: 1,
      details: {
        cwd,
        processes,
        recovery: [
          "Wait briefly for the staging helper to finish, then rerun git commit-status.",
          "If it remains active, terminate only the listed git add process after confirming it is the stuck stdin pathspec helper.",
          "Stage files explicitly with git add -- <paths> before retrying node atm.mjs git commit.",
        ],
        disablePreflightEnv: "ATM_GIT_STDIN_PATHSPEC_PREFLIGHT=0",
      },
    },
  );
}

export function stageTrackedActorRegistryIfNeeded(cwd: LegacyValue) {
  const actorRegistryState = inspectTrackedActorRegistryState(cwd);
  if (!actorRegistryState.tracked || !actorRegistryState.unstaged) {
    return null;
  }
  runGitCommand(
    cwd,
    ["add", "--", actorRegistryRelativePath],
    ["ignore", "pipe", "pipe"],
  );
  return actorRegistryRelativePath;
}

export function listCommitAttributionSideEffectPaths(cwd: LegacyValue) {
  const actorRegistryState = inspectTrackedActorRegistryState(cwd);
  if (!actorRegistryState.tracked) {
    return [];
  }
  if (!actorRegistryState.staged && !actorRegistryState.unstaged) {
    return [];
  }
  return [normalizeRelativePath(actorRegistryState.path)];
}

export function isCommitAttributionSideEffectPath(filePath: LegacyValue) {
  return (
    normalizeRelativePath(filePath).toLowerCase() ===
    actorRegistryRelativePath.toLowerCase()
  );
}

export function createSanitizedGitEnv(extra: LegacyValue = {}) {
  const env = { ...process.env, ...extra };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_PREFIX",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
  ]) {
    delete env[key];
  }
  if (!("GIT_INDEX_FILE" in extra)) {
    delete env.GIT_INDEX_FILE;
  }
  // Read-oriented Git commands may otherwise opportunistically refresh the
  // index. That is unnecessary for ATM's inspected snapshots and can strand
  // an index.lock when an editor or host terminates the child process.
  // Required locks for explicit add/commit operations remain available.
  env.GIT_OPTIONAL_LOCKS = "0";
  return addTrustedGitHookRuntimePath(env);
}

/**
 * Keeps Git hook interpreter discovery available after ATM has removed
 * repository-selection variables. Git for Windows executes shebang hooks
 * through `/usr/bin/env`; its `usr/bin` directory is therefore a runtime
 * dependency of Git itself, not an inherited shell capability.
 */
export function addTrustedGitHookRuntimePath(
  env: NodeJS.ProcessEnv,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly gitExecutable?: string;
    readonly pathExists?: (candidate: string) => boolean;
  } = {},
): NodeJS.ProcessEnv {
  if ((options.platform ?? process.platform) !== "win32") return env;

  const gitExecutable = options.gitExecutable ?? resolveGitExecutable();
  const pathExists = options.pathExists ?? existsSync;
  const gitRoot = path.dirname(path.dirname(gitExecutable));
  const hookRuntimePath = path.join(gitRoot, "usr", "bin");
  if (!pathExists(path.join(hookRuntimePath, "sh.exe"))) return env;

  const existingEntries = Object.entries(env)
    .filter(([key]) => key.toLowerCase() === "path")
    .flatMap(([, value]) => String(value ?? "").split(path.delimiter))
    .filter(Boolean);
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") delete env[key];
  }
  if (!existingEntries.some((entry) => entry.toLowerCase() === hookRuntimePath.toLowerCase())) {
    existingEntries.unshift(hookRuntimePath);
  }
  // Git for Windows' MSYS runtime reads the conventional uppercase spelling
  // when resolving a shebang through /usr/bin/env.
  env.PATH = existingEntries.join(path.delimiter);
  return env;
}

export function shouldStageGovernedGitHeadEvidenceBeforeCommit(stagedFiles: LegacyValue) {
  if (stagedFiles.length === 0) return false;
  if (hasAtmCriticalNonDocSurface(stagedFiles)) return true;
  return stagedFiles.some((filePath: LegacyValue) =>
    isGovernedLedgerBoundaryPathForGitCommit(filePath),
  );
}

export function isRuntimeCommitSideEffect(filePath: LegacyValue) {
  return normalizeRelativePath(filePath)
    .toLowerCase()
    .startsWith(".atm/runtime/");
}

export function isIgnorableTaskScopedDirtySideEffect(filePath: LegacyValue) {
  const lower = normalizeRelativePath(filePath).toLowerCase();
  if (lower.startsWith(".atm/runtime/snapshots/")) {
    return false;
  }
  if (isRuntimeCommitSideEffect(filePath)) {
    return true;
  }
  return /^\.atm\/_[^/]+\.json$/.test(lower);
}
