export declare const defaultLocalGitAdapterConfig: Readonly<{
    registryPath: ".atm/registry";
    reportsPath: ".atm/history/reports";
    dryRun: false;
    lockMode: "noop";
    gateMode: "noop";
    docMode: "noop";
}>;
export declare function createLocalGitAdapter(configOverrides?: {}): {
    adapterName: string;
    defaultConfig: any;
    resolveRegistryPath: (context: any) => string;
    resolveLegacyUri: (context: any, legacyUri: any) => {
        absolutePath: string;
        exists: boolean;
        repositoryAlias: any;
        uri: string;
        scheme: string;
        relativePath: string;
        fragment: string;
        lineStart: number | null;
        lineEnd: number | null;
    };
    scaffold: (context: any) => any;
    lockScope: (context: any, workItem: any, files: any) => any;
    runGate: (context: any, workItem: any) => any;
    writeDocRecord: (context: any, workItem: any, summary: any) => any;
    runAtomizeAdapter: (context: any, request: any) => any;
    runInfectAdapter: (context: any, request: any) => any;
    listHostGates: () => never[];
    listNoTouchZones: () => never[];
    resolveMutationPolicy: () => {
        requireSession: boolean;
        requireDryRunProposal: boolean;
        requireReviewBeforeApply: boolean;
        allowUnguidedInDev: boolean;
        allowUnguidedInCI: boolean;
    };
    writeRegistryEntry: (context: any, entry: any) => any;
    readRegistryEntry: (context: any, entryId: any) => any;
};
export declare function createNeutralMutationPolicy(): {
    requireSession: boolean;
    requireDryRunProposal: boolean;
    requireReviewBeforeApply: boolean;
    allowUnguidedInDev: boolean;
    allowUnguidedInCI: boolean;
};
export declare function scaffoldLocalRepository(context: any, baseConfig?: Readonly<{
    registryPath: ".atm/registry";
    reportsPath: ".atm/history/reports";
    dryRun: false;
    lockMode: "noop";
    gateMode: "noop";
    docMode: "noop";
}>): any;
export declare function resolveRegistryPath(repositoryRoot: any, config?: Readonly<{
    registryPath: ".atm/registry";
    reportsPath: ".atm/history/reports";
    dryRun: false;
    lockMode: "noop";
    gateMode: "noop";
    docMode: "noop";
}>): string;
export declare function writeRegistryEntry(context: any, baseConfig: any, entry: any): any;
export declare function readRegistryEntry(context: any, baseConfig: any, entryId: any): any;
export declare function resolveLegacyUri(context: any, baseConfig: any, legacyUri: any): {
    absolutePath: string;
    exists: boolean;
    repositoryAlias: any;
    uri: string;
    scheme: string;
    relativePath: string;
    fragment: string;
    lineStart: number | null;
    lineEnd: number | null;
};
export declare function runDryRunAdapter(behaviorId: any, context: any, baseConfig: any, request: any): any;
