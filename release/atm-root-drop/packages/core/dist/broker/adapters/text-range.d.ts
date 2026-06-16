import { type FileMutationAdapter } from '../types.ts';
export declare const TEXT_RANGE_ADAPTER_ID = "text-range";
/** Text-range operations this adapter understands. */
export type TextRangeOp = 'append' | 'insertAfterHeading' | 'replaceRange';
/**
 * Text range adapter (TASK-CID-0095). Operates on line ranges of a text file.
 * Non-overlapping ranges are mergeable; overlapping ranges conflict. Concurrent
 * appends are treated conservatively as overlapping (same EOF range) and thus
 * conflict, per the plan's "overlapping ranges default to conflict" rule.
 * Supports append / insertAfterHeading / replaceRange.
 */
export declare const textRangeAdapter: FileMutationAdapter;
