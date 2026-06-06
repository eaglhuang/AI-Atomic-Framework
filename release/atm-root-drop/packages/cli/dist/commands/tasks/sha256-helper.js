import { createHash } from 'node:crypto';
/**
 * Helper for `sha256` leaf.
 */
export function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
