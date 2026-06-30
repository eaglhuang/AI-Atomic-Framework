interface BuildMapProposalContextInput {
    repositoryRoot: string;
    mapId: string;
    atomId: string;
    fromVersion: string;
    toVersion: string;
}
interface MemberMapping {
    from: string;
    to: string;
}
export declare function buildMapProposalContext({ repositoryRoot, mapId, atomId, fromVersion, toVersion }: BuildMapProposalContextInput): {
    mapId: string;
    mapSpecPath: string;
    members: MemberMapping[];
    generatorProvenance: string;
};
export declare function normalizeMapId(mapId: string): string;
export {};
