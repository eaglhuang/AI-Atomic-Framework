export const glossaryEntries = Object.freeze([
  {
    term: 'atomic work item',
    definition: 'Small, governed unit of engineering work tracked by a task record.',
    see: ['lock', 'handoff', 'evidence']
  },
  {
    term: 'scope lock',
    definition: 'Record that claims intended files for one task before edits are made.',
    see: ['lock']
  },
  {
    term: 'artifact',
    definition: 'Produced file output such as reports, logs, generated specs, or snapshots.',
    see: ['handoff', 'review']
  },
  {
    term: 'evidence',
    definition: 'Validation-oriented record that references artifacts and replay instructions.',
    see: ['validate', 'verify', 'review']
  },
  {
    term: 'context summary',
    definition: 'Continuation-oriented summary used to resume governed work with minimal context load.',
    see: ['handoff', 'budget']
  },
  {
    term: 'adapter',
    definition: 'Host integration layer for storage, source control, or runtime-specific behavior.',
    see: ['init', 'bootstrap']
  },
  {
    term: 'plugin',
    definition: 'Replaceable governance capability that extends ATM without changing core contract meaning.',
    see: ['review-advisory', 'guard']
  },
  {
    term: 'guard',
    definition: 'Deterministic rule check used before or after code changes.',
    see: ['guard', 'doctor', 'validate']
  },
  {
    term: 'handoff',
    definition: 'Persisted continuation contract that records what happened and what should happen next.',
    see: ['handoff', 'next']
  },
  {
    term: 'behavior action',
    definition: 'Named behavior route such as evolve, split, merge, or rollback-oriented transitions.',
    see: ['upgrade', 'rollback']
  }
]);

