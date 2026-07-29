import { sha256Digest } from '../census/index.js';
export function finishValidation(verdict, reasons, invariantCodes) {
    const withoutDigest = {
        schemaId: 'atm.parallelReplayLifecycleReceiptValidation.v1',
        verdict,
        reasons: [...reasons],
        invariantCodes: [...invariantCodes]
    };
    return {
        ...withoutDigest,
        digest: sha256Digest(withoutDigest)
    };
}
