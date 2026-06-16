import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildStewardApplyEvidence } from './apply-evidence.ts';
import type { StewardApplyEvidence } from './apply-evidence.ts';
import { sortProposalsForCompose } from './merge-plan.ts';
import { validateBrokerProposal } from './proposal.ts';
import type { VirtualAtomInUseRegistryDocument } from './registry.ts';
import type { TeamBrokerRuntimeActivationHandshakeEvidence } from './team-lane.ts';
import type { DecompositionRequest, MergePlan, PatchProposal } from './types.ts';

export type StewardValidationCode =
  | 'scope-lock-mismatch'
  | 'stale-base-commit'
  | 'file-hash-drift'
  | 'invalid-merge-plan'
  | 'out-of-scope-target'
  | 'blocked-merge-plan'
  | 'missing-proposal';

export interface StewardValidationIssue {
  readonly code: StewardValidationCode;
  readonly detail: string;
}

export interface StewardPlanStep {
  readonly proposalId: string;
  readonly targetFile: string;
  readonly applyMethod: MergePlan['applyMethod'];
}

export interface StewardPlan {
  readonly schemaId: 'atm.stewardPlan.v1';
  readonly specVersion: '0.1.0';
  readonly stewardId: string;
  readonly mergePlanId: string;
  readonly ok: boolean;
  readonly steps: readonly StewardPlanStep[];
  readonly targetFiles: readonly string[];
  readonly issues: readonly StewardValidationIssue[];
}

export interface StewardPlanResult {
  readonly ok: boolean;
  readonly plan: StewardPlan;
}

export interface StewardApplyResult {
  readonly ok: boolean;
  readonly evidence: StewardApplyEvidence;
}

export interface BrokerScopedWriteExecutionEvidence {
  readonly schemaId: 'atm.brokerScopedWriteExecution.v1';
  readonly specVersion: '0.1.0';
  readonly stewardId: string;
  readonly mergePlanId: string;
  readonly allowedFiles: readonly string[];
  readonly handshake: TeamBrokerRuntimeActivationHandshakeEvidence;
  readonly decompositionRequest: DecompositionRequest | null;
  readonly virtualAtomInUseRegistry: VirtualAtomInUseRegistryDocument;
  readonly applyEvidence: StewardApplyEvidence | null;
  readonly verdict: 'applied' | 'blocked';
  readonly blockedReasons: readonly string[];
}

export interface BrokerScopedWriteExecutionResult {
  readonly ok: boolean;
  readonly evidence: BrokerScopedWriteExecutionEvidence;
}

export function planStewardApply(input: {
  readonly cwd: string;
  readonly stewardId: string;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles: readonly string[];
}): StewardPlanResult {
  const issues = validateStewardInputs(input);
  const sorted = sortProposalsForCompose(input.proposals);
  const steps = issues.length === 0
    ? sorted.map((proposal) => ({
        proposalId: proposal.proposalId,
        targetFile: proposal.targetFile,
        applyMethod: input.mergePlan.applyMethod
      }))
    : [];

  const plan: StewardPlan = {
    schemaId: 'atm.stewardPlan.v1',
    specVersion: '0.1.0',
    stewardId: input.stewardId,
    mergePlanId: input.mergePlan.mergePlanId,
    ok: issues.length === 0,
    steps,
    targetFiles: [...new Set(sorted.map((proposal) => proposal.targetFile))].sort((left, right) => left.localeCompare(right)),
    issues
  };

  return { ok: plan.ok, plan };
}

export function applyStewardPlan(input: {
  readonly cwd: string;
  readonly stewardId: string;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles: readonly string[];
  readonly evidenceOutPath?: string | null;
}): StewardApplyResult {
  const planResult = planStewardApply(input);
  if (!planResult.ok) {
    const evidence = buildStewardApplyEvidence({
      stewardId: input.stewardId,
      mergePlan: input.mergePlan,
      proposalIds: input.mergePlan.inputProposals,
      targetFiles: planResult.plan.targetFiles,
      appliedFiles: [],
      fileBeforeHashes: {},
      fileAfterHashes: {},
      verdict: 'blocked',
      blockedReasons: planResult.plan.issues.map((issue) => `${issue.code}: ${issue.detail}`)
    });
    if (input.evidenceOutPath) writeEvidenceFile(input.evidenceOutPath, evidence);
    return { ok: false, evidence };
  }

  const sorted = sortProposalsForCompose(input.proposals);
  const fileBeforeHashes: Record<string, string> = {};
  const fileAfterHashes: Record<string, string> = {};
  const appliedFiles: string[] = [];

  for (const proposal of sorted) {
    const targetPath = path.resolve(input.cwd, proposal.targetFile);
    const before = readFileSync(targetPath, 'utf8');
    fileBeforeHashes[proposal.targetFile] = hashText(before);
    const after = applyUnifiedPatch(before, proposal.patch);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, after, 'utf8');
    fileAfterHashes[proposal.targetFile] = hashText(after);
    if (!appliedFiles.includes(proposal.targetFile)) appliedFiles.push(proposal.targetFile);
  }

  appliedFiles.sort((left, right) => left.localeCompare(right));
  const evidence = buildStewardApplyEvidence({
    stewardId: input.stewardId,
    mergePlan: input.mergePlan,
    proposalIds: input.mergePlan.inputProposals,
    targetFiles: planResult.plan.targetFiles,
    appliedFiles,
    fileBeforeHashes,
    fileAfterHashes,
    verdict: 'applied'
  });
  if (input.evidenceOutPath) writeEvidenceFile(input.evidenceOutPath, evidence);
  return { ok: true, evidence };
}

