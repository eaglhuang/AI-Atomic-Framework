import { type FileMutationAdapter } from '../types.ts';
export declare const FALLBACK_ADAPTER_ID = "fallback-file-lock";
/**
 * The last-resort adapter. It treats every file as an opaque whole-file blob:
 * any two mutations to the same file collide on a single file-scoped conflict
 * key and can never be merged (verdict always 'conflict'). This is the
 * fail-closed default that guarantees `resolveAdapter` always returns an
 * adapter even for unknown formats.
 */
export declare const fallbackFileLockAdapter: FileMutationAdapter;
