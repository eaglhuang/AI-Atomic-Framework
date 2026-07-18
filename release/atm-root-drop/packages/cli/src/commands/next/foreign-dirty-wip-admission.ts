import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveActorWorkSession } from '../actor-session.ts';
import { CliError, parseJsonText } from '../shared.ts';
import { pathMatchesTaskScope, uniqueSorted } from '../git-governance/commit-scope-policy.ts';
import { normalizeWorkPath } from './playbook-projection.ts';
import type { ImportedTaskSummary } from './route-predicates.ts';

export interface ClaimDirtyWipAdmission {
  readonly schemaId: 'atm.claimDirtyWipAdmission.v1';
  readonly ok: boolean;
  readonly taskId: string;
  readonly currentActorId: string;
  readonly currentLaneSessionId: string | null;
  readonly candidateFiles: readonly string[];
  readonly intersectingFiles: readonly string[];
  readonly blockers: readonly ClaimDirtyWipBlocker[];
}

export interface ClaimDirtyWipBlocker {
  readonly file: string;
  readonly ownership: 'foreign' | 'unowned';
  readonly changeKinds: readonly ('staged' | 'unstaged' | 'untracked')[];
  readonly ownerTaskId: string | null;
  readonly ownerActorId: string | null;
  readonly ownerSessionId: string | null;
  readonly ownerLaneSessionId: string | null;
}

export function inspectClaimDirtyWipAdmission(input: {
  readonly cwd: string;
  readonly task: ImportedTaskSummary;
  readonly actorId: string;
  readonly laneSessionId?: string | null;
  readonly claimFiles: readonly string[];
}): ClaimDirtyWipAdmission {
  const candidateFiles = uniqueSorted(input.claimFiles.map(normalizeWorkPath).filter(isCodeClaimPath));
  if (candidateFiles.length === 0) return clean(input, candidateFiles);
  const dirtyFiles = readDirtyFiles(input.cwd);
  const intersectingFiles = dirtyFiles
    .map((dirty) => dirty.file)
    .filter((file) => candidateFiles.some((scope) => pathMatchesTaskScope(file, scope) || pathMatchesTaskScope(scope, file)));
  const blockers = uniqueSorted(intersectingFiles).flatMap((file): ClaimDirtyWipBlocker[] => {
    const owner = findDirtyPathOwner(input.cwd, file);
    if (isOwnedByRequestingLane(owner, input.actorId, input.laneSessionId)) return [];
    return [{
      file,
      ownership: owner ? 'foreign' : 'unowned',
      changeKinds: dirtyFiles.find((entry) => entry.file === file)?.changeKinds ?? [],
      ownerTaskId: owner?.taskId ?? null,
      ownerActorId: owner?.actorId ?? null,
      ownerSessionId: owner?.sessionId ?? null,
      ownerLaneSessionId: owner?.laneSessionId ?? null
    }];
  });
  return {
    schemaId: 'atm.claimDirtyWipAdmission.v1',
    ok: blockers.length === 0,
    taskId: input.task.workItemId,
    currentActorId: input.actorId,
    currentLaneSessionId: input.laneSessionId ?? null,
    candidateFiles,
    intersectingFiles: uniqueSorted(blockers.map((entry) => entry.file)),
    blockers
  };
}

export function assertClaimDirtyWipAdmission(input: {
  readonly cwd: string;
  readonly task: ImportedTaskSummary;
  readonly actorId: string;
  readonly laneSessionId?: string | null;
  readonly claimFiles: readonly string[];
}): ClaimDirtyWipAdmission {
  const admission = inspectClaimDirtyWipAdmission(input);
  if (admission.ok) return admission;
  throw new CliError('ATM_CLAIM_FOREIGN_UNSTAGED_WIP', `Claim blocked: ${input.task.workItemId} intersects foreign or unowned dirty WIP.`, {
    exitCode: 1,
    details: {
      taskId: input.task.workItemId,
      intersectingFiles: admission.intersectingFiles,
      ownership: admission.blockers.some((entry) => entry.ownership === 'foreign') ? 'foreign' : 'unowned',
      blockers: admission.blockers,
      requiredAction: 'Ask the owning lane to commit/close/release, or clear unowned WIP before claiming this code scope.'
    }
  });
}

