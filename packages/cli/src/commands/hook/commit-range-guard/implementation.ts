import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  isCommitAcceptedByLegacyBaseline,
  readFrameworkCommitRangeBaseline
} from './baseline.ts';
import { normalizeOptionalText } from './support.ts';
import os from 'node:os';
import path from 'node:path';
import {
  auditTasks,
  detectFrameworkRepoIdentity,
  isAtmCriticalNonDocSurface,
  requiredValidationPassesForClosure,
  validateClosurePacket
} from '../../framework-development.ts';
import { gitHeadEvidencePath, gitHeadEvidencePaths } from '../../git-head-evidence.ts';
import {
  createSanitizedGitEnv,
  normalizeRelativePath,
  runGit,
  runGitLines,
  runGitScalar
} from '../git-index-diagnostics.ts';

interface ComparableCommandRun {
  readonly command: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
}

interface CommitEvidenceMatch {
  readonly commitSha: string;
  readonly criticalChangedFiles: readonly string[];
  readonly evidencePath: string;
  readonly matched: boolean;
  readonly matchedBy: 'commitSha' | 'treeSha+parentCommitShas' | 'evidenceOnlyParentCommitSha' | null;
  readonly gitDetails: ReturnType<typeof normalizeGitDetails>;
  readonly commandRuns: readonly ComparableCommandRun[];
  readonly validationPasses: readonly string[];
}

interface CommitClosurePacketInspection {
  readonly commitSha: string;
  readonly packetPath: string;
  readonly taskId: string | null;
  readonly findings: readonly {
    readonly code: string;
    readonly detail: string;
    readonly suggestedFix?: string;
  }[];
}

const protectedBranchPatterns = ['main', 'master', 'trunk', 'release/*'] as const;

