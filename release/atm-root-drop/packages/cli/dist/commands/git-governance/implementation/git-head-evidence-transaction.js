import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { gitHeadEvidencePath, gitHeadEvidencePaths, } from "../../git-head-evidence.js";
import { clearIncidentFlags, detectCrossTaskMutation, readIncidentFlag, } from "../../../_vendor/core/dist/broker/cross-task-mutation-guard.js";
import { normalizeRelativePath, } from "../commit-scope-policy.js";
import { readStagedFiles } from './git-index-transaction.js';
import { runGitCommand, runGitCommandWithEnv, shouldStageGovernedGitHeadEvidenceBeforeCommit } from './git-process-port.js';
export function isGovernedLedgerBoundaryPathForGitCommit(filePath) {
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    if (normalized === gitHeadEvidencePaths.legacyJson ||
        normalized === gitHeadEvidencePaths.jsonl) {
        return false;
    }
    return (normalized.startsWith(".atm/history/tasks/") ||
        normalized.startsWith(".atm/history/task-events/") ||
        /^\.atm\/history\/evidence\/[^/]+\.(?:closure-packet|bundle-manifest)\.json$/.test(normalized));
}
export function ensureGovernedGitHeadEvidenceStagedForCommit(cwd, actorId) {
    const treeSha = readIndexTreeWithoutEvidence(cwd);
    if (!treeSha)
        return null;
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
                    summary: "Governed git commit wrapper prepared git-head evidence for the staged commit tree.",
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
    runGitCommand(cwd, ["add", "--", gitHeadEvidencePath], ["ignore", "pipe", "pipe"]);
    return { evidencePath: gitHeadEvidencePath, treeSha, parentCommitShas };
}
export function ensureGovernedGitHeadEvidenceStagedForTaskScopedCommit(cwd, actorId, taskId, commitFiles, env) {
    if (!shouldStageGovernedGitHeadEvidenceBeforeCommit(commitFiles)) {
        return null;
    }
    const treeSha = readIndexTreeWithoutEvidence(cwd, env);
    if (!treeSha)
        return null;
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
                    summary: "Governed git commit wrapper prepared git-head evidence for the staged task-scoped commit tree.",
                    artifactPaths: [],
                    createdAt: generatedAt,
                    producedBy: actorId,
                    evidenceFreshness: "fresh",
                    commandRuns: [],
                    details: {
                        actorId,
                        taskId,
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
    // The caller owns a sealed candidate index. Staging evidence into the live
    // index as well would create an unrelated shared-index write and can race
    // with a foreign lane without contributing to the committed tree.
    runGitCommandWithEnv(cwd, ["add", "-f", "--", gitHeadEvidencePath], env, [
        "ignore",
        "pipe",
        "pipe",
    ]);
    return { evidencePath: gitHeadEvidencePath, treeSha, parentCommitShas };
}
export function appendGitHeadEvidenceJsonl(evidenceAbsolute, payload) {
    const nextLine = `${JSON.stringify(payload)}\n`;
    mkdirSync(path.dirname(evidenceAbsolute), { recursive: true });
    const repoRoot = path.resolve(path.dirname(evidenceAbsolute), "..", "..", "..");
    const runtimeAbsolute = path.join(repoRoot, gitHeadEvidencePaths.runtimeJsonl);
    mkdirSync(path.dirname(runtimeAbsolute), { recursive: true });
    appendFileSync(runtimeAbsolute, nextLine, "utf8");
    const rawEventDigest = `sha256:${createHash("sha256").update(nextLine, "utf8").digest("hex")}`;
    const compact = {
        schemaVersion: "atm.gitHeadAcceptance.v1",
        storagePolicy: "runtime-raw-tracked-digest",
        source: {
            availability: "runtime-local",
            rawJournalPath: gitHeadEvidencePaths.runtimeJsonl,
            rawEventDigest,
        },
        evidence: payload.evidence ?? [],
    };
    const compactDigest = `sha256:${createHash("sha256").update(JSON.stringify(compact), "utf8").digest("hex")}`;
    writeFileSync(evidenceAbsolute, `${JSON.stringify({ ...compact, digest: compactDigest })}\n`, "utf8");
}
export function captureGitHeadEvidencePreparation(cwd) {
    const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
    const existed = existsSync(evidenceAbsolute);
    return {
        evidenceAbsolute,
        existed,
        content: existed ? readFileSync(evidenceAbsolute, "utf8") : null,
    };
}
export function rollbackFailedGitHeadEvidencePreparation(snapshot) {
    const currentContent = existsSync(snapshot.evidenceAbsolute)
        ? readFileSync(snapshot.evidenceAbsolute, "utf8")
        : null;
    if (snapshot.existed) {
        if (currentContent === snapshot.content)
            return false;
        writeFileSync(snapshot.evidenceAbsolute, snapshot.content ?? "", "utf8");
        return true;
    }
    if (currentContent === null)
        return false;
    rmSync(snapshot.evidenceAbsolute, { force: true });
    return true;
}
export function reconcileResolvedCrossTaskMutationIncident(cwd, taskId) {
    if (detectCrossTaskMutation(cwd, taskId, "git check"))
        return false;
    if (!readIncidentFlag(cwd))
        return false;
    clearIncidentFlags(cwd);
    return true;
}
export function hasMatchingWorktreeGitHeadEvidence(cwd, treeSha, parentCommitShas) {
    const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
    if (!existsSync(evidenceAbsolute))
        return false;
    const lines = readFileSync(evidenceAbsolute, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            for (const record of Array.isArray(parsed.evidence)
                ? parsed.evidence
                : []) {
                const git = record?.details?.git;
                const candidateTreeSha = typeof git?.treeSha === "string" ? git.treeSha.trim() : null;
                const candidateParents = Array.isArray(git?.parentCommitShas)
                    ? git.parentCommitShas
                        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
                        .filter(Boolean)
                    : [];
                if (candidateTreeSha === treeSha &&
                    sameStringSet(candidateParents, parentCommitShas)) {
                    return true;
                }
            }
        }
        catch { }
    }
    return false;
}
export function sameStringSet(left, right) {
    if (left.length !== right.length)
        return false;
    const leftSorted = [...left].sort();
    const rightSorted = [...right].sort();
    return leftSorted.every((entry, index) => entry === rightSorted[index]);
}
export function readCurrentHeadParentCommitShas(cwd) {
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
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                for (const mergeHeadSha of mergeHeadShas) {
                    if (!parentCommitShas.includes(mergeHeadSha)) {
                        parentCommitShas.push(mergeHeadSha);
                    }
                }
            }
        }
        return parentCommitShas;
    }
    catch {
        return [];
    }
}
export function readIndexTreeWithoutEvidence(cwd, env = process.env) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "atm-governed-commit-index-"));
    const tempIndex = path.join(tempDir, "index");
    try {
        if (env?.GIT_INDEX_FILE) {
            const absoluteIndex = path.resolve(env.GIT_INDEX_FILE);
            if (existsSync(absoluteIndex)) {
                writeFileSync(tempIndex, readFileSync(absoluteIndex));
            }
        }
        else {
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
        runGitCommandWithEnv(cwd, [
            "rm",
            "--cached",
            "--quiet",
            "--ignore-unmatch",
            "--force",
            "--",
            gitHeadEvidencePaths.legacyJson,
            gitHeadEvidencePaths.jsonl,
        ], { GIT_INDEX_FILE: tempIndex }, ["ignore", "pipe", "pipe"]);
        return (runGitCommandWithEnv(cwd, ["write-tree"], { GIT_INDEX_FILE: tempIndex }, [
            "ignore",
            "pipe",
            "pipe",
        ]).trim() || null);
    }
    catch {
        return null;
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