function clean(input: { readonly task: ImportedTaskSummary; readonly actorId: string; readonly laneSessionId?: string | null }, candidateFiles: readonly string[]): ClaimDirtyWipAdmission {
  return { schemaId: 'atm.claimDirtyWipAdmission.v1', ok: true, taskId: input.task.workItemId, currentActorId: input.actorId, currentLaneSessionId: input.laneSessionId ?? null, candidateFiles, intersectingFiles: [], blockers: [] };
}

function readDirtyFiles(cwd: string): Array<{ file: string; changeKinds: ClaimDirtyWipBlocker['changeKinds'] }> {
  const staged = readGitNames(cwd, ['diff', '--name-only', '--cached']);
  const unstaged = readGitNames(cwd, ['diff', '--name-only']);
  const untracked = readGitNames(cwd, ['ls-files', '--others', '--exclude-standard']);
  const byFile = new Map<string, Set<'staged' | 'unstaged' | 'untracked'>>();
  for (const file of staged) addKind(byFile, file, 'staged');
  for (const file of unstaged) addKind(byFile, file, 'unstaged');
  for (const file of untracked) addKind(byFile, file, 'untracked');
  return [...byFile.entries()].map(([file, kinds]) => ({ file, changeKinds: [...kinds].sort() as ClaimDirtyWipBlocker['changeKinds'] }));
}

function addKind(map: Map<string, Set<'staged' | 'unstaged' | 'untracked'>>, file: string, kind: 'staged' | 'unstaged' | 'untracked') {
  const normalized = normalizeWorkPath(file);
  if (!normalized) return;
  const bucket = map.get(normalized) ?? new Set<'staged' | 'unstaged' | 'untracked'>();
  bucket.add(kind);
  map.set(normalized, bucket);
}

function readGitNames(cwd: string, args: readonly string[]): readonly string[] {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return [];
  return uniqueSorted(String(result.stdout ?? '').split(/\r?\n/).map(normalizeWorkPath).filter(Boolean));
}

function findDirtyPathOwner(cwd: string, file: string): { taskId: string; actorId: string; sessionId: string | null; laneSessionId: string | null } | null {
  const taskDir = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(taskDir)) return null;
  for (const entry of readdirSync(taskDir).filter((name) => name.endsWith('.json')).sort()) {
    try {
      const task = parseJsonText(readFileSync(path.join(taskDir, entry), 'utf8')) as Record<string, unknown>;
      const claim = task.claim && typeof task.claim === 'object' && !Array.isArray(task.claim) ? task.claim as Record<string, unknown> : null;
      if (!claim || claim.state !== 'active') continue;
      const files = Array.isArray(claim.files) ? claim.files.map((value) => normalizeWorkPath(String(value))).filter(Boolean) : [];
      if (!files.some((scope) => pathMatchesTaskScope(file, scope) || pathMatchesTaskScope(scope, file))) continue;
      const actorId = typeof claim.actorId === 'string' ? claim.actorId.trim() : '';
      if (!actorId) continue;
      const taskId = String(task.workItemId ?? task.id ?? entry.replace(/\.json$/i, '')).trim();
      const leaseId = typeof claim.leaseId === 'string' ? claim.leaseId.trim() : null;
      const session = leaseId ? resolveActorWorkSession(cwd, { claimLeaseId: leaseId, includeNonActive: true }) : null;
      const laneSession = claim.laneSession && typeof claim.laneSession === 'object' && !Array.isArray(claim.laneSession) ? claim.laneSession as Record<string, unknown> : null;
      return { taskId, actorId, sessionId: session?.sessionId ?? null, laneSessionId: typeof laneSession?.laneSessionId === 'string' ? laneSession.laneSessionId : session?.guidanceSessionId ?? null };
    } catch {}
  }
  return null;
}

function isOwnedByRequestingLane(owner: ReturnType<typeof findDirtyPathOwner>, actorId: string, laneSessionId?: string | null): boolean {
  if (!owner || owner.actorId !== actorId) return false;
  if (!laneSessionId) return true;
  return owner.laneSessionId === laneSessionId;
}

function isCodeClaimPath(file: string): boolean {
  const normalized = normalizeWorkPath(file);
  return normalized.startsWith('packages/') || normalized.startsWith('scripts/') || normalized.startsWith('release/') || /^(?:package(?:-lock)?\.json|tsconfig(?:\..*)?\.json)$/.test(normalized);
}
