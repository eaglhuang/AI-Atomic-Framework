export declare function buildMapProposalContext({ repositoryRoot, mapId, atomId, fromVersion, toVersion }: any): {
    mapId: string;
    mapSpecPath: string;
    members: {
        from: string;
        to: string;
    }[];
    generatorProvenance: any;
};
export declare function normalizeMapId(mapId: any): string;
