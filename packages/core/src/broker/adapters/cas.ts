import { createHash } from 'node:crypto';

/**
 * Content hash convention shared with proposal.ts / hash-lock.ts:
 * `sha256:<hex>` over the UTF-8 bytes of the content.
 */
export function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export interface CasResult {
  readonly ok: boolean;
  readonly mismatch: boolean;
  readonly expectedBaseHash: string;
  readonly actualBaseHash: string;
}

/**
 * Compare-and-swap base-hash check (TASK-CID-0097). A brokered write computes the
 * hash of the file it actually read (`currentFileContents`) and compares it to the
 * `expectedBaseHash` the plan was built against. A mismatch means the file changed
 * under the planner (a potential lost update) and the write must NOT proceed on the
 * stale plan. The caller performs a single bounded re-plan on mismatch — there is
 * no internal retry loop here.
 */
export function computeCasResult(input: {
  readonly filePath: string;
  readonly expectedBaseHash: string;
  readonly currentFileContents: string;
}): CasResult {
  const actualBaseHash = hashContent(input.currentFileContents);
  const mismatch = actualBaseHash !== input.expectedBaseHash;
  return {
    ok: !mismatch,
    mismatch,
    expectedBaseHash: input.expectedBaseHash,
    actualBaseHash
  };
}
