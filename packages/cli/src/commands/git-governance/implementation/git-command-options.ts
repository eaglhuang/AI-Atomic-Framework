
import path from "node:path";

import {
  CliError,
  makeResult,
  message,
  quoteCliValue,
  relativePathFrom,
} from "../../shared.ts";

import { splitCsvPaths } from './task-scope-staging.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;



export function parseGitOptions(argv: LegacyValue) {
  const options: LegacyValue = {
    cwd: process.cwd(),
    action: null,
    leaseKind: null,
    actorId: null,
    taskId: null,
    branch: null,
    remote: null,
    noFetch: false,
    gitName: null,
    gitEmail: null,
    sessionId: null,
    message: null,
    noVerify: false,
    wip: false,
    emergencyApproval: null,
    brokerConflictOverrideApproval: null,
    brokerConflictResolutionPath: null,
    overrideReason: null,
    checkTrailers: true,
    autoStage: false,
    deferForeignStaged: false,
    stageOverrideLease: null,
    dryRun: false,
    stewardPlan: false,
    applyToWorkingTree: false,
    extraTrailers: [],
    timeoutMs: null,
    paths: [],
    ttlSeconds: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") {
      options.cwd = requireValue(argv, index, "--cwd");
      index += 1;
      continue;
    }
    if (arg === "--actor") {
      options.actorId = requireValue(argv, index, "--actor");
      index += 1;
      continue;
    }
    if (arg === "--task") {
      options.taskId = requireValue(argv, index, "--task");
      index += 1;
      continue;
    }
    if (arg === "--branch") {
      options.branch = requireValue(argv, index, "--branch");
      index += 1;
      continue;
    }
    if (arg === "--remote") {
      options.remote = requireValue(argv, index, "--remote");
      index += 1;
      continue;
    }
    if (arg === "--no-fetch") {
      options.noFetch = true;
      continue;
    }
    if (arg === "--name") {
      options.gitName = requireValue(argv, index, "--name");
      index += 1;
      continue;
    }
    if (arg === "--email") {
      options.gitEmail = requireValue(argv, index, "--email");
      index += 1;
      continue;
    }
    if (arg === "--session") {
      options.sessionId = requireValue(argv, index, "--session");
      index += 1;
      continue;
    }
    if (arg === "--message") {
      options.message = requireValue(argv, index, "--message");
      index += 1;
      continue;
    }
    if (arg === "--trailer") {
      options.extraTrailers = [
        ...options.extraTrailers,
        requireValue(argv, index, "--trailer"),
      ];
      index += 1;
      continue;
    }
    if (arg === "--no-verify") {
      options.noVerify = true;
      continue;
    }
    if (arg === "--wip") {
      options.wip = true;
      continue;
    }
    if (arg === "--emergency-approval" || arg === "--lease") {
      options.emergencyApproval = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--broker-conflict-override") {
      options.brokerConflictOverrideApproval = requireValue(
        argv,
        index,
        "--broker-conflict-override",
      );
      index += 1;
      continue;
    }
    if (arg === "--broker-conflict-resolution") {
      options.brokerConflictResolutionPath = requireValue(
        argv,
        index,
        "--broker-conflict-resolution",
      );
      index += 1;
      continue;
    }
    if (arg === "--reason") {
      options.overrideReason = requireValue(argv, index, "--reason");
      index += 1;
      continue;
    }
    if (arg === "--paths") {
      options.paths = splitCsvPaths(requireValue(argv, index, "--paths"));
      index += 1;
      continue;
    }
    if (arg === "--ttl-seconds") {
      const rawTtl = requireValue(argv, index, "--ttl-seconds");
      const parsedTtl = Number(rawTtl);
      if (!Number.isFinite(parsedTtl) || parsedTtl <= 0) {
        throw new CliError(
          "ATM_CLI_USAGE",
          "--ttl-seconds requires a positive number.",
          { exitCode: 2 },
        );
      }
      options.ttlSeconds = parsedTtl;
      index += 1;
      continue;
    }
    if (arg === "--no-trailers") {
      options.checkTrailers = false;
      continue;
    }
    if (arg === "--auto-stage") {
      options.autoStage = true;
      continue;
    }
    if (arg === "--defer-foreign-staged") {
      options.deferForeignStaged = true;
      continue;
    }
    if (arg === "--stage-override-lease") {
      options.stageOverrideLease = requireValue(
        argv,
        index,
        "--stage-override-lease",
      );
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--steward-plan") {
      options.stewardPlan = true;
      continue;
    }
    if (arg === "--apply-to-working-tree") {
      options.applyToWorkingTree = true;
      continue;
    }
    if (arg === "--timeout-ms") {
      const rawTimeout = requireValue(argv, index, "--timeout-ms");
      const parsedTimeout = Number(rawTimeout);
      if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
        throw new CliError(
          "ATM_CLI_USAGE",
          "--timeout-ms requires a positive number of milliseconds.",
          { exitCode: 2 },
        );
      }
      options.timeoutMs = parsedTimeout;
      index += 1;
      continue;
    }
    if (arg === "--output-json") {
      requireValue(argv, index, "--output-json");
      index += 1;
      continue;
    }
    if (arg === "--json" || arg === "--pretty") {
      continue;
    }
    if (arg.startsWith("--")) {
      throw new CliError(
        "ATM_CLI_USAGE",
        `git does not support option ${arg}`,
        { exitCode: 2 },
      );
    }
    if (
      options.action === "lease" &&
      !options.leaseKind &&
      (arg === "stage-override" || arg === "destructive-override")
    ) {
      options.leaseKind = arg;
      continue;
    }
    if (options.action) {
      throw new CliError("ATM_CLI_USAGE", "git accepts only one action.", {
        exitCode: 2,
      });
    }
    if (
      arg !== "prepare" &&
      arg !== "admit" &&
      arg !== "push" &&
      arg !== "recover-push-fail" &&
      arg !== "check" &&
      arg !== "commit" &&
      arg !== "record-commit" &&
      arg !== "commit-status" &&
      arg !== "lease"
    ) {
      throw new CliError(
        "ATM_CLI_USAGE",
        "git supports: prepare, admit, push, recover-push-fail, check, commit, record-commit, commit-status, lease",
        { exitCode: 2 },
      );
    }
    options.action = arg;
  }
  if (!options.action) {
    throw new CliError(
      "ATM_CLI_USAGE",
      "git requires an action (prepare | admit | push | recover-push-fail | check | commit | record-commit | commit-status | lease).",
      { exitCode: 2 },
    );
  }
  if (options.action === "lease" && !options.leaseKind) {
    throw new CliError(
      "ATM_CLI_USAGE",
      "git lease requires stage-override or destructive-override.",
      { exitCode: 2 },
    );
  }
  return { ...options, action: options.action, cwd: path.resolve(options.cwd) };
}

export function requireValue(argv: LegacyValue, index: LegacyValue, flag: LegacyValue) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CliError("ATM_CLI_USAGE", `git requires a value for ${flag}`, {
      exitCode: 2,
    });
  }
  return value;
}
