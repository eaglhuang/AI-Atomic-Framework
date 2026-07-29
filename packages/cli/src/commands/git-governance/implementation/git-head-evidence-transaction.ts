
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

import os from "node:os";

import path from "node:path";

import {
  gitHeadEvidencePath,
  gitHeadEvidencePaths,
} from "../../git-head-evidence.ts";

import {
  clearIncidentFlags,
  detectCrossTaskMutation,
  readIncidentFlag,
  recordIncidentFlag,
} from "../../../../../core/src/broker/cross-task-mutation-guard.ts";

import {
  extractGovernanceTaskIdFromPath,
  inspectTouchedPhysicalLineBudget,
  isProtectedStagedGovernanceOwnershipPath,
  normalizeRelativePath,
  normalizeTaskClaimIntent,
  pathMatchesTaskScope,
  uniqueSorted,
} from "../commit-scope-policy.ts";

import { readStagedFiles } from './git-index-transaction.ts';

import { runGitCommand, runGitCommandWithEnv, shouldStageGovernedGitHeadEvidenceBeforeCommit } from './git-process-port.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;



export function isGovernedLedgerBoundaryPathForGitCommit(filePath: LegacyValue) {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  if (
    normalized === gitHeadEvidencePaths.legacyJson ||
    normalized === gitHeadEvidencePaths.jsonl
  ) {
    return false;
  }
  return (
    normalized.startsWith(".atm/history/tasks/") ||
    normalized.startsWith(".atm/history/task-events/") ||
    /^\.atm\/history\/evidence\/[^/]+\.(?:closure-packet|bundle-manifest)\.json$/.test(
      normalized,
    )
  );
}

export function ensureGovernedGitHeadEvidenceStagedForCommit(cwd: LegacyValue, actorId: LegacyValue) {
  const treeSha = readIndexTreeWithoutEvidence(cwd);
  if (!treeSha) return null;
  const parentCommitShas = readCurrentHeadParentCommitShas(cwd);
  const generatedAt = new Date().toISOString();
  const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
  mkdirSync(path.dirname(evidenceAbsolute), { recursive: true });
  if (!hasMatchingWorktreeGitHeadEvidence(cwd, treeSha, parentCommitShas)) {
    const payload = {
      schemaVersion: "atm.gitHeadEvidence.v0.1",
      evidence: [
        {
          evidenceKind: "validation",
          evidenceType: "commit",
          summary:
            "Governed git commit wrapper prepared git-head evidence for the staged commit tree.",
          artifactPaths: [],
          createdAt: generatedAt,
          producedBy: actorId,
          evidenceFreshness: "fresh",
          commandRuns: [],
          details: {
            actorId,
            kind: "commit",
            freshness: "fresh",
            git: {
              treeSha,
              parentCommitShas,
              stagedPathCount: readStagedFiles(cwd).length,
              evidencePath: gitHeadEvidencePath,
              generatedAt,
            },
            preparedBy: { mode: "governed-git-commit-wrapper" },
          },
        },
      ],
    };
    appendGitHeadEvidenceJsonl(evidenceAbsolute, payload);
  }
  runGitCommand(
    cwd,
    ["add", "--", gitHeadEvidencePath],
    ["ignore", "pipe", "pipe"],
  );
  return { evidencePath: gitHeadEvidencePath, treeSha, parentCommitShas };
}

export function ensureGovernedGitHeadEvidenceStagedForTaskScopedCommit(
  cwd: LegacyValue,
  actorId: LegacyValue,
  commitFiles: LegacyValue,
  env: LegacyValue,
) {
  if (!shouldStageGovernedGitHeadEvidenceBeforeCommit(commitFiles)) {
    return null;
  }
  const treeSha = readIndexTreeWithoutEvidence(cwd, env);
  if (!treeSha) return null;
  const parentCommitShas = readCurrentHeadParentCommitShas(cwd);
  const generatedAt = new Date().toISOString();
  const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
  mkdirSync(path.dirname(evidenceAbsolute), { recursive: true });
  if (!hasMatchingWorktreeGitHeadEvidence(cwd, treeSha, parentCommitShas)) {
    const payload = {
      schemaVersion: "atm.gitHeadEvidence.v0.1",
      evidence: [
        {
          evidenceKind: "validation",
          evidenceType: "commit",
          summary:
            "Governed git commit wrapper prepared git-head evidence for the staged task-scoped commit tree.",
          artifactPaths: [],
          createdAt: generatedAt,
          producedBy: actorId,
          evidenceFreshness: "fresh",
          commandRuns: [],
          details: {
            actorId,
            kind: "commit",
            freshness: "fresh",
            git: {
              treeSha,
              parentCommitShas,
              stagedPathCount: commitFiles.length,
              evidencePath: gitHeadEvidencePath,
              generatedAt,
            },
            preparedBy: {
              mode: "governed-git-commit-wrapper",
              scope: "task-scoped",
            },
          },
        },
      ],
    };
    appendGitHeadEvidenceJsonl(evidenceAbsolute, payload);
  }
  runGitCommand(
    cwd,
    ["add", "--", gitHeadEvidencePath],
    ["ignore", "pipe", "pipe"],
  );
  runGitCommandWithEnv(cwd, ["add", "--", gitHeadEvidencePath], env, [
    "ignore",
    "pipe",
    "pipe",
  ]);
  return { evidencePath: gitHeadEvidencePath, treeSha, parentCommitShas };
}

