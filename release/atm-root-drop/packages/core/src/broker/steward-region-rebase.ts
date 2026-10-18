/**
 * 依穩定區域身分把提案重定到目前檔案。
 * 行號只在原 base 仍吻合時使用。區域內容已被改過就擋下，不覆寫。
 */
import type { PatchProposal } from './types.ts';
import { parseUnifiedPatchHunks } from './unified-patch.ts';
import type { BaseCompositionResult, StewardCompositionBlock } from './steward-base-composer.ts';

const REGION_HINT = /^L\d+:([A-Za-z0-9_.-]+)$/;
const REGION_TAG = /<\/region:([A-Za-z0-9_.-]+)>/g;

interface RegionSpan {
  readonly regionId: string;
  readonly openIndex: number;
  readonly closeIndex: number;
}

interface PlannedSplice {
  readonly proposalId: string;
  readonly regionId: string;
  readonly index: number;
  readonly deleteCount: number;
  readonly insert: readonly string[];
}

/** 錨點、符號或補丁裡唯一的 region 結尾標籤。沒有就不重定。 */
export function proposalRegionIdentity(proposal: PatchProposal): string | null {
  for (const anchor of proposal.anchors) {
    const symbol = anchor.contentAnchor?.kind === 'symbol' ? anchor.contentAnchor.symbolName?.trim() : '';
    if (symbol) return symbol;
    const hinted = REGION_HINT.exec(anchor.hint.trim());
    if (anchor.kind === 'line' && hinted?.[1]) return hinted[1];
  }
  const tags = [...proposal.patch.matchAll(REGION_TAG)].map((match) => match[1]!).filter(Boolean);
  const unique = [...new Set(tags)];
  return unique.length === 1 ? unique[0]! : null;
}

/**
 * 把每個提案的舊列序列貼回它的區域。
 * 找不到區域身分就回 null，呼叫端維持原來的行號合成結果。
 * 同一區域被兩份提案或另一個已落地的編輯碰到時，回 blocked，不寫入。
 */
export function rebaseProposalsByRegionIdentity(
  filePath: string,
  before: string,
  proposals: readonly PatchProposal[]
): BaseCompositionResult | null {
  const identities = proposals.map((proposal) => ({ proposal, regionId: proposalRegionIdentity(proposal) }));
  if (identities.some((entry) => entry.regionId === null)) return null;

  const seen = new Set<string>();
  for (const entry of identities) {
    const regionId = entry.regionId!;
    if (seen.has(regionId)) {
      const proposalIds = identities
        .filter((candidate) => candidate.regionId === regionId)
        .map((candidate) => candidate.proposal.proposalId)
        .sort((left, right) => left.localeCompare(right));
      return blocked(filePath, proposalIds, 'steward-final-patch-required', `proposals ${proposalIds.map((id) => `'${id}'`).join(' and ')} both edit region '${regionId}' of ${filePath}; overlapping region edits stay blocked`);
    }
    seen.add(regionId);
  }

  const lineEnding = /\r\n/.test(before) ? '\r\n' : '\n';
  const endsWithNewline = before.endsWith('\n');
  const lines = before.split(/\r?\n/);
  if (endsWithNewline) lines.pop();

  const splices: PlannedSplice[] = [];
  for (const entry of identities) {
    const regionId = entry.regionId!;
    const region = findRegion(lines, regionId);
    if (!region) {
      return blocked(filePath, [entry.proposal.proposalId], 'compose-context-mismatch', `region '${regionId}' is not in the current ${filePath}; refusing to guess a new location`);
    }
    const planned = planProposalSplice(entry.proposal, region, lines);
    if ('detail' in planned) {
      return blocked(filePath, [entry.proposal.proposalId], planned.code, planned.detail);
    }
    splices.push(...planned);
  }

  const overlap = firstSpliceOverlap(splices);
  if (overlap) {
    const proposalIds = [overlap.left, overlap.right].sort((left, right) => left.localeCompare(right));
    return blocked(filePath, proposalIds, 'steward-final-patch-required', `region rebases for '${proposalIds[0]}' and '${proposalIds[1]}' cover the same lines of ${filePath}`);
  }

  const next = [...lines];
  for (const splice of [...splices].sort((left, right) => right.index - left.index)) {
    next.splice(splice.index, splice.deleteCount, ...splice.insert);
  }
  const joined = next.join(lineEnding);
  return {
    ok: true,
    content: endsWithNewline ? `${joined}${lineEnding}` : joined,
    checkedPermutationCount: 1
  };
}

