import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { actorRegistryRelativePath, inspectTrackedActorRegistryState, } from "../../actor-registry.js";
import { hasAtmCriticalNonDocSurface } from "../../framework-development/path-classification.js";
import { normalizeRelativePath, } from "../commit-scope-policy.js";
import { CliError, } from "../../shared.js";
import { isGovernedLedgerBoundaryPathForGitCommit } from './git-head-evidence-transaction.js';
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
export function resolveGitCommitTimeoutMs(explicitTimeoutMs) {
    if (explicitTimeoutMs !== null &&
        Number.isFinite(explicitTimeoutMs) &&
        explicitTimeoutMs > 0) {
        return explicitTimeoutMs;
    }
    const envValue = Number(process.env.ATM_GIT_COMMIT_TIMEOUT_MS);
    if (Number.isFinite(envValue) && envValue > 0) {
        return envValue;
    }
    return DEFAULT_GIT_COMMIT_TIMEOUT_MS;
}
export function gitCommitAttemptStatusRelativePath(actorId, taskId) {
    const safeActor = actorId.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const safeTask = (taskId ?? "no-task").replace(/[^a-zA-Z0-9_.-]/g, "_");
    return `.atm/runtime/git-commit-attempts/${safeActor}__${safeTask}.json`;
}
export function writeGitCommitAttemptStatus(cwd, statusRelativePath, status) {
    try {
        const absolutePath = path.join(cwd, statusRelativePath);
        mkdirSync(path.dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
    }
    catch { }
}
export function readGitCommitAttemptStatus(cwd, actorId, taskId) {
    const absolutePath = path.join(cwd, gitCommitAttemptStatusRelativePath(actorId, taskId));
    if (!existsSync(absolutePath))
        return null;
    try {
        return JSON.parse(readFileSync(absolutePath, "utf8"));
    }
    catch {
        return null;
    }
}
export function runGitCommand(cwd, args, stdio = ["ignore", "pipe", "ignore"]) {
    return execFileSync(resolveGitExecutable(), args, {
        cwd,
        encoding: "utf8",
        stdio,
        env: createSanitizedGitEnv(),
    });
}
export function runGitCommandWithEnv(cwd, args, env, stdio = ["ignore", "pipe", "ignore"]) {
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
            if (!Array.isArray(parsed))
                return [];
            return parsed
                .map((entry) => {
                if (!entry || typeof entry !== "object")
                    return null;
                const record = entry;
                const commandLine = typeof record.commandLine === "string" ? record.commandLine : "";
                return {
                    pid: typeof record.pid === "number" ? record.pid : null,
                    commandLine,
                };
            })
                .filter((entry) => Boolean(entry?.commandLine))
                .filter(isStdinPathspecGitAddProcess);
        }
        catch {
            return [];
        }
    }
    try {
        if (process.platform === "win32") {
            const raw = execFileSync("powershell.exe", [
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name = 'git.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
            ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
            if (!raw)
                return [];
            const parsed = JSON.parse(raw);
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            return rows
                .map((entry) => {
                if (!entry || typeof entry !== "object")
                    return null;
                const record = entry;
                return {
                    pid: typeof record.ProcessId === "number" ? record.ProcessId : null,
                    commandLine: typeof record.CommandLine === "string" ? record.CommandLine : "",
                };
            })
                .filter((entry) => Boolean(entry?.commandLine))
                .filter(isStdinPathspecGitAddProcess);
        }
        const raw = execFileSync("ps", ["-eo", "pid=,args="], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return raw
            .split(/\r?\n/)
            .map((line) => {
            const match = line.trim().match(/^(\d+)\s+(.+)$/);
            if (!match)
                return null;
            return { pid: Number(match[1]), commandLine: match[2] ?? "" };
        })
            .filter((entry) => Boolean(entry?.commandLine))
            .filter(isStdinPathspecGitAddProcess);
    }
    catch {
        return [];
    }
}
export function isStdinPathspecGitAddProcess(processInfo) {
    const commandLine = processInfo.commandLine.toLowerCase();
    return (/\bgit(?:\.exe)?["']?\s/.test(commandLine) &&
        commandLine.includes(" add ") &&
        commandLine.includes("--pathspec-from-file=-") &&
        commandLine.includes("--pathspec-file-nul"));
}
export function assertNoStdinPathspecGitAddPreflight(cwd) {
    const processes = inspectStdinPathspecGitAddProcesses();
    if (processes.length === 0)
        return;
    throw new CliError("ATM_GIT_COMMIT_STDIN_PATHSPEC_ADD_ACTIVE", "ATM detected an active git add --pathspec-from-file=- process before commit. This usually means an editor staging helper is waiting on stdin and can make the commit appear hung.", {
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
    });
}
export function stageTrackedActorRegistryIfNeeded(cwd) {
    const actorRegistryState = inspectTrackedActorRegistryState(cwd);
    if (!actorRegistryState.tracked || !actorRegistryState.unstaged) {
        return null;
    }
    runGitCommand(cwd, ["add", "--", actorRegistryRelativePath], ["ignore", "pipe", "pipe"]);
    return actorRegistryRelativePath;
}
export function listCommitAttributionSideEffectPaths(cwd) {
    const actorRegistryState = inspectTrackedActorRegistryState(cwd);
    if (!actorRegistryState.tracked) {
        return [];
    }
    if (!actorRegistryState.staged && !actorRegistryState.unstaged) {
        return [];
    }
    return [normalizeRelativePath(actorRegistryState.path)];
}
export function isCommitAttributionSideEffectPath(filePath) {
    return (normalizeRelativePath(filePath).toLowerCase() ===
        actorRegistryRelativePath.toLowerCase());
}
export function createSanitizedGitEnv(extra = {}) {
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
    return env;
}
export function shouldStageGovernedGitHeadEvidenceBeforeCommit(stagedFiles) {
    if (stagedFiles.length === 0)
        return false;
    if (hasAtmCriticalNonDocSurface(stagedFiles))
        return true;
    return stagedFiles.some((filePath) => isGovernedLedgerBoundaryPathForGitCommit(filePath));
}
export function isRuntimeCommitSideEffect(filePath) {
    return normalizeRelativePath(filePath)
        .toLowerCase()
        .startsWith(".atm/runtime/");
}
export function isIgnorableTaskScopedDirtySideEffect(filePath) {
    const lower = normalizeRelativePath(filePath).toLowerCase();
    if (lower.startsWith(".atm/runtime/snapshots/")) {
        return false;
    }
    if (isRuntimeCommitSideEffect(filePath)) {
        return true;
    }
    return /^\.atm\/_[^/]+\.json$/.test(lower);
}
