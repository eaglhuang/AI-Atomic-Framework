import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveActorWorkSession } from '../actor-session.ts';
import { CliError, parseJsonText } from '../shared.ts';
import { pathMatchesTaskScope, uniqueSorted } from '../git-governance/commit-scope-policy.ts';
import { normalizeWorkPath } from './playbook-projection.ts';
import type { ImportedTaskSummary } from './route-predicates.ts';

type ClaimAdmissionTask = Pick<ImportedTaskSummary, 'workItemId'>;

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

type DirtyPathOwner = {
  readonly taskId: string;
  readonly actorId: string;
  readonly sessionId: string | null;
  readonly laneSessionId: string | null;
  readonly authority: 'active-claim' | 'retained-wip';
};

export function inspectClaimDirtyWipAdmission(input: {
  readonly cwd: string;
  readonly task: ClaimAdmissionTask;
  readonly actorId: string;
  readonly laneSessionId?: string | null;
  readonly claimFiles: readonly string[];
  readonly allowUnownedTaskScopedRecovery?: boolean;
}): ClaimDirtyWipAdmission {
  const candidateFiles = uniqueSorted(input.claimFiles.map(normalizeWorkPath).filter(isCodeClaimPath));
  if (candidateFiles.length === 0) return clean(input, candidateFiles);
  const dirtyFiles = readDirtyFiles(input.cwd);
  const intersectingFiles = dirtyFiles
    .map((dirty) => dirty.file)
    .filter((file) => candidateFiles.some((scope) => pathMatchesTaskScope(file, scope) || pathMatchesTaskScope(scope, file)));
  const blockers = uniqueSorted(intersectingFiles).flatMap((file): ClaimDirtyWipBlocker[] => {
    const owner = findDirtyPathOwner(input.cwd, file);
    if (isOwnedByRequestingClaim(owner, input.task.workItemId, input.actorId, input.laneSessionId)
      || (!owner && input.allowUnownedTaskScopedRecovery === true)) return [];
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
  readonly task: ClaimAdmissionTask;
  readonly actorId: string;
  readonly laneSessionId?: string | null;
  readonly claimFiles: readonly string[];
  readonly allowUnownedTaskScopedRecovery?: boolean;
}): ClaimDirtyWipAdmission {
  const admission = inspectClaimDirtyWipAdmission(input);
  if (admission.ok) return admission;
  const firstBlocker = admission.blockers[0] ?? null;
  const ownerTaskId = firstBlocker?.ownerTaskId ?? input.task.workItemId;
  const ownerActorId = firstBlocker?.ownerActorId ?? input.actorId;
  const recoveryCommands = {
    finishAndClose: `node atm.mjs taskflow close --task ${ownerTaskId} --actor ${ownerActorId} --json`,
    nonDeliveryWipCommitAndRelease: `node atm.mjs tasks release --task ${ownerTaskId} --actor ${ownerActorId} --wip-commit --reason "preserve dirty WIP" --json`,
    discardAndRelease: `node atm.mjs tasks release --task ${ownerTaskId} --actor ${ownerActorId} --discard-wip --reason "discard WIP" --json`
  };
  throw new CliError('ATM_CLAIM_FOREIGN_UNSTAGED_WIP', `Claim blocked: ${input.task.workItemId} intersects foreign or unowned dirty WIP.`, {
    exitCode: 1,
    details: {
      taskId: input.task.workItemId,
      intersectingFiles: admission.intersectingFiles,
      ownership: admission.blockers.some((entry) => entry.ownership === 'foreign') ? 'foreign' : 'unowned',
      blockers: admission.blockers,
      recoveryCommands,
      recoveryCommand: recoveryCommands.nonDeliveryWipCommitAndRelease,
      requiredAction: 'Ask the owning lane to commit/close/release, or clear unowned WIP before claiming this code scope.'
    }
  });
}

function clean(input: { readonly task: ClaimAdmissionTask; readonly actorId: string; readonly laneSessionId?: string | null }, candidateFiles: readonly string[]): ClaimDirtyWipAdmission {
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

function findDirtyPathOwner(cwd: string, file: string): DirtyPathOwner | null {
  const taskDir = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(taskDir)) return null;
  for (const entry of readdirSync(taskDir).filter((name) => name.endsWith('.json')).sort()) {
    try {
      const task = parseJsonText(readFileSync(path.join(taskDir, entry), 'utf8')) as Record<string, unknown>;
      const claim = task.claim && typeof task.claim === 'object' && !Array.isArray(task.claim) ? task.claim as Record<string, unknown> : null;
      const taskId = String(task.workItemId ?? task.id ?? entry.replace(/\.json$/i, '')).trim();
      const activeOwner = readActiveClaimOwner(cwd, taskId, claim, file);
      if (activeOwner) return activeOwner;
      const retainedOwner = readRetainedWipOwner(task, taskId, file);
      if (retainedOwner) return retainedOwner;
    } catch {}
  }
  return null;
}

function readActiveClaimOwner(cwd: string, taskId: string, claim: Record<string, unknown> | null, file: string): DirtyPathOwner | null {
  if (!claim || claim.state !== 'active') return null;
  const files = Array.isArray(claim.files) ? claim.files.map((value) => normalizeWorkPath(String(value))).filter(Boolean) : [];
  if (!files.some((scope) => pathMatchesTaskScope(file, scope) || pathMatchesTaskScope(scope, file))) return null;
  const actorId = typeof claim.actorId === 'string' ? claim.actorId.trim() : '';
  if (!actorId) return null;
  const leaseId = typeof claim.leaseId === 'string' ? claim.leaseId.trim() : null;
  const session = leaseId ? resolveActorWorkSession(cwd, { claimLeaseId: leaseId, includeNonActive: true }) : null;
  const laneSession = claim.laneSession && typeof claim.laneSession === 'object' && !Array.isArray(claim.laneSession) ? claim.laneSession as Record<string, unknown> : null;
  return { taskId, actorId, sessionId: session?.sessionId ?? null, laneSessionId: typeof laneSession?.laneSessionId === 'string' ? laneSession.laneSessionId : session?.guidanceSessionId ?? null, authority: 'active-claim' };
}

function readRetainedWipOwner(task: Record<string, unknown>, taskId: string, file: string): DirtyPathOwner | null {
  // Retained WIP protects a released, resumable operation.  Once its task is
  // terminal, it cannot remain a live owner: future admission must still see
  // the dirty byte as unowned and fail closed unless an explicit recovery path
  // authorizes it.
  if (task.status === 'done' || task.status === 'abandoned') return null;
  const retention = task.wipOwnership && typeof task.wipOwnership === 'object' && !Array.isArray(task.wipOwnership)
    ? task.wipOwnership as Record<string, unknown>
    : null;
  if (!retention || retention.schemaId !== 'atm.retainedWipOwnership.v1' || retention.taskId !== taskId) return null;
  const actorId = typeof retention.actorId === 'string' ? retention.actorId.trim() : '';
  const laneSessionId = typeof retention.laneSessionId === 'string' ? retention.laneSessionId.trim() : '';
  const dirtyPaths = Array.isArray(retention.dirtyPaths) ? retention.dirtyPaths.map((value) => normalizeWorkPath(String(value))).filter(Boolean) : [];
  if (!actorId || !laneSessionId || !dirtyPaths.some((scope) => pathMatchesTaskScope(file, scope) || pathMatchesTaskScope(scope, file))) return null;
  return { taskId, actorId, sessionId: null, laneSessionId, authority: 'retained-wip' };
}

function isOwnedByRequestingClaim(owner: DirtyPathOwner | null, taskId: string, actorId: string, laneSessionId?: string | null): boolean {
  if (!owner || owner.actorId !== actorId) return false;
  if (owner.authority === 'retained-wip') return owner.taskId === taskId;
  if (!laneSessionId) return true;
  return owner.laneSessionId === laneSessionId;
}

function isCodeClaimPath(file: string): boolean {
  const normalized = normalizeWorkPath(file);
  return normalized.startsWith('packages/') || normalized.startsWith('scripts/') || normalized.startsWith('release/') || /^(?:package(?:-lock)?\.json|tsconfig(?:\..*)?\.json)$/.test(normalized);
}