function sameStringSet(left: readonly string[], right: readonly string[]) {
  const normalize = (values: readonly string[]) => [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function createCommitRangeGuardReport(cwd: string, base: string, head: string) {
  const root = path.resolve(cwd);
  const repoIdentity = detectFrameworkRepoIdentity(root);
  const legacyBaseline = repoIdentity.isFrameworkRepo ? readFrameworkCommitRangeBaseline(root, head) : null;
  const changedFiles = runGitLines(root, ['diff', '--name-only', `${base}..${head}`]).map(normalizeRelativePath);
  const criticalChangedFiles = repoIdentity.isFrameworkRepo
    ? changedFiles.filter(isAtmCriticalNonDocSurface)
    : [];
  const commits = repoIdentity.isFrameworkRepo
    ? runGitLines(root, ['rev-list', '--reverse', `${base}..${head}`])
    : [];
  const criticalCommits = commits
    .map((commitSha) => ({
      commitSha,
      criticalChangedFiles: readCommitChangedFiles(root, commitSha).filter(isAtmCriticalNonDocSurface)
    }))
    .filter((entry) => entry.criticalChangedFiles.length > 0);
  const legacyBaselineBoundaryCommitSha = legacyBaseline?.acceptedHistoryThroughCommitSha ?? legacyBaseline?.commitSha ?? null;
  const isAcceptedByLegacyBaseline = (commitSha: string) => legacyBaselineBoundaryCommitSha
    ? isCommitAcceptedByLegacyBaseline(root, commitSha, legacyBaselineBoundaryCommitSha)
    : false;
  const enforcedCriticalCommits = legacyBaseline
    ? criticalCommits.filter((entry) => !isAcceptedByLegacyBaseline(entry.commitSha))
    : criticalCommits;
  // Git-head records are still valuable for same-commit provenance and
  // closeout/repair checks, but missing records on ordinary historical critical
  // commits are diagnostic only. Do not reintroduce a per-critical-commit push
  // gate here.
  const evidenceMatches = criticalCommits.map((entry) => inspectCommitGitHeadEvidence(root, entry.commitSha, entry.criticalChangedFiles, head));
  const closurePacketInspections = enforcedCriticalCommits.flatMap((entry) => {
    const match = evidenceMatches.find((candidate) => candidate.commitSha === entry.commitSha);
    return inspectCommitClosurePackets(root, entry.commitSha, match ?? null, head);
  });
  const missingEvidenceMatches = evidenceMatches
    .filter((entry) => !legacyBaseline || !isAcceptedByLegacyBaseline(entry.commitSha))
    .filter((entry) => !entry.matched);
  const evidenceMissingDiagnostic = missingEvidenceMatches.length > 0
    ? {
      count: missingEvidenceMatches.length,
      samples: missingEvidenceMatches.slice(0, 5).map((entry) => ({
        commitSha: entry.commitSha,
        message: runGitScalar(root, ['log', '-1', '--format=%s', entry.commitSha]) ?? ''
      }))
    }
    : null;
  const taskAudit = auditTasks(root);
  const findings = [
    ...closurePacketInspections.flatMap((entry) => legacyBaseline && isAcceptedByLegacyBaseline(entry.commitSha) ? [] : entry.findings.map((finding) => ({
      level: 'error' as const,
      code: finding.code,
      commitSha: entry.commitSha,
      detail: `${entry.packetPath}: ${finding.detail}`,
      suggestedFix: finding.suggestedFix
    }))),
    ...taskAudit.findings
      .filter((entry) => entry.level === 'error')
      .map((entry) => ({
        level: 'error' as const,
        code: entry.code,
        commitSha: null,
        detail: entry.detail
      }))
  ];
  return {
    schemaId: 'atm.commitRangeGuardReport.v1',
      generatedAt: new Date().toISOString(),
      base,
      head,
      legacyBaseline,
      ignoredLegacyCriticalCommitCount: criticalCommits.length - enforcedCriticalCommits.length,
      repoIdentity,
      changedFiles,
      criticalChangedFiles,
      criticalCommits: enforcedCriticalCommits,
      evidenceMatches,
      evidenceMissingDiagnostic,
      closurePacketInspections,
      taskAudit,
      protectedBranchPatterns,
      findings,
      ok: findings.length === 0
  };
}
export function readGitObjectText(cwd: string, ref: string): string | null {
  // Git invokes hooks with a temporary index for path-limited commits. Keep
  // that index so staged-content guards inspect the exact pending commit.
  const hookIndex = process.env.GIT_INDEX_FILE?.trim();
  const result = runGit(cwd, ['show', ref], hookIndex ? { GIT_INDEX_FILE: hookIndex } : undefined);
  return result.exitCode === 0 ? result.stdout : null;
}
export function findFutureCommitEvidenceMatchInWorktree(cwd: string, treeSha: string | null, parentCommitShas: readonly string[]) {
  if (!treeSha) return null;
  const records = readGitHeadEvidenceRecordsFromWorktree(cwd);
  for (const record of records) {
    const git = normalizeGitDetails((record as { details?: { git?: unknown } })?.details?.git);
    if (!git) continue;
    if (git.treeSha === treeSha && sameStringSet(git.parentCommitShas, parentCommitShas)) {
      return git;
    }
  }
  return null;
}

export function readStagedTreeWithoutEvidence(cwd: string): string | null {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-index-'));
  const tempIndex = path.join(tempDir, 'index');
  try {
    const gitIndexPath = runGitScalar(cwd, ['rev-parse', '--git-path', 'index']);
    if (gitIndexPath) {
      const absoluteIndex = path.resolve(cwd, gitIndexPath);
      if (existsSync(absoluteIndex)) {
        writeFileSync(tempIndex, readFileSync(absoluteIndex));
      }
    }
    runGit(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--force', '--', gitHeadEvidencePaths.legacyJson, gitHeadEvidencePaths.jsonl], { GIT_INDEX_FILE: tempIndex });
    const tree = runGit(cwd, ['write-tree'], { GIT_INDEX_FILE: tempIndex });
    return tree.exitCode === 0 ? tree.stdout.trim() : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function readGitHeadEvidenceRecordsAtRef(cwd: string, ref: string): readonly unknown[] {
  const jsonlText = runGitScalar(cwd, ['show', `${ref}:${gitHeadEvidencePaths.jsonl}`]);
  if (jsonlText) {
    return jsonlText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return extractEvidenceRecords(JSON.parse(line));
        } catch {
          return [];
        }
      });
  }
  const legacyText = runGitScalar(cwd, ['show', `${ref}:${gitHeadEvidencePaths.legacyJson}`]);
  const evidence = legacyText ? readJsonText(legacyText) : null;
  return extractEvidenceRecords(evidence);
}

function readGitHeadEvidenceRecordsFromWorktree(cwd: string): readonly unknown[] {
  const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
  if (existsSync(evidenceAbsolute)) {
    const text = readFileSync(evidenceAbsolute, 'utf8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return extractEvidenceRecords(JSON.parse(line));
        } catch {
          return [];
        }
      });
  }
  const legacyAbsolute = path.join(cwd, gitHeadEvidencePaths.legacyJson);
  const evidence = existsSync(legacyAbsolute) ? readJsonText(readFileSync(legacyAbsolute, 'utf8')) : null;
  return extractEvidenceRecords(evidence);
}

