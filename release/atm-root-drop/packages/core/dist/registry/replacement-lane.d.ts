export declare const ReplacementMode: Readonly<{
    Draft: "draft";
    Shadow: "shadow";
    Canary: "canary";
    Active: "active";
    LegacyRetired: "legacy-retired";
}>;
type ReplacementModeValue = typeof ReplacementMode[keyof typeof ReplacementMode];
export declare function transitionReplacementMode(mapId: string, to: string, evidence?: any, options?: any): {
    ok: boolean;
    mapId: string;
    from: ReplacementModeValue;
    to: ReplacementModeValue;
    registryStatus: import("../index.ts").RegistryEntryStatus;
    reason: string;
    evidenceRefs: string[];
    actor: string;
    timestamp: string;
    specPath: string;
    registryPath: string;
    lineageLogPath: any;
    transitionRecord: {
        from: ReplacementModeValue;
        to: ReplacementModeValue;
        reason: string;
        evidenceRefs: string[];
        actor: string;
        timestamp: string;
    };
    mapSpec: any;
    registryEntry: import("../index.ts").MapRegistryEntryRecord;
    lineageLog: any;
};
export {};
