import { sha256Digest } from '../census/index.ts';
import type {
  LifecycleReceiptValidation,
  LifecycleReceiptVerdict
} from './lifecycle-receipt-types.ts';

export function finishValidation(
  verdict: LifecycleReceiptVerdict,
  reasons: readonly string[],
  invariantCodes: readonly ('INV-ATM-008' | 'INV-ATM-009' | 'INV-ATM-010')[]
): LifecycleReceiptValidation {
  const withoutDigest = {
    schemaId: 'atm.parallelReplayLifecycleReceiptValidation.v1' as const,
    verdict,
    reasons: [...reasons],
    invariantCodes: [...invariantCodes]
  };
  return {
    ...withoutDigest,
    digest: sha256Digest(withoutDigest)
  };
}