function inspectCommitGitHeadEvidence(cwd: string, commitSha: string, criticalChangedFiles: readonly string[], headRef = 'HEAD'): CommitEvidenceMatch {
  const records = [
    ...readGitHeadEvidenceRecordsAtRef(cwd, commitSha),
    ...readGitHeadEvidenceRecordsAtRef(cwd, headRef),
    ...readGitHeadEvidenceRecordsFromWorktree(cwd)
  ];
  const commitTreeSha = runGitScalar(cwd, ['rev-parse', `${commitSha}^{tree}`]);
  const governedTreeSha = readCommitTreeWithoutEvidence(cwd, commitSha);
  const parentCommitShas = readParentCommitShas(cwd, commitSha);
  const candidates = records.flatMap((record) => {
    const rec = record as { commandRuns?: unknown; details?: { git?: unknown; commandRuns?: unknown } };
    const git = normalizeGitDetails(rec?.details?.git);
    if (!git) return [];
    const commandRuns = normalizeCommandRuns(rec?.commandRuns ?? rec?.details?.commandRuns);
    const validationPasses = inferValidationPassesFromCommandRuns(commandRuns);
    return [{ git, commandRuns, validationPasses }];
  });
  for (const candidate of candidates) {
    const { git, commandRuns, validationPasses } = candidate;
    if (git.commitSha === commitSha) {
      return {
        commitSha,
        criticalChangedFiles,
        evidencePath: gitHeadEvidencePath,
        matched: true,
        matchedBy: 'commitSha',
        gitDetails: git,
        commandRuns,
        validationPasses
      };
    }
  }
  for (const candidate of candidates) {
    const { git, commandRuns, validationPasses } = candidate;
    if (!git.commitSha && git.parentCommitShas.length === 1 && git.parentCommitShas[0] === commitSha) {
      return {
        commitSha,
        criticalChangedFiles,
        evidencePath: gitHeadEvidencePath,
        matched: true,
        matchedBy: 'evidenceOnlyParentCommitSha',
        gitDetails: git,
        commandRuns,
        validationPasses
      };
    }
  }
  for (const candidate of candidates) {
    const { git, commandRuns, validationPasses } = candidate;
    if (git.treeSha && (git.treeSha === governedTreeSha || git.treeSha === commitTreeSha) && sameStringSet(git.parentCommitShas, parentCommitShas)) {
      return {
        commitSha,
        criticalChangedFiles,
        evidencePath: gitHeadEvidencePath,
        matched: true,
        matchedBy: 'treeSha+parentCommitShas',
        gitDetails: git,
        commandRuns,
        validationPasses
      };
    }
  }
  return {
    commitSha,
    criticalChangedFiles,
    evidencePath: gitHeadEvidencePath,
    matched: false,
    matchedBy: null,
    gitDetails: null,
    commandRuns: [],
    validationPasses: []
  };
}