export function executeBrokerScopedWrite(input: {
  readonly cwd: string;
  readonly stewardId: string;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles: readonly string[];
  readonly handshake: TeamBrokerRuntimeActivationHandshakeEvidence;
  readonly evidenceOutPath?: string | null;
}): BrokerScopedWriteExecutionResult {
  const allowedFiles = [...new Set(input.handshake.scopedWriteExecution.allowedFiles.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const scopeFiles = [...new Set(input.scopeFiles.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const decompositionRequest = input.handshake.brokerLane.decision.decompositionRequest ?? null;

  if (!input.handshake.scopedWriteExecution.approved) {
    return {
      ok: false,
      evidence: {
        schemaId: 'atm.brokerScopedWriteExecution.v1',
        specVersion: '0.1.0',
        stewardId: input.stewardId,
        mergePlanId: input.mergePlan.mergePlanId,
        allowedFiles,
        handshake: input.handshake,
        decompositionRequest,
        virtualAtomInUseRegistry: input.handshake.brokerLane.virtualAtomInUseRegistry,
        applyEvidence: null,
        verdict: 'blocked',
        blockedReasons: input.handshake.blockedReasons.length > 0
          ? input.handshake.blockedReasons
          : ['Broker runtime activation handshake is not approved.']
      }
    };
  }

  if (allowedFiles.length !== scopeFiles.length || allowedFiles.some((entry, index) => entry !== scopeFiles[index])) {
    return {
      ok: false,
      evidence: {
        schemaId: 'atm.brokerScopedWriteExecution.v1',
        specVersion: '0.1.0',
        stewardId: input.stewardId,
        mergePlanId: input.mergePlan.mergePlanId,
        allowedFiles,
        handshake: input.handshake,
        decompositionRequest,
        virtualAtomInUseRegistry: input.handshake.brokerLane.virtualAtomInUseRegistry,
        applyEvidence: null,
        verdict: 'blocked',
        blockedReasons: ['Scoped write request does not match broker-approved allowed files.']
      }
    };
  }

  const applyResult = applyStewardPlan({
    cwd: input.cwd,
    stewardId: input.stewardId,
    mergePlan: input.mergePlan,
    proposals: input.proposals,
    scopeFiles,
    evidenceOutPath: input.evidenceOutPath
  });

  return {
    ok: applyResult.ok,
    evidence: {
      schemaId: 'atm.brokerScopedWriteExecution.v1',
      specVersion: '0.1.0',
      stewardId: input.stewardId,
      mergePlanId: input.mergePlan.mergePlanId,
      allowedFiles,
      handshake: input.handshake,
      decompositionRequest,
      virtualAtomInUseRegistry: input.handshake.brokerLane.virtualAtomInUseRegistry,
      applyEvidence: applyResult.evidence,
      verdict: applyResult.ok ? 'applied' : 'blocked',
      blockedReasons: applyResult.ok ? [] : (applyResult.evidence.blockedReasons ?? ['Broker scoped write apply was blocked.'])
    }
  };
}

function validateStewardInputs(input: {
  readonly cwd: string;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles: readonly string[];
}): StewardValidationIssue[] {
  const issues: StewardValidationIssue[] = [];
  const cwd = path.resolve(input.cwd);
  const scopeSet = new Set(input.scopeFiles.map((entry) => normalizeRepoPath(cwd, entry)).filter(Boolean));

  if (input.mergePlan.schemaId !== 'atm.mergePlan.v1') {
    issues.push({ code: 'invalid-merge-plan', detail: `Unexpected merge plan schemaId '${input.mergePlan.schemaId}'.` });
  }
  // Steward takeover is only allowed if the conflict verdict says it is safe ('needs-steward' or 'parallel-safe')
  if (input.mergePlan.verdict === 'blocked-cid-conflict' || input.mergePlan.verdict === 'blocked-shared-surface') {
    issues.push({ code: 'blocked-merge-plan', detail: `Merge plan verdict '${input.mergePlan.verdict}' cannot be applied by steward.` });
  }

  const proposalIds = new Set(input.proposals.map((proposal) => proposal.proposalId));
  for (const expectedId of input.mergePlan.inputProposals) {
    if (!proposalIds.has(expectedId)) {
      issues.push({ code: 'missing-proposal', detail: `Merge plan references missing proposal '${expectedId}'.` });
    }
  }
  if (input.mergePlan.inputProposals.length !== input.proposals.length) {
    issues.push({ code: 'invalid-merge-plan', detail: 'Proposal count does not match merge plan inputProposals.' });
  }

  for (const proposal of input.proposals) {
    const normalizedTarget = normalizeRepoPath(cwd, proposal.targetFile);
    if (!normalizedTarget || isPathOutsideRoot(cwd, path.resolve(cwd, proposal.targetFile))) {
      issues.push({ code: 'out-of-scope-target', detail: `Target file is outside repository root: ${proposal.targetFile}` });
      continue;
    }
    if (scopeSet.size > 0 && !scopeSet.has(normalizedTarget)) {
      issues.push({ code: 'scope-lock-mismatch', detail: `Target file '${proposal.targetFile}' is outside steward scope lock.` });
    }

    const validation = validateBrokerProposal(proposal, { cwd });
    for (const issue of validation.issues) {
      if (issue.kind === 'stale-base-commit') {
        issues.push({ code: 'stale-base-commit', detail: issue.detail });
      }
      if (issue.kind === 'file-hash-mismatch') {
        issues.push({ code: 'file-hash-drift', detail: issue.detail });
      }
      if (issue.kind === 'out-of-scope-target-file') {
        issues.push({ code: 'out-of-scope-target', detail: issue.detail });
      }
    }
  }

  return dedupeIssues(issues);
}

export function applyUnifiedPatch(content: string, patch: string): string {
  const lines = content.split(/\r?\n/);
  const patchLines = patch.split(/\r?\n/);
  let lineIndex = 0;
  let output: string[] = [];
  let hunkIndex = 0;

  while (hunkIndex < patchLines.length) {
    const header = patchLines[hunkIndex];
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header.trim());
    if (!match) {
      hunkIndex += 1;
      continue;
    }
    const oldStart = Number.parseInt(match[1], 10) - 1;
    output.push(...lines.slice(lineIndex, oldStart));
    lineIndex = oldStart;
    hunkIndex += 1;

    while (hunkIndex < patchLines.length && !patchLines[hunkIndex].startsWith('@@')) {
      const patchLine = patchLines[hunkIndex];
      if (patchLine.startsWith('--- ') || patchLine.startsWith('+++ ')) {
        hunkIndex += 1;
        continue;
      }
      if (patchLine.startsWith('-')) {
        lineIndex += 1;
      } else if (patchLine.startsWith('+')) {
        output.push(patchLine.slice(1));
      } else if (patchLine.startsWith(' ')) {
        output.push(lines[lineIndex] ?? '');
        lineIndex += 1;
      } else if (patchLine.length === 0) {
        // skip blank separator lines inside patch text
      } else {
        output.push(patchLine);
        lineIndex += 1;
      }
      hunkIndex += 1;
    }
  }

  output.push(...lines.slice(lineIndex));
  return output.join('\n');
}

function writeEvidenceFile(filePath: string, evidence: StewardApplyEvidence): void {
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeRepoPath(cwd: string, candidate: string): string {
  const normalized = path.normalize(candidate).replace(/\\/g, '/');
  if (!normalized) return '';
  const absolute = path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(cwd, normalized);
  const relative = path.relative(cwd, absolute).replace(/\\/g, '/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return relative;
}

function isPathOutsideRoot(root: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidatePath));
  return relative.startsWith('..') || path.isAbsolute(relative);
}

function dedupeIssues(issues: readonly StewardValidationIssue[]): StewardValidationIssue[] {
  const seen = new Set<string>();
  const unique: StewardValidationIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}::${issue.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique.sort((left, right) => `${left.code}::${left.detail}`.localeCompare(`${right.code}::${right.detail}`));
}

export function readGitHeadCommit(cwd: string): string | null {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const head = String(result.stdout ?? '').trim();
  return head.length > 0 ? head : null;
}
