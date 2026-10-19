// git merge-file composition and arrival-order maximal legal subsets.
// A subset is legal only when every order is a clean merge and the bytes match.
// Conflict stdout is discarded and never written.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SHARED_COMPOSE_CONTRACT, compareProposalId } from './shared-compose-inbox-contract.ts';
import { applyUnifiedPatch } from './unified-patch.ts';

export interface ComposeMemberInput {
  readonly proposalId: string;
  readonly arrivedAt: number;
  readonly baseBytes: string;
  readonly patch: string;
}

export interface ReadyMember {
  readonly proposalId: string;
  readonly arrivedAt: number;
  readonly declaredBase: string;
  readonly mine: string;
}

export type MemberComposeResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly verdict: 'conflict' | 'error'; readonly detail: string };

export interface RejectedMember {
  readonly proposalId: string;
  readonly detail: 'git-merge-conflict' | 'excluded-by-arrival-maximal-subset' | 'legal-proof-limit' | 'error';
  readonly errorDetail: string | null;
}

export interface SubsetSelection {
  readonly accepted: readonly ReadyMember[];
  readonly rejected: readonly RejectedMember[];
  readonly content: string | null;
}

export function gitMergeFileBytes(current: string, base: string, theirs: string): MemberComposeResult {
  const directory = mkdtempSync(path.join(tmpdir(), 'atm-compose-merge-'));
  try {
    const oursPath = path.join(directory, 'ours');
    const basePath = path.join(directory, 'base');
    const theirsPath = path.join(directory, 'theirs');
    writeFileSync(oursPath, current);
    writeFileSync(basePath, base);
    writeFileSync(theirsPath, theirs);
    const result = spawnSync('git', ['merge-file', '-p', oursPath, basePath, theirsPath], { encoding: 'utf8' });
    if (result.error) return { ok: false, verdict: 'error', detail: result.error.message };
    if (result.status === 0) return { ok: true, content: result.stdout };
    if ((result.status ?? 1) > 0) return { ok: false, verdict: 'conflict', detail: 'git-merge-conflict' };
    return { ok: false, verdict: 'error', detail: result.stderr || `git-merge-status-${result.status}` };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function materializeMember(member: ComposeMemberInput): { readonly ok: true; readonly ready: ReadyMember } | { readonly ok: false; readonly detail: string } {
  try {
    // An empty patch is a content-preserving member (for example a rename).
    // The strict parser refuses a patch with no hunks, so keep the inbox's
    // identity contract here instead of loosening the parser.
    const mine = member.patch.trim() === '' ? member.baseBytes : applyUnifiedPatch(member.baseBytes, member.patch);
    return {
      ok: true,
      ready: {
        proposalId: member.proposalId,
        arrivedAt: member.arrivedAt,
        declaredBase: member.baseBytes,
        mine
      }
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, detail };
  }
}

/** Every order of git merge-file must be clean and byte-identical. */
export function proveOrderIndependentMerge(windowBase: string, members: readonly ReadyMember[]): MemberComposeResult {
  const count = members.length;
  if (count > SHARED_COMPOSE_CONTRACT.legalProofMaxMembers) {
    return { ok: false, verdict: 'error', detail: 'legal-proof-limit' };
  }
  const total = 1 << count;
  const state = new Uint8Array(total);
  const bytes: Array<string | null> = new Array(total).fill(null);
  state[0] = 1;
  bytes[0] = windowBase;
  for (let mask = 0; mask < total; mask += 1) {
    if (state[mask] !== 1) continue;
    const current = bytes[mask];
    if (current === null) continue;
    for (let index = 0; index < count; index += 1) {
      const bit = 1 << index;
      if (mask & bit) continue;
      const next = mask | bit;
      if (state[next] === 2) continue;
      const member = members[index];
      if (!member) continue;
      const merged = gitMergeFileBytes(current, member.declaredBase, member.mine);
      if (!merged.ok) {
        state[next] = 2;
        bytes[next] = null;
        continue;
      }
      if (state[next] === 1 && bytes[next] !== merged.content) {
        state[next] = 2;
        bytes[next] = null;
        continue;
      }
      state[next] = 1;
      bytes[next] = merged.content;
    }
  }
  const full = total - 1;
  const content = bytes[full];
  if (state[full] !== 1 || content === null) {
    return { ok: false, verdict: 'conflict', detail: 'git-merge-conflict' };
  }
  return { ok: true, content };
}

/**
 * Greedy by arrival time, then proposal id. The result is inclusion-maximal
 * inside the exhaustive proof bound: every rejected member was tested against
 * the accepted set and was not a legal addition.
 */
export function selectArrivalOrderMaximalSubset(windowBase: string, members: readonly ReadyMember[]): SubsetSelection {
  const ordered = [...members].sort((left, right) => (
    left.arrivedAt - right.arrivedAt || compareProposalId(left.proposalId, right.proposalId)
  ));
  const accepted: ReadyMember[] = [];
  const rejected: RejectedMember[] = [];
  let content: string | null = null;
  for (const member of ordered) {
    if (accepted.length >= SHARED_COMPOSE_CONTRACT.legalProofMaxMembers) {
      rejected.push({ proposalId: member.proposalId, detail: 'legal-proof-limit', errorDetail: null });
      continue;
    }
    const proof = proveOrderIndependentMerge(windowBase, [...accepted, member]);
    if (proof.ok) {
      accepted.push(member);
      content = proof.content;
      continue;
    }
    if (proof.detail === 'legal-proof-limit') {
      rejected.push({ proposalId: member.proposalId, detail: 'legal-proof-limit', errorDetail: null });
      continue;
    }
    const alone = proveOrderIndependentMerge(windowBase, [member]);
    rejected.push({
      proposalId: member.proposalId,
      detail: alone.ok ? 'excluded-by-arrival-maximal-subset' : 'git-merge-conflict',
      errorDetail: null
    });
  }
  return { accepted, rejected, content: accepted.length > 0 ? content : null };
}
