/**
 * Shared types for the event-derived replay lifecycle receipt contract.
 * Producer labels are display projections only; canonical events and command
 * receipts remain the sole authority for independent closure readers.
 */
export const PARALLEL_REPLAY_LIFECYCLE_STEPS = [
    'claim',
    'bounded-intent',
    'ticket',
    'adapter-decision',
    'mutation-batch',
    'compose',
    'serializability',
    'steward-apply',
    'shared-delivery',
    'queue-revalidation-fallback',
    'wakeup',
    'close',
    'admission',
    'post-compose-semantic-validation',
    'correctness-counters'
];
export const WEAK_OR_UNRELATED_COMMAND_PATTERNS = [
    /(?:^|[\s"'`\\/])--version(?:\s|$)/i,
    /\bsleep\b/i,
    /\btimeout\s+\d+\b/i,
    /\becho\b/i,
    /\btrue\b/i,
    /\bfalse\b/i
];
export const STEP_PURPOSE_HINTS = {
    claim: ['claim', 'tasks claim', 'next --claim'],
    'bounded-intent': ['intent', 'bounded intent', 'proposal'],
    ticket: ['ticket', 'broker ticket', 'admission ticket'],
    'adapter-decision': ['adapter', 'format adapter'],
    'mutation-batch': ['mutation', 'batch', 'proposal batch'],
    compose: ['compose', 'composer'],
    serializability: ['serializ', 'legal-order', 'permutation'],
    'steward-apply': ['steward', 'apply'],
    'shared-delivery': ['shared delivery', 'shared-delivery', 'shared commit'],
    'queue-revalidation-fallback': ['queue', 'revalidat', 'fallback'],
    wakeup: ['wakeup', 'wake-up', 'successor wake'],
    close: ['close', 'taskflow close', 'tasks close'],
    admission: ['admission', 'broker decision', 'parallel admission'],
    'post-compose-semantic-validation': ['semantic valid', 'post-compose', 'validator'],
    'correctness-counters': ['correctness', 'counter', 'fault counter']
};
