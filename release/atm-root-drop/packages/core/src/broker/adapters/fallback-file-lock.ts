import {
  brokerAdapterMigration,
  type ConflictKey,
  type FileDescriptor,
  type FileMutationAdapter,
  type MergeDecision,
  type MutationRequest,
  type NormalizedMutation,
  type ParsedDocument
} from '../types.ts';

export const FALLBACK_ADAPTER_ID = 'fallback-file-lock';

/**
 * The last-resort adapter. It treats every file as an opaque whole-file blob:
 * any two mutations to the same file collide on a single file-scoped conflict
 * key and can never be merged (verdict always 'conflict'). This is the
 * fail-closed default that guarantees `resolveAdapter` always returns an
 * adapter even for unknown formats.
 */
export const fallbackFileLockAdapter: FileMutationAdapter = {
  id: FALLBACK_ADAPTER_ID,

  supports(_file: FileDescriptor): boolean {
    return true;
  },

  parse(file: FileDescriptor): ParsedDocument {
    return { filePath: file.filePath, value: file.content };
  },

  normalize(request: MutationRequest): NormalizedMutation {
    return {
      requestId: request.requestId,
      actorId: request.actorId,
      filePath: request.filePath,
      op: request.op,
      target: request.target,
      value: request.value
    };
  },

  getConflictKeys(mutation: NormalizedMutation, _parsed: ParsedDocument): readonly ConflictKey[] {
    return [
      {
        schemaId: 'atm.conflictKey.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        scope: 'file',
        key: mutation.filePath
      }
    ];
  },

  canMerge(mutations: readonly NormalizedMutation[], parsed: ParsedDocument): MergeDecision {
    const filePath = mutations[0]?.filePath ?? parsed.filePath;
    return {
      schemaId: 'atm.mergeDecision.v1',
      specVersion: '0.1.0',
      migration: brokerAdapterMigration(),
      verdict: 'conflict',
      reason: 'fallback file-lock adapter treats the file as opaque; concurrent writes are not mergeable',
      conflictKeys: [
        {
          schemaId: 'atm.conflictKey.v1',
          specVersion: '0.1.0',
          migration: brokerAdapterMigration(),
          scope: 'file',
          key: filePath
        }
      ]
    };
  },

  merge(_mutations: readonly NormalizedMutation[], _parsed: ParsedDocument): ParsedDocument {
    throw new Error('fallback-file-lock adapter cannot merge concurrent mutations; serialize the file under a whole-file lock instead');
  },

  serialize(parsed: ParsedDocument): string {
    return typeof parsed.value === 'string' ? parsed.value : String(parsed.value ?? '');
  }
};
