import type { AtomCallsite, AtomCallsiteRewrite, AtomCallsiteViolation, AtomCatalogEntry } from './types.ts';
export declare function scanCallsites(repoPath: string): AtomCallsite[];
export declare function collectDefinedReadableRefs(repoPath: string): Set<string>;
export declare function planCallsiteRewrites(callsites: readonly AtomCallsite[], catalog: readonly AtomCatalogEntry[]): AtomCallsiteRewrite[];
export declare function evaluateCallsites(callsites: readonly AtomCallsite[], knownRefNames: ReadonlySet<string>, plannedRewrites: readonly AtomCallsiteRewrite[]): AtomCallsiteViolation[];
export declare function applyCallsiteRewrites(repoPath: string, rewrites: readonly AtomCallsiteRewrite[]): void;