function inspectCommitClosurePackets(cwd: string, commitSha: string, evidenceMatch: CommitEvidenceMatch | null, headRef = 'HEAD'): readonly CommitClosurePacketInspection[] {
  const commitChangedFiles = readCommitChangedFiles(cwd, commitSha);
  const closurePacketPaths = commitChangedFiles.filter((entry) => entry.startsWith('.atm/history/evidence/') && entry.endsWith('.closure-packet.json'));
  if (closurePacketPaths.length === 0) return [];
  return closurePacketPaths.map((packetPath) => {
    const packetText = runGitScalar(cwd, ['show', `${commitSha}:${packetPath}`]);
    const packet = packetText ? readJsonText(packetText) : null;
    const directInspection = inspectClosurePacketAgainstCommit(cwd, commitSha, packetPath, packet, evidenceMatch);
    if (directInspection.findings.length === 0) return directInspection;

    const repairMetadata = extractClosurePacketRepairMetadata(packet);
    if (repairMetadata?.originalPacketCommitSha && repairMetadata.originalPacketCommitSha !== commitSha) {
      const repairEvidenceMatch = inspectCommitGitHeadEvidence(cwd, repairMetadata.originalPacketCommitSha, [], headRef);
      const repairInspection = inspectClosurePacketAgainstCommit(cwd, repairMetadata.originalPacketCommitSha, packetPath, packet, repairEvidenceMatch);
      if (repairInspection.findings.length === 0) {
        return { commitSha, packetPath, taskId: repairInspection.taskId, findings: [] };
      }
    }

    const headPacketText = runGitScalar(cwd, ['show', `${headRef}:${packetPath}`]);
    const headPacket = headPacketText && headPacketText !== packetText ? readJsonText(headPacketText) : null;
    const headRepairMetadata = extractClosurePacketRepairMetadata(headPacket);
    const headRepairTargetCommit = extractClosurePacketTargetCommitSha(headPacket);
    if (headRepairMetadata?.originalPacketCommitSha === commitSha && headRepairTargetCommit === commitSha) {
      const repairEvidenceMatch = inspectCommitGitHeadEvidence(cwd, commitSha, [], headRef);
      const repairInspection = inspectClosurePacketAgainstCommit(cwd, commitSha, packetPath, headPacket, repairEvidenceMatch);
      if (repairInspection.findings.length === 0) {
        return { commitSha, packetPath, taskId: repairInspection.taskId, findings: [] };
      }
    }

    return directInspection;
  });
}

function extractClosurePacketRepairMetadata(packet: unknown): {
  readonly schemaId: 'atm.closurePacketRepair.v1';
  readonly originalPacketCommitSha: string | null;
  readonly repairedTargetCommitSha: string | null;
} | null {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return null;
  const repair = (packet as Record<string, unknown>).repair;
  if (!repair || typeof repair !== 'object' || Array.isArray(repair)) return null;
  const record = repair as Record<string, unknown>;
  const schemaId = normalizeOptionalText(record.schemaId);
  if (schemaId !== 'atm.closurePacketRepair.v1') return null;
  return {
    schemaId,
    originalPacketCommitSha: normalizeOptionalText(record.originalPacketCommitSha),
    repairedTargetCommitSha: normalizeOptionalText(record.repairedTargetCommitSha)
  };
}

function extractClosurePacketTargetCommitSha(packet: unknown): string | null {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return null;
  const delta = (packet as Record<string, unknown>).targetCommitDelta;
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return null;
  return normalizeOptionalText((delta as Record<string, unknown>).currentCommitSha);
}

