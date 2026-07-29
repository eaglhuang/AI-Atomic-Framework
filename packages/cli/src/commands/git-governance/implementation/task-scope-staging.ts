import {
  isAllowedGovernanceArtifactPath,
  isFileAllowedInTaskBundle,
  listTaskOwnedProtectedOverrideAuditFiles,
  readProtectedOverrideAuditTaskId,
  readStagedFiles,
  readStagedJsonFile,
} from './git-index-transaction.ts';
import {
  isCommitAttributionSideEffectPath,
  isIgnorableTaskScopedDirtySideEffect,
  listCommitAttributionSideEffectPaths,
  resolveGitExecutable,
  runGitCommand,
} from './git-process-port.ts';

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
  gitHeadEvidencePath,
  gitHeadEvidencePaths,
} from "../../git-head-evidence.ts";

import {
  getCanonicalAllowedFilesForTask,
  sanitizeTaskDirectionAllowedFiles,
} from "../../task-direction.ts";

import { extractTaskDeclaredFiles } from "../../tasks/task-import-validators.ts";

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

import { parseTaskClaim } from './identity-check-command.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;



export function inspectTaskScopedStagedGovernanceBundle(cwd: LegacyValue, taskId: LegacyValue, taskDocument: LegacyValue) {
  const stagedFiles = readStagedFiles(cwd);
  const claim = parseTaskClaim(taskDocument.claim);
  const warnings = [];
  const mismatchedTaskIds = [];
  if (claim?.state === "active") {
    for (const filePath of stagedFiles) {
      if (isIgnorableCommitStagingSideEffect(cwd, filePath, taskId)) continue;
      if (!isAllowedGovernanceArtifactPath(cwd, filePath, taskId)) continue;
      const stagedTaskId = extractGovernanceTaskIdFromPath(filePath);
      if (stagedTaskId && stagedTaskId !== taskId.toUpperCase()) {
        mismatchedTaskIds.push(filePath);
      }
      const json = readStagedJsonFile(cwd, filePath);
      if (json && typeof json.taskId === "string" && json.taskId !== taskId) {
        mismatchedTaskIds.push(filePath);
      }
      if (
        json &&
        typeof json.workItemId === "string" &&
        json.workItemId !== taskId
      ) {
        mismatchedTaskIds.push(filePath);
      }
    }
    const declaredScope = resolveTaskDeclaredScope(cwd, taskId, taskDocument);
    const outOfScopeStaged = stagedFiles.filter(
      (filePath: LegacyValue) =>
        !isIgnorableCommitStagingSideEffect(cwd, filePath, taskId) &&
        !isFileAllowedInTaskBundle(cwd, filePath, taskId, declaredScope),
    );
    if (outOfScopeStaged.length > 0) {
      warnings.push(
        `Pre-commit warning: staged files outside allowedFiles for ${taskId}: ${outOfScopeStaged.join(", ")}`,
      );
    }
    if (mismatchedTaskIds.length > 0) {
      return {
        ok: false,
        code: "ATM_GIT_COMMIT_GOVERNANCE_BUNDLE_TASK_MISMATCH",
        summary: `git commit for ${taskId} found staged governance artifacts whose task ids do not match the active claim.`,
        warnings,
        details: { mismatchedTaskIds: uniqueSorted(mismatchedTaskIds) },
      };
    }
  }
  return {
    ok: true,
    code: "ATM_GIT_COMMIT_GOVERNANCE_BUNDLE_OK",
    summary: `Staged governance bundle for ${taskId} passed task-id consistency checks.`,
    warnings,
    details: {},
  };
}

