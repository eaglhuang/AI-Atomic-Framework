export const ReplacementMode = Object.freeze({
    Draft: 'draft',
    Shadow: 'shadow',
    Canary: 'canary',
    Active: 'active',
    LegacyRetired: 'legacy-retired'
});
export const orderedReplacementModes = [
    ReplacementMode.Draft,
    ReplacementMode.Shadow,
    ReplacementMode.Canary,
    ReplacementMode.Active,
    ReplacementMode.LegacyRetired
];
export const evidenceRequirementByTarget = Object.freeze({
    [ReplacementMode.Shadow]: 'map integration evidence',
    [ReplacementMode.Canary]: 'map equivalence evidence',
    [ReplacementMode.Active]: 'map equivalence / propagation / review advisory / human review evidence',
    [ReplacementMode.LegacyRetired]: 'rollback proof or retirement proof'
});
