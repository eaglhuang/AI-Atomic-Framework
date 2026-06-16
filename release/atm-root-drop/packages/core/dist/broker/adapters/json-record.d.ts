import { type ConflictKey, type FileMutationAdapter } from '../types.ts';
export declare const JSON_RECORD_ADAPTER_ID = "json-record";
/** JSON record operations this adapter understands. */
export type JsonRecordOp = 'upsert' | 'add-if-absent' | 'replace';
/**
 * Builds the conflict key for a JSON record mutation from the file path and a
 * JSON pointer (RFC 6901-ish, '/' separated). Scope is 'record'.
 */
export declare function jsonPointerConflictKey(filePath: string, pointer: string): ConflictKey;
/**
 * Generic JSON record adapter (TASK-CID-0093). Mutations address individual
 * records by JSON pointer. Two mutations to different pointers are mergeable;
 * two mutations to the same pointer conflict (JSON record edits are not
 * commutative). Supports upsert / add-if-absent / replace.
 */
export declare const jsonRecordAdapter: FileMutationAdapter;