export function inspectTaskScopedUnstagedCommit(cwd: LegacyValue, taskId: LegacyValue, taskDocument: LegacyValue) {
  const stagedFiles = readStagedFiles(cwd);
  const declaredScope = resolveTaskDeclaredScope(cwd, taskId, taskDocument);
  const dirtyFiles = listTaskScopedWorktreeDirtyFiles(cwd).filter(
    (filePath: LegacyValue) => !isIgnorableTaskScopedDirtySideEffect(filePath),
  );
  if (dirtyFiles.length === 0 && stagedFiles.length === 0) {
    return null;
  }
  const deliverableDirtyFiles = dirtyFiles.filter((filePath: LegacyValue) =>
    declaredScope.some((scope: LegacyValue) => pathMatchesTaskScope(filePath, scope)),
  );
  const skippedExternalDirtyFiles = dirtyFiles.filter(
    (filePath: LegacyValue) =>
      !declaredScope.some((scope: LegacyValue) => pathMatchesTaskScope(filePath, scope)) &&
      !isIgnorableCommitStagingSideEffect(cwd, filePath, taskId),
  );
  const outOfScopeStagedFiles = stagedFiles.filter(
    (filePath: LegacyValue) =>
      !isIgnorableCommitStagingSideEffect(cwd, filePath, taskId) &&
      !isFileAllowedInTaskBundle(cwd, filePath, taskId, declaredScope),
  );
  const unstagedInScopeDirty = deliverableDirtyFiles.filter(
    (filePath: LegacyValue) => !stagedFiles.includes(filePath),
  );
  const unstagedDeliverableDirty = unstagedInScopeDirty.filter(
    (filePath: LegacyValue) =>
      !isAllowedGovernanceArtifactPath(cwd, filePath, taskId) &&
      !isCommitAttributionSideEffectPath(filePath),
  );
  if (outOfScopeStagedFiles.length > 0 && unstagedDeliverableDirty.length > 0) {
    return {
      kind: "mixed-scope",
      inScopeDirtyFiles: uniqueSorted(unstagedDeliverableDirty),
      outOfScopeStagedFiles: uniqueSorted(outOfScopeStagedFiles),
    };
  }
  if (stagedFiles.length > 0) {
    return null;
  }
  if (deliverableDirtyFiles.length === 0) {
    return null;
  }
  return {
    kind: "staging-required",
    inScopeDirtyFiles: uniqueSorted(deliverableDirtyFiles),
    skippedExternalDirtyFiles: uniqueSorted(skippedExternalDirtyFiles),
    requiredCommand: buildTaskScopedStagingRequiredCommand(
      cwd,
      deliverableDirtyFiles,
    ),
  };
}

export function isIgnorableCommitStagingSideEffect(cwd: LegacyValue, filePath: LegacyValue, taskId: LegacyValue) {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  const normalizedTaskId = taskId.toLowerCase();
  if (normalized.startsWith(".atm/runtime/")) {
    return true;
  }
  if (
    normalized === gitHeadEvidencePaths.legacyJson ||
    normalized === gitHeadEvidencePaths.jsonl
  ) {
    return true;
  }
  if (normalized === `.atm/history/tasks/${normalizedTaskId}.json`) {
    return true;
  }
  if (normalized.startsWith(`.atm/history/task-events/${normalizedTaskId}/`)) {
    return true;
  }
  if (
    isTaskOwnedProtectedOverrideAuditPath(cwd, normalized, normalizedTaskId)
  ) {
    return true;
  }
  return false;
}

export function isTaskOwnedProtectedOverrideAuditPath(
  cwd: LegacyValue,
  filePath: LegacyValue,
  normalizedTaskId: LegacyValue,
) {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  if (
    !normalized.startsWith(".atm/history/protected-override-audit/") ||
    !normalized.endsWith(".json")
  ) {
    return false;
  }
  return (
    readProtectedOverrideAuditTaskId(cwd, normalized)?.toLowerCase() ===
    normalizedTaskId
  );
}

export function cleanupAutoGeneratedResidue(cwd: LegacyValue, findings: LegacyValue) {
  const cleaned = [];
  for (const finding of findings) {
    if (finding.cleanupAction === "restore") {
      try {
        runGitCommand(
          cwd,
          [
            "restore",
            "--staged",
            "--worktree",
            "--source=HEAD",
            "--",
            finding.path,
          ],
          ["ignore", "pipe", "pipe"],
        );
      } catch {
        try {
          runGitCommand(
            cwd,
            [
              "rm",
              "--cached",
              "--quiet",
              "--ignore-unmatch",
              "--",
              finding.path,
            ],
            ["ignore", "pipe", "pipe"],
          );
        } catch {}
        try {
          rmSync(path.join(cwd, finding.path), { force: true });
        } catch {}
      }
      cleaned.push(finding);
      continue;
    }
    if (finding.cleanupAction === "remove") {
      try {
        const absolutePath = path.join(cwd, finding.path);
        const stats = statSync(absolutePath);
        if (stats.isDirectory()) {
          rmSync(absolutePath, { recursive: true, force: true });
        } else {
          rmSync(absolutePath, { force: true });
        }
      } catch {}
      cleaned.push(finding);
    }
  }
  return cleaned;
}