function planProposalSplice(
  proposal: PatchProposal,
  region: RegionSpan,
  lines: readonly string[]
): PlannedSplice[] | { readonly code: StewardCompositionBlock['code']; readonly detail: string } {
  const hunks = parseUnifiedPatchHunks(proposal.patch);
  if (hunks.length === 0) {
    return { code: 'compose-context-mismatch', detail: `proposal '${proposal.proposalId}' has no hunk to rebase onto region '${region.regionId}'` };
  }
  const planned: PlannedSplice[] = [];
  for (const hunk of hunks) {
    const oldLines = hunk.lines.filter((entry) => !entry.startsWith('+')).map((entry) => entry.slice(1));
    const newLines = hunk.lines.filter((entry) => !entry.startsWith('-')).map((entry) => entry.slice(1));
    if (oldLines.length === 0) {
      return { code: 'compose-context-mismatch', detail: `proposal '${proposal.proposalId}' insert into region '${region.regionId}' has no anchor lines` };
    }
    const index = locateAnchor(lines, region, oldLines);
    if (index === 'ambiguous') {
      return { code: 'steward-final-patch-required', detail: `proposal '${proposal.proposalId}' anchor matches region '${region.regionId}' more than once in the current file` };
    }
    if (index === 'missing') {
      return { code: 'steward-final-patch-required', detail: `proposal '${proposal.proposalId}' overlaps region '${region.regionId}', which changed after the proposal was anchored; refusing to overwrite` };
    }
    planned.push({
      proposalId: proposal.proposalId,
      regionId: region.regionId,
      index,
      deleteCount: oldLines.length,
      insert: newLines
    });
  }
  return planned;
}

function locateAnchor(lines: readonly string[], region: RegionSpan, needle: readonly string[]): number | 'ambiguous' | 'missing' {
  const hits: number[] = [];
  for (let index = 0; index <= lines.length - needle.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (lines[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) hits.push(index);
  }
  const inside = hits.filter((index) => {
    const end = index + needle.length - 1;
    return end >= region.openIndex && index <= region.closeIndex;
  });
  if (inside.length === 1) return inside[0]!;
  if (inside.length > 1) return 'ambiguous';
  return 'missing';
}

function findRegion(lines: readonly string[], regionId: string): RegionSpan | null {
  const openNeedle = `<region:${regionId}>`;
  const closeNeedle = `</region:${regionId}>`;
  let openIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (openIndex < 0 && line.includes(openNeedle) && !line.includes(closeNeedle)) {
      openIndex = index;
      continue;
    }
    if (openIndex >= 0 && line.includes(closeNeedle)) {
      return { regionId, openIndex, closeIndex: index };
    }
  }
  return null;
}

function firstSpliceOverlap(splices: readonly PlannedSplice[]): { readonly left: string; readonly right: string } | null {
  for (let left = 0; left < splices.length; left += 1) {
    for (let right = left + 1; right < splices.length; right += 1) {
      const a = splices[left]!;
      const b = splices[right]!;
      const aEnd = a.index + Math.max(a.deleteCount, 1) - 1;
      const bEnd = b.index + Math.max(b.deleteCount, 1) - 1;
      if (a.index <= bEnd && b.index <= aEnd) return { left: a.proposalId, right: b.proposalId };
    }
  }
  return null;
}

function blocked(
  filePath: string,
  proposalIds: readonly string[],
  code: StewardCompositionBlock['code'],
  detail: string
): BaseCompositionResult {
  return { ok: false, block: { code, filePath, proposalIds, detail } };
}
