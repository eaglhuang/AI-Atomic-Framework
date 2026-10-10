// 以 git merge-file 把同一 immutable base 上的多份提案合成成位元組。
// 合成順序固定為 proposalId，到達順序不影響結果。衝突時丟棄含衝突標記的輸出。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyUnifiedPatch } from './unified-patch.ts';

export interface ComposeMemberInput {
  readonly proposalId: string;
  readonly baseBytes: string;
  readonly patch: string;
}

export type MemberComposeResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly verdict: 'conflict' | 'error'; readonly detail: string };

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

/** 每位成員先套回自己宣告的 base，再依 proposalId 順序對視窗 base 做三方合併。 */
export function composeMembersAgainstBase(windowBase: string, members: readonly ComposeMemberInput[]): MemberComposeResult {
  const sorted = [...members].sort((left, right) => left.proposalId.localeCompare(right.proposalId));
  let running = windowBase;
  for (const member of sorted) {
    let mine: string;
    try {
      mine = applyUnifiedPatch(member.baseBytes, member.patch);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, verdict: 'error', detail: `proposal '${member.proposalId}' ${detail}` };
    }
    const merged = gitMergeFileBytes(running, member.baseBytes, mine);
    if (!merged.ok) return merged;
    running = merged.content;
  }
  return { ok: true, content: running };
}