function inspectClosurePacketAgainstCommit(cwd: string, commitSha: string, packetPath: string, packet: unknown, evidenceMatch: CommitEvidenceMatch | null): CommitClosurePacketInspection {
  const commitChangedFiles = readCommitChangedFiles(cwd, commitSha);
  const parentCommitShas = readParentCommitShas(cwd, commitSha);
  const governedTreeSha = readCommitTreeWithoutEvidence(cwd, commitSha);
  const commitChangedSet = new Set(commitChangedFiles.map((entry) => normalizeRelativePath(entry)));
  const findings: Array<{ readonly code: string; readonly detail: string; readonly suggestedFix?: string }> = [];
  const validation = validateClosurePacket(packet);
  const taskId = typeof (packet as Record<string, unknown> | null)?.taskId === 'string'
    ? String((packet as Record<string, unknown>).taskId)
    : null;
  if (!validation.ok) {
    const invalidFormatSummary = validation.invalidFormat.length > 0
      ? `; invalidFormat=${validation.invalidFormat.map((entry) => entry.path).join(', ')}`
      : '';
    findings.push({
      code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_INVALID',
      detail: `closure packet contract is incomplete (${validation.missing.join(', ')}${invalidFormatSummary})`
    });
    return { commitSha, packetPath, taskId, findings };
  }

  const normalizedPacket = packet as Record<string, unknown>;
  const packetTargetCommit = normalizeOptionalText(normalizedPacket.targetCommit);
  const packetTreeSha = normalizeOptionalText((normalizedPacket.targetCommitDelta as Record<string, unknown>)?.governedTreeSha ?? normalizedPacket.governedTreeSha);
  const packetParentCommitShas = normalizeStringArray((normalizedPacket.targetCommitDelta as Record<string, unknown>)?.parentCommitShas);
  const packetChangedFiles = normalizeStringArray((normalizedPacket.targetCommitDelta as Record<string, unknown>)?.changedFiles).map(normalizeRelativePath).filter(Boolean);
  const invalidChangedFiles = packetChangedFiles.filter((entry) => !commitChangedSet.has(entry));
  if (invalidChangedFiles.length > 0) {
    findings.push({
      code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_CHANGED_FILES_MISMATCH',
      detail: `targetCommitDelta.changedFiles includes files not present in commit ${commitSha}: ${invalidChangedFiles.join(', ')}`
    });
  }
  if (!sameStringSet(packetParentCommitShas, parentCommitShas)) {
    findings.push({
      code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_PARENT_MISMATCH',
      detail: `targetCommitDelta.parentCommitShas does not match commit parents for ${commitSha}.`
    });
  }
  if (packetTargetCommit && !parentCommitShas.includes(packetTargetCommit)) {
    findings.push({
      code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_TARGET_COMMIT_MISMATCH',
      detail: `targetCommit ${packetTargetCommit} is not a parent of commit ${commitSha}.`
    });
  }
  if (packetTreeSha && governedTreeSha && packetTreeSha !== governedTreeSha) {
    findings.push({
      code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_TREE_MISMATCH',
      detail: `targetCommitDelta.governedTreeSha ${packetTreeSha} does not match governed tree ${governedTreeSha} for commit ${commitSha}.`,
      suggestedFix: buildClosurePacketRepairSuggestedFix(taskId)
    });
  }

  if (evidenceMatch?.matched) {
    const evidenceTreeSha = normalizeOptionalText(evidenceMatch.gitDetails?.treeSha);
    if (packetTreeSha && evidenceTreeSha && packetTreeSha !== evidenceTreeSha) {
      findings.push({
        code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_GIT_HEAD_TREE_MISMATCH',
        detail: `closure packet governedTreeSha ${packetTreeSha} is not the same tree recorded by git-head evidence (${evidenceTreeSha}).`
      });
    }
    if (evidenceMatch.gitDetails && !sameStringSet(packetParentCommitShas, evidenceMatch.gitDetails.parentCommitShas)) {
      findings.push({
        code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_GIT_HEAD_PARENT_MISMATCH',
        detail: 'closure packet parent commit set does not match git-head evidence parent commit set.'
      });
    }
    const packetCommandRuns = normalizeCommandRuns((normalizedPacket.commandRuns as unknown[] | undefined) ?? []);
    const missingCommandRuns = packetCommandRuns.filter((entry) => !evidenceMatch.commandRuns.some((candidate) => sameComparableCommandRun(candidate, entry)));
    if (missingCommandRuns.length > 0) {
      findings.push({
        code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_COMMAND_RUN_MISMATCH',
        detail: `closure packet commandRuns are not fully backed by git-head evidence (${missingCommandRuns.map((entry) => entry.command).join(', ')}).`
      });
    }
    const requiredValidationPasses = requiredValidationPassesForClosure(normalizeStringArray(normalizedPacket.requiredGates));
    const missingValidationPasses = requiredValidationPasses.filter((entry) => !evidenceMatch.validationPasses.includes(entry));
    if (missingValidationPasses.length > 0) {
      findings.push({
        code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_VALIDATION_MISMATCH',
        detail: `git-head evidence does not prove all required validation passes (${missingValidationPasses.join(', ')}).`
      });
    }
  }

  return { commitSha, packetPath, taskId, findings };
}

function buildClosurePacketRepairSuggestedFix(taskId: string | null): string {
  const taskArg = taskId && taskId.trim().length > 0 ? taskId.trim() : '<taskId>';
  return `Repair the closure-packet metadata with node atm.mjs tasks repair-closure --task ${taskArg} --json or node atm.mjs rescue closure-packet --task ${taskArg} --json, then rerun the governed commit-range check.`;
}