export function resolveTaskDeclaredScope(cwd: LegacyValue, taskId: LegacyValue, taskDocument: LegacyValue) {
  const taskDirectionLock =
    taskDocument.taskDirectionLock &&
    typeof taskDocument.taskDirectionLock === "object" &&
    !Array.isArray(taskDocument.taskDirectionLock)
      ? taskDocument.taskDirectionLock
      : {};
  const claim =
    taskDocument.claim &&
    typeof taskDocument.claim === "object" &&
    !Array.isArray(taskDocument.claim)
      ? taskDocument.claim
      : {};
  const lockAllowedFiles = getCanonicalAllowedFilesForTask(cwd, taskId) ?? [];
  return sanitizeTaskDirectionAllowedFiles(
    uniqueSorted([
      ...lockAllowedFiles,
      ...extractStringList(taskDirectionLock.allowedFiles),
      ...extractStringList(claim.files),
      ...extractStringList(taskDocument.targetAllowedFiles),
      ...extractTaskDeclaredFiles(taskDocument),
      ...listCommitAttributionSideEffectPaths(cwd),
      ...listTaskOwnedProtectedOverrideAuditFiles(cwd, taskId),
    ]),
  );
}

export function frameworkTempTaskId(actorId: LegacyValue) {
  const normalized = actorId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `ATM-FRAMEWORK-TEMP-${normalized || "actor"}`;
}

