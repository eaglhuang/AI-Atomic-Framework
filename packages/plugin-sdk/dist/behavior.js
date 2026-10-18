/**
 * The only valid delegation target for behavior.evolve.
 * An evolve behavior MUST delegate to ProposeAtomicUpgrade and MUST NOT
 * directly mutate the registry or bypass the human-review gate (ATM-2-0021).
 */
export const EVOLVE_DELEGATION_TARGET = 'ATM-2-0020:ProposeAtomicUpgrade';