function readCommitTreeWithoutEvidence(cwd: string, commitSha: string): string | null {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-range-index-'));
  const tempIndex = path.join(tempDir, 'index');
  try {
    const readTree = runGit(cwd, ['read-tree', commitSha], { GIT_INDEX_FILE: tempIndex });
    if (readTree.exitCode !== 0) return null;
    runGit(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--force', '--', gitHeadEvidencePaths.legacyJson, gitHeadEvidencePaths.jsonl], { GIT_INDEX_FILE: tempIndex });
    const tree = runGit(cwd, ['write-tree'], { GIT_INDEX_FILE: tempIndex });
    return tree.exitCode === 0 ? tree.stdout.trim() : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function readCommitChangedFiles(cwd: string, commitSha: string): readonly string[] {
  const args = hasParent(cwd, commitSha)
    ? ['diff-tree', '--no-commit-id', '--name-only', '-r', commitSha]
    : ['show', '--name-only', '--format=', '--root', commitSha];
  return runGitLines(cwd, args).map(normalizeRelativePath).filter(Boolean);
}

function hasParent(cwd: string, commitSha: string): boolean {
  return readParentCommitShas(cwd, commitSha).length > 0;
}

function readParentCommitShas(cwd: string, commitSha: string): readonly string[] {
  const row = runGitScalar(cwd, ['rev-list', '--parents', '-n', '1', commitSha]);
  return row ? row.split(/\s+/).slice(1).filter(Boolean) : [];
}

export function readCurrentHeadForFutureCommit(cwd: string): readonly string[] {
  const head = runGitScalar(cwd, ['rev-parse', '--verify', 'HEAD']);
  return head ? [head] : [];
}
function extractEvidenceRecords(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === 'object');
  if (!value || typeof value !== 'object') return [];
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.evidence)) return candidate.evidence.filter((entry) => entry && typeof entry === 'object');
  if (Array.isArray(candidate.checks)) return candidate.checks.filter((entry) => entry && typeof entry === 'object');
  return candidate.evidenceKind || candidate.details ? [candidate] : [];
}

function normalizeGitDetails(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  return {
    commitSha: typeof candidate.commitSha === 'string' ? candidate.commitSha.trim() : null,
    treeSha: typeof candidate.treeSha === 'string' ? candidate.treeSha.trim() : null,
    parentCommitShas: Array.isArray(candidate.parentCommitShas)
      ? candidate.parentCommitShas.map((entry) => String(entry).trim()).filter(Boolean)
      : []
  };
}

function normalizeCommandRuns(value: unknown): readonly ComparableCommandRun[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const candidate = entry as Record<string, unknown>;
      const command = normalizeOptionalText(candidate.command);
      const exitCode = Number(candidate.exitCode);
      const stdoutSha256 = normalizeOptionalText(candidate.stdoutSha256);
      const stderrSha256 = normalizeOptionalText(candidate.stderrSha256);
      if (!command || !Number.isFinite(exitCode) || !stdoutSha256 || !stderrSha256) return null;
      return {
        command,
        exitCode,
        stdoutSha256,
        stderrSha256
      };
    })
    .filter((entry): entry is ComparableCommandRun => entry !== null);
}

function inferValidationPassesFromCommandRuns(commandRuns: readonly ComparableCommandRun[]) {
  const passes = new Set<string>();
  for (const commandRun of commandRuns) {
    const command = commandRun.command.trim();
    const validateMatch = command.match(/\bnpm(?:\.cmd)?\s+run\s+(validate:[a-z0-9:-]+)\b/i);
    if (validateMatch) {
      passes.add(validateMatch[1]);
      continue;
    }
    if (/\bnpm(?:\.cmd)?\s+run\s+typecheck\b/i.test(command)) {
      passes.add('typecheck');
    }
  }
  return [...passes].sort((left, right) => left.localeCompare(right));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function sameComparableCommandRun(left: ComparableCommandRun, right: ComparableCommandRun) {
  return left.command === right.command
    && left.exitCode === right.exitCode
    && left.stdoutSha256 === right.stdoutSha256
    && left.stderrSha256 === right.stderrSha256;
}

export function readJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
