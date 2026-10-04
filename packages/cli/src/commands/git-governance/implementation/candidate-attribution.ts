import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkWorkAdmissionTicket } from '../../../../../core/src/broker/work-admission-ticket.ts';
import { pathMatchesWriteScope } from '../../../../../core/src/broker/write-scope-policy.ts';
import { actorRegistryRelativePath, inspectTrackedActorRegistryState, readRuntimeIdentityForActor } from '../../actor-registry.ts';
import { frameworkTempPublicationCapabilityCovers, resolveFrameworkTempPublicationCapability } from '../../framework-development/framework-temp-publication-capability.ts';
import { evaluateLaneCapability } from '../../lane-session/capability-authority.ts';
import { inspectReferencedLaneSession } from '../../lane-session/resolve.ts';
import { isLiveActiveClaim, parseClaimRecord } from '../../tasks/task-ledger-readers.ts';
import { readWorkAdmissionTicket } from '../work-admission-check.ts';

type Document = Record<string, unknown>;
type Identity = { actorId: string; gitName: string | null; gitEmail: string | null; editor: string | null; provider: string | null };
export interface CandidateAttributionAuthority {
  readonly ok: boolean;
  readonly reason: string;
  readonly digest: string;
}
export interface CandidateAttributionInput {
  readonly cwd: string;
  readonly actorId: string | null;
  readonly taskId: string | null;
  readonly laneSessionId?: string | null;
  readonly now?: string;
}

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const digest = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const identity = (value: Document): Identity => ({ actorId: text(value.actorId) ?? '', gitName: text(value.gitName), gitEmail: text(value.gitEmail), editor: text(value.editor), provider: text(value.provider) });
const completeIdentity = (value: Identity | null): value is Identity => Boolean(value?.actorId && value.gitName && value.gitEmail);

/** Strict boundary adapter over canonical claim, ticket, lane and framework
 * authority. It never creates a legacy ticket from a planning scope. All
 * attribution consumers share this decision, and re-evaluate it at the hook.
 */
export function resolveCandidateAttributionAuthority(input: CandidateAttributionInput, files: readonly string[]): CandidateAttributionAuthority {
  const now = input.now ?? new Date().toISOString();
  const laneSessionId = input.laneSessionId ?? process.env.ATM_LANE_SESSION_ID ?? null;
  const result = (ok: boolean, reason: string, basis: unknown = null) => Object.freeze({ ok, reason, digest: digest({ actorId: input.actorId, taskId: input.taskId, files: [...files].sort(), basis }) });
  if (!input.actorId || !input.taskId || !Number.isFinite(Date.parse(now))) return result(false, 'A current actor and task authority are required.');
  if (laneSessionId && inspectReferencedLaneSession({ cwd: input.cwd, laneSessionId, now }).availability !== 'available') return result(false, 'The executing lane is missing, released or expired.');
  try {
    const taskPath = path.join(input.cwd, '.atm/history/tasks', `${input.taskId}.json`);
    if (!existsSync(taskPath)) {
      const capability = resolveFrameworkTempPublicationCapability({ ...input, laneSessionId, now: Date.parse(now) });
      return result(Boolean(capability && frameworkTempPublicationCapabilityCovers(capability, files)), 'Framework attribution requires a live exact capability.', capability);
    }
    const task = JSON.parse(readFileSync(taskPath, 'utf8')) as Document;
    const ticket = readWorkAdmissionTicket(input.cwd, input.taskId);
    if (!ticket || !Number.isFinite(Date.parse(ticket.expiresAt))) return result(false, 'A persisted, verifiable work-admission ticket is required.');
    const claim = parseClaimRecord(task.claim);
    const repair = ticket.origin === 'repair-closure';
    if (!repair && (!claim || !Number.isFinite(Date.parse(claim.heartbeatAt)) || !isLiveActiveClaim(claim, now)
      || claim.actorId !== input.actorId || !files.filter((file) => file === actorRegistryRelativePath).every((file) => claim.files.some((scope) => pathMatchesWriteScope(file, scope))))) {
      return result(false, 'The live actor claim does not cover the candidate.');
    }
    const lane = evaluateLaneCapability({ cwd: input.cwd, taskId: input.taskId, actorId: input.actorId, commandClass: 'governed-commit', executingLaneSessionId: laneSessionId, now });
    if (!lane.allowed) return result(false, lane.reason);
    const ownerLane = claim?.laneSession?.laneSessionId ?? null;
    if (!repair && ownerLane && inspectReferencedLaneSession({ cwd: input.cwd, laneSessionId: ownerLane, now }).availability !== 'available') return result(false, 'The claim owner lane is missing, released or expired.');
    const checkInput = { taskId: input.taskId, actorId: input.actorId,
      laneSessionId: repair ? laneSessionId : ownerLane, claimGeneration: repair ? ticket.claimGeneration : claim?.leaseId,
      files, operation: 'commit' as const, now };
    const decision = checkWorkAdmissionTicket({ ...checkInput, ticket });
    // A read-only narrowing projection reuses the ticket authority's exact
    // lifecycle-path semantics. It never issues or persists a new ticket.
    const claimCoverage = repair || !claim ? decision : checkWorkAdmissionTicket({ ...checkInput, ticket: { ...ticket,
      grants: ticket.grants.map((grant) => grant.kind === 'file-write' ? { ...grant, values: claim.files } : grant),
    } });
    if (!claimCoverage.ok) return result(false, claimCoverage.reason);
    return result(decision.ok, decision.reason, { ticket: ticket.ticketDigest, claim: claim ? digest(claim) : null, lane: lane.decisionClass });
  } catch {
    return result(false, 'Current attribution authority could not be verified.');
  }
}