export function appendGitHeadEvidenceJsonl(evidenceAbsolute: LegacyValue, payload: LegacyValue) {
  const nextLine = `${JSON.stringify(payload)}\n`;
  const existingText = existsSync(evidenceAbsolute)
    ? readFileSync(evidenceAbsolute, "utf8")
    : "";
  writeFileSync(evidenceAbsolute, `${existingText}${nextLine}`, "utf8");
}

export function captureGitHeadEvidencePreparation(cwd: LegacyValue) {
  const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
  const existed = existsSync(evidenceAbsolute);
  return {
    evidenceAbsolute,
    existed,
    content: existed ? readFileSync(evidenceAbsolute, "utf8") : null,
  };
}

export function rollbackFailedGitHeadEvidencePreparation(snapshot: LegacyValue) {
  const currentContent = existsSync(snapshot.evidenceAbsolute)
    ? readFileSync(snapshot.evidenceAbsolute, "utf8")
    : null;
  if (snapshot.existed) {
    if (currentContent === snapshot.content) return false;
    writeFileSync(snapshot.evidenceAbsolute, snapshot.content ?? "", "utf8");
    return true;
  }
  if (currentContent === null) return false;
  rmSync(snapshot.evidenceAbsolute, { force: true });
  return true;
}

export function reconcileResolvedCrossTaskMutationIncident(cwd: LegacyValue, taskId: LegacyValue) {
  if (detectCrossTaskMutation(cwd, taskId, "git check")) return false;
  if (!readIncidentFlag(cwd)) return false;
  clearIncidentFlags(cwd);
  return true;
}

export function hasMatchingWorktreeGitHeadEvidence(cwd: LegacyValue, treeSha: LegacyValue, parentCommitShas: LegacyValue) {
  const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
  if (!existsSync(evidenceAbsolute)) return false;
  const lines = readFileSync(evidenceAbsolute, "utf8")
    .split(/\r?\n/)
    .map((line: LegacyValue) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      for (const record of Array.isArray(parsed.evidence)
        ? parsed.evidence
        : []) {
        const git = record?.details?.git;
        const candidateTreeSha =
          typeof git?.treeSha === "string" ? git.treeSha.trim() : null;
        const candidateParents = Array.isArray(git?.parentCommitShas)
          ? git.parentCommitShas
              .map((entry: LegacyValue) => (typeof entry === "string" ? entry.trim() : ""))
              .filter(Boolean)
          : [];
        if (
          candidateTreeSha === treeSha &&
          sameStringSet(candidateParents, parentCommitShas)
        ) {
          return true;
        }
      }
    } catch {}
  }
  return false;
}

export function sameStringSet(left: LegacyValue, right: LegacyValue) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((entry: LegacyValue, index: LegacyValue) => entry === rightSorted[index]);
}

export function readCurrentHeadParentCommitShas(cwd: LegacyValue) {
  try {
    const parentCommitShas = [];
    const headSha = runGitCommand(cwd, [
      "rev-parse",
      "--verify",
      "HEAD",
    ]).trim();
    if (headSha) {
      parentCommitShas.push(headSha);
    }
    const mergeHeadPath = runGitCommand(cwd, [
      "rev-parse",
      "--git-path",
      "MERGE_HEAD",
    ]).trim();
    if (mergeHeadPath) {
      const mergeHeadAbsolute = path.resolve(cwd, mergeHeadPath);
      if (existsSync(mergeHeadAbsolute)) {
        const mergeHeadShas = readFileSync(mergeHeadAbsolute, "utf8")
          .split(/\r?\n/)
          .map((entry: LegacyValue) => entry.trim())
          .filter(Boolean);
        for (const mergeHeadSha of mergeHeadShas) {
          if (!parentCommitShas.includes(mergeHeadSha)) {
            parentCommitShas.push(mergeHeadSha);
          }
        }
      }
    }
    return parentCommitShas;
  } catch {
    return [];
  }
}

export function readIndexTreeWithoutEvidence(cwd: LegacyValue, env: LegacyValue = process.env) {
  const tempDir = mkdtempSync(
    path.join(os.tmpdir(), "atm-governed-commit-index-"),
  );
  const tempIndex = path.join(tempDir, "index");
  try {
    if (env?.GIT_INDEX_FILE) {
      const absoluteIndex = path.resolve(env.GIT_INDEX_FILE);
      if (existsSync(absoluteIndex)) {
        writeFileSync(tempIndex, readFileSync(absoluteIndex));
      }
    } else {
      const gitIndexPath = runGitCommand(cwd, [
        "rev-parse",
        "--git-path",
        "index",
      ]).trim();
      if (gitIndexPath) {
        const absoluteIndex = path.resolve(cwd, gitIndexPath);
        if (existsSync(absoluteIndex)) {
          writeFileSync(tempIndex, readFileSync(absoluteIndex));
        }
      }
    }
    runGitCommandWithEnv(
      cwd,
      [
        "rm",
        "--cached",
        "--quiet",
        "--ignore-unmatch",
        "--force",
        "--",
        gitHeadEvidencePaths.legacyJson,
        gitHeadEvidencePaths.jsonl,
      ],
      { GIT_INDEX_FILE: tempIndex },
      ["ignore", "pipe", "pipe"],
    );
    return (
      runGitCommandWithEnv(cwd, ["write-tree"], { GIT_INDEX_FILE: tempIndex }, [
        "ignore",
        "pipe",
        "pipe",
      ]).trim() || null
    );
  } catch {
    return null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