export function readActiveFrameworkClaimFiles(cwd: LegacyValue, actorId: LegacyValue) {
  const lockPath = path.join(
    cwd,
    ".atm",
    "runtime",
    "locks",
    `${frameworkTempTaskId(actorId)}.lock.json`,
  );
  if (!existsSync(lockPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8"));
    return extractStringList(parsed.files).map(normalizeRelativePath);
  } catch {
    return [];
  }
}

export function readReleaseGeneratedArtifactPaths(cwd: LegacyValue) {
  const generated = new Set();
  for (const manifestPath of [
    path.join(cwd, "release", "atm-root-drop", "release-manifest.json"),
    path.join(cwd, "release", "atm-onefile", "release-manifest.json"),
  ]) {
    if (!existsSync(manifestPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
      for (const entry of extractStringList(parsed.generatedFiles)) {
        generated.add(normalizeRelativePath(entry));
      }
    } catch {}
  }
  return generated;
}

export function isFrameworkGeneratedArtifactAllowed(
  filePath: LegacyValue,
  claimedFiles: LegacyValue,
  releaseGeneratedArtifacts: LegacyValue,
) {
  const normalized = normalizeRelativePath(filePath);
  const claimedScopes = [...claimedFiles];
  if (claimedScopes.some((scope: LegacyValue) => pathMatchesTaskScope(normalized, scope))) {
    return true;
  }
  for (const claimedFile of claimedScopes) {
    if (
      pathMatchesTaskScope(normalized, `release/atm-root-drop/${claimedFile}`)
    ) {
      return true;
    }
    if (
      pathMatchesTaskScope(normalized, `release/atm-onefile/${claimedFile}`)
    ) {
      return true;
    }
  }
  void releaseGeneratedArtifacts;
  return false;
}

export function isIgnorableFrameworkCommitStagingSideEffect(filePath: LegacyValue) {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  if (
    normalized === gitHeadEvidencePaths.legacyJson ||
    normalized === gitHeadEvidencePaths.jsonl
  ) {
    return true;
  }
  return isIgnorableTaskScopedDirtySideEffect(filePath);
}

export function autoStageFrameworkClaimFiles(cwd: LegacyValue, actorId: LegacyValue, apply: LegacyValue = true) {
  const claimedFiles = new Set(readActiveFrameworkClaimFiles(cwd, actorId));
  if (claimedFiles.size === 0) {
    return [];
  }
  const stagedFiles = new Set(readStagedFiles(cwd));
  const releaseGeneratedArtifacts = readReleaseGeneratedArtifactPaths(cwd);
  const candidates = uniqueSorted(
    listTaskScopedWorktreeDirtyFiles(cwd).filter(
      (filePath: LegacyValue) =>
        !stagedFiles.has(filePath) &&
        !isIgnorableFrameworkCommitStagingSideEffect(filePath) &&
        isFrameworkGeneratedArtifactAllowed(
          filePath,
          claimedFiles,
          releaseGeneratedArtifacts,
        ),
    ),
  );
  if (apply && candidates.length > 0) {
    runGitCommand(
      cwd,
      ["add", "-A", "-f", "--", ...candidates],
      ["ignore", "pipe", "pipe"],
    );
  }
  return candidates;
}

export function inspectFrameworkScopedUnstagedCommit(cwd: LegacyValue, actorId: LegacyValue) {
  const claimedFiles = new Set(readActiveFrameworkClaimFiles(cwd, actorId));
  if (claimedFiles.size === 0) {
    return null;
  }
  const releaseGeneratedArtifacts = readReleaseGeneratedArtifactPaths(cwd);
  const stagedFiles = readStagedFiles(cwd);
  const dirtyFiles = listTaskScopedWorktreeDirtyFiles(cwd).filter(
    (filePath: LegacyValue) => !isIgnorableTaskScopedDirtySideEffect(filePath),
  );
  if (dirtyFiles.length === 0 && stagedFiles.length === 0) {
    return null;
  }
  const inScopeDirtyFiles = uniqueSorted(
    dirtyFiles.filter((filePath: LegacyValue) =>
      isFrameworkGeneratedArtifactAllowed(
        filePath,
        claimedFiles,
        releaseGeneratedArtifacts,
      ),
    ),
  );
  const unstagedInScopeDirtyFiles = inScopeDirtyFiles.filter(
    (filePath: LegacyValue) => !stagedFiles.includes(filePath),
  );
  const outOfScopeStagedFiles = stagedFiles.filter(
    (filePath: LegacyValue) =>
      !isIgnorableFrameworkCommitStagingSideEffect(filePath) &&
      !isFrameworkGeneratedArtifactAllowed(
        filePath,
        claimedFiles,
        releaseGeneratedArtifacts,
      ),
  );
  if (unstagedInScopeDirtyFiles.length === 0) {
    if (outOfScopeStagedFiles.length > 0) {
      return {
        kind: "mixed-scope",
        inScopeDirtyFiles: [],
        outOfScopeStagedFiles: uniqueSorted(outOfScopeStagedFiles),
      };
    }
    return null;
  }
  if (outOfScopeStagedFiles.length > 0) {
    return {
      kind: "mixed-scope",
      inScopeDirtyFiles: uniqueSorted(unstagedInScopeDirtyFiles),
      outOfScopeStagedFiles: uniqueSorted(outOfScopeStagedFiles),
    };
  }
  const skippedExternalDirtyFiles = uniqueSorted(
    dirtyFiles.filter(
      (filePath: LegacyValue) =>
        !isFrameworkGeneratedArtifactAllowed(
          filePath,
          claimedFiles,
          releaseGeneratedArtifacts,
        ),
    ),
  );
  return {
    kind: "staging-required",
    inScopeDirtyFiles: uniqueSorted(inScopeDirtyFiles),
    skippedExternalDirtyFiles,
    requiredCommand: buildTaskScopedStagingRequiredCommand(
      cwd,
      inScopeDirtyFiles,
    ),
  };
}

export function listTaskScopedWorktreeDirtyFiles(cwd: LegacyValue) {
  const files = new Set<string>();
  for (const filePath of readGitNameOnly(cwd, ["diff", "--name-only"])) {
    files.add(filePath);
  }
  for (const filePath of readGitNameOnly(cwd, [
    "ls-files",
    "-o",
    "--exclude-standard",
  ])) {
    files.add(filePath);
  }
  return uniqueSorted([...files]);
}

export function buildTaskScopedStagingRequiredCommand(cwd: LegacyValue, files: LegacyValue) {
  const normalizedFiles = uniqueSorted(
    files.map(normalizeRelativePath).filter(Boolean),
  );
  const cwdFlag =
    path.resolve(cwd) === path.resolve(process.cwd())
      ? ""
      : ` -C ${quoteCliValue(cwd)}`;
  return `${quoteCliValue(resolveGitExecutable())}${cwdFlag} add -- ${normalizedFiles.map(quoteCliValue).join(" ")}`;
}

export function readGitNameOnly(cwd: LegacyValue, args: LegacyValue) {
  try {
    return runGitCommand(cwd, args)
      .split(/\r?\n/)
      .map(normalizeRelativePath)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function extractStringList(value: LegacyValue) {
  return Array.isArray(value)
    ? value
        .map((entry: LegacyValue) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];
}

export function splitCsvPaths(value: LegacyValue) {
  return [
    ...uniqueSorted(
      value
        .split(",")
        .map((entry: LegacyValue) =>
          entry.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, ""),
        )
        .filter(Boolean),
    ),
  ];
}

export function taskImportReportReferencesTask(cwd: LegacyValue, file: LegacyValue, taskId: LegacyValue) {
  try {
    const content = readFileSync(path.join(cwd, file), "utf8");
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed).includes(`"${taskId}"`);
  } catch {
    return false;
  }
}
