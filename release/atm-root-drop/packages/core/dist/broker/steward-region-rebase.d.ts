/**
 * 依穩定區域身分把提案重定到目前檔案。
 * 行號只在原 base 仍吻合時使用。區域內容已被改過就擋下，不覆寫。
 */
import type { PatchProposal } from './types.js';
import type { BaseCompositionResult } from './steward-base-composer.js';
/** 錨點、符號或補丁裡唯一的 region 結尾標籤。沒有就不重定。 */
export declare function proposalRegionIdentity(proposal: PatchProposal): string | null;
/**
 * 把每個提案的舊列序列貼回它的區域。
 * 找不到區域身分就回 null，呼叫端維持原來的行號合成結果。
 * 同一區域被兩份提案或另一個已落地的編輯碰到時，回 blocked，不寫入。
 */
export declare function rebaseProposalsByRegionIdentity(filePath: string, before: string, proposals: readonly PatchProposal[]): BaseCompositionResult | null;