interface RegistryEntry { readonly mode: string; readonly blob: string; }
interface RegistrySnapshot {
  readonly head: RegistryEntry | null;
  readonly index: RegistryEntry | null;
  readonly worktree: string | null;
  readonly dirty: boolean;
  readonly tracked: boolean;
}

/** Git reads deliberately inherit the current candidate index in a hook. No
 * failed probe, staged deletion or unmerged entry is classified as clean. */
function inspectRegistry(cwd: string): RegistrySnapshot {
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
  let headLine = '';
  try { headLine = git('ls-tree', 'HEAD', '--', actorRegistryRelativePath); } catch {
    // Only a verified unborn branch has no HEAD. A failed repository/object
    // read is not evidence of an absent registry.
    const branch = git('symbolic-ref', '-q', 'HEAD');
    const exists = spawnSync('git', ['show-ref', '--verify', '--quiet', branch], { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    if (exists.status !== 1) throw new Error('Cannot inspect registry HEAD');
  }
  const indexLines = git('ls-files', '--stage', '--', actorRegistryRelativePath).split('\n').filter(Boolean);
  if (indexLines.length > 1 || (indexLines[0] && !/^\d+ [a-f0-9]+ 0\t/.test(indexLines[0]))) throw new Error('Unmerged attribution registry');
  const head = headLine ? { mode: headLine.split(' ')[0], blob: headLine.split(/[ \t]/)[2] } : null;
  const index = indexLines[0] ? { mode: indexLines[0].split(' ')[0], blob: indexLines[0].split(' ')[1] } : null;
  const absolute = path.join(cwd, actorRegistryRelativePath);
  if (existsSync(absolute) && !lstatSync(absolute).isFile()) throw new Error('Attribution registry is not a regular file');
  const worktree = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
  const staged = JSON.stringify(head) !== JSON.stringify(index);
  const unstaged = index ? git('diff', '--name-only', '--', actorRegistryRelativePath).length > 0 : worktree !== null;
  return { head, index, worktree, dirty: staged || (Boolean(head || index) && unstaged), tracked: Boolean(head || index) };
}

function registryActor(content: string | null, actorId: string): Identity | null {
  if (content === null) return null;
  const parsed = JSON.parse(content) as Document;
  if (!parsed || !Array.isArray(parsed.actors) || parsed.actors.some((row) => !row || typeof row !== 'object' || !text(row.actorId))) throw new Error('Malformed attribution registry');
  const rows = parsed.actors.filter((row) => row.actorId === actorId);
  if (rows.length > 1) throw new Error('Ambiguous actor identity');
  return rows[0] ? identity(rows[0]) : null;
}

export interface CandidateAttributionDecision {
  readonly schemaId: 'atm.candidateAttributionDecision.v1';
  readonly ok: boolean;
  readonly registryAllowed: boolean;
  readonly registryChanged: boolean;
  readonly identity: Identity | null;
  readonly code: string | null;
  readonly reason: string;
  readonly authority: CandidateAttributionAuthority;
  readonly digest: string;
}

/** Resolve the identity from the exact candidate blob, never a mix of fields
 * from HEAD, the index and the worktree. An excluded registry stays a whole
 * path; runtime-only identity is valid solely under independent live authority.
 */
export function resolveCandidateAttribution(input: CandidateAttributionInput & {
  readonly phase: 'selection' | 'candidate';
  readonly autoStage?: boolean;
  readonly candidateFiles?: readonly string[];
}): CandidateAttributionDecision {
  const authority = resolveCandidateAttributionAuthority(input, [actorRegistryRelativePath]);
  const finish = (ok: boolean, registryAllowed: boolean, registryChanged: boolean, selectedIdentity: Identity | null, reason: string, basis: unknown): CandidateAttributionDecision => Object.freeze({
    schemaId: 'atm.candidateAttributionDecision.v1', ok, registryAllowed, registryChanged, identity: selectedIdentity,
    code: ok ? null : 'ATM_COMMIT_ACTOR_REGISTRY_UNSTAGED', reason, authority,
    digest: digest({ authority: authority.digest, basis, identity: selectedIdentity }),
  });
  try {
    const state = inspectRegistry(input.cwd);
    const registryAllowed = authority.ok && state.tracked;
    const included = input.phase === 'candidate'
      ? (input.candidateFiles ?? []).includes(actorRegistryRelativePath)
      : registryAllowed && (!input.candidateFiles || input.candidateFiles.includes(actorRegistryRelativePath));
    if (included && !registryAllowed) return finish(false, false, state.dirty, null, 'The candidate registry lacks current whole-file authority.', state);
    const readBlob = (entry: RegistryEntry | null): string | null => entry ? execFileSync('git', ['cat-file', 'blob', entry.blob], { cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) : null;
    const selected = included ? (input.phase === 'selection' && input.autoStage ? state.worktree : readBlob(state.index)) : readBlob(state.head);
    // Validate even excluded registry bytes; unreadable or malformed metadata
    // cannot silently establish an absent-actor fallback.
    const worktreeActor = registryActor(state.worktree, input.actorId ?? '');
    const selectedActor = registryActor(selected, input.actorId ?? '');
    const headActor = registryActor(readBlob(state.head), input.actorId ?? '');
    if (!input.actorId) return finish(false, registryAllowed, state.dirty, null, 'No actor is bound to this candidate.', null);
    if (included && !state.index && !(input.phase === 'selection' && input.autoStage && state.worktree)) return finish(false, registryAllowed, state.dirty, null, 'Deleting required attribution metadata is not an attribution exemption.', state);
    if (!included && worktreeActor && JSON.stringify(selectedActor) !== JSON.stringify(worktreeActor)) return finish(false, registryAllowed, state.dirty, null, 'Current actor identity depends on excluded registry changes. Commit the registry through its authorized owner first.', state.head);
    if (completeIdentity(selectedActor)) return finish(true, registryAllowed, state.dirty, selectedActor, 'Identity is bound to the exact candidate registry blob.', included ? state.index : state.head);
    if (selectedActor || worktreeActor || headActor) return finish(false, registryAllowed, state.dirty, null, 'Candidate actor identity is missing or incomplete; persisted identity cannot be replaced by a runtime fallback.', null);
    const runtime = readRuntimeIdentityForActor(input.cwd, input.actorId);
    const candidateAuthority = resolveCandidateAttributionAuthority(input, input.candidateFiles ?? []);
    if (runtime?.actorId === input.actorId && completeIdentity(identity({ ...runtime })) && candidateAuthority.ok) {
      return finish(true, registryAllowed, state.dirty, identity({ ...runtime }), 'Actor-local identity is independently bound to live candidate authority.', { authority: candidateAuthority.digest, runtime: digest(runtime), registry: included ? state.index : state.head });
    }
    return finish(false, registryAllowed, state.dirty, null, 'No candidate-bound identity or independently authorized actor-local identity is available.', null);
  } catch {
    return finish(false, false, true, null, 'Actor registry inspection failed or found malformed or unmerged metadata.', null);
  }
}

/** Hook adapter for the same candidate-bound decision. Keeping this complete
 * dependency check here avoids separate membership and identity rules in the
 * already large pre-commit orchestration module. */
export function inspectCandidateAttributionDependency(input: CandidateAttributionInput & {
  readonly candidateFiles: readonly string[];
  readonly suggestedTaskId?: string | null;
}) {
  const registry = inspectTrackedActorRegistryState(input.cwd);
  const candidateAttribution = resolveCandidateAttribution({ ...input, phase: 'candidate' });
  const authority = resolveCandidateAttributionAuthority(input, input.candidateFiles);
  const independentAttribution = candidateAttribution.ok && authority.ok;
  const requiredCommand = input.suggestedTaskId
    ? `node atm.mjs git commit --actor <id> --task ${input.suggestedTaskId} --message "<summary>" --json`
    : 'node atm.mjs git commit --actor <id> --message "<summary>" --json';
  const failure = (registry.blocking || candidateAttribution.registryChanged) && !independentAttribution
    ? { ok: false, findings: [{
      code: 'ATM_COMMIT_ACTOR_REGISTRY_UNSTAGED', source: 'commit-attribution', classification: 'current-task', requiredCommand,
      detail: `Tracked actor registry ${registry.path} has ${registry.status === 'mixed' ? 'both staged and unstaged' : 'unstaged'} changes. Governed node atm.mjs git commit can auto-stage that tracked registry when it belongs to the governed commit surface, but bare git commit cannot. Re-run through the ATM wrapper or restore the drift first.`,
    }] }
    : null;
  return { candidateAttribution, independentAttribution, failure };
}
