import type { AtomCallsite, AtomCallsiteRewrite, AtomCallsiteViolation, AtomCatalogEntry } from './types.ts';
export declare function writeGeneratedRefs(repoPath: string, catalog: readonly AtomCatalogEntry[]): void;
export declare function writeReports(repoPath: string, generatedAt: string, catalog: readonly AtomCatalogEntry[], callsites: readonly AtomCallsite[], violations: readonly AtomCallsiteViolation[], rewrites: readonly AtomCallsiteRewrite[], generatedRefPaths: readonly string[], reportPaths: readonly string[]): void;
