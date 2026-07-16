import type { ReplacementModeWithEvidence, ReplacementModeValue } from './types.ts';

export const ReplacementMode = Object.freeze({
  Draft: 'draft',
  Shadow: 'shadow',
  Canary: 'canary',
  Active: 'active',
  LegacyRetired: 'legacy-retired'
});

export const orderedReplacementModes: readonly ReplacementModeValue[] = [
  ReplacementMode.Draft,
  ReplacementMode.Shadow,
  ReplacementMode.Canary,
  ReplacementMode.Active,
  ReplacementMode.LegacyRetired
];

export const evidenceRequirementByTarget: Readonly<Record<ReplacementModeWithEvidence, string>> = Object.freeze({
  [ReplacementMode.Shadow]: 'map integration evidence',
  [ReplacementMode.Canary]: 'map equivalence evidence',
  [ReplacementMode.Active]: 'map equivalence / propagation / review advisory / human review evidence',
  [ReplacementMode.LegacyRetired]: 'rollback proof or retirement proof'
});
