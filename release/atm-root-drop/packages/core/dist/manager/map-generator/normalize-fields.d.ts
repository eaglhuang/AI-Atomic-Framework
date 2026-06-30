interface AtomicMapMemberInput {
    role?: string;
}
interface AtomicMapEdgeInput {
    edgeKind?: string;
}
interface AtomicMapReplacementInput {
    legacyUris?: string[];
    mode?: string;
    evidenceRefs?: string[];
}
interface InferSpecVersionInput {
    members: AtomicMapMemberInput[];
    edges: AtomicMapEdgeInput[];
    replacement?: AtomicMapReplacementInput | null;
}
export declare function normalizeAtomId(value: unknown, fieldName: string): string;
export declare function normalizeMapId(value: unknown): string;
export declare function normalizeSemver(value: unknown, fieldName: string): string;
export declare function normalizeRequiredText(value: unknown, fieldName: string): string;
export declare function normalizeSpecVersion(value: unknown): string;
export declare function inferSpecVersion(input: InferSpecVersionInput): "0.1.0" | "0.2.0";
export declare function assertSpecVersionSupportsMapSurface(specVersion: string, input: InferSpecVersionInput): void;
export {};
