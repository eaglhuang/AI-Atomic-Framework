export declare function loadExplicitInputDocuments(cwd: string, inputPaths: string[]): {
    path: string;
    document: Record<string, unknown>;
}[];
export declare function discoverInputDocuments(cwd: string): {
    path: string;
    document: Record<string, unknown> & {
        schemaId: string;
    };
}[];
export declare function inferInputKind(schemaId: string | null | undefined): "quality-comparison" | "rollback-proof" | "map-equivalence" | "hash-diff" | "execution-evidence" | "non-regression" | "registry-candidate" | "polymorph-impact" | "evidence-pattern-report" | null;
