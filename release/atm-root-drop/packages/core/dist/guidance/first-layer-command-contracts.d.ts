export type FirstLayerIntent = 'backlog' | 'audit' | 'optimization' | 'create';
export interface FirstLayerRouteMatrixRow {
    readonly intent: FirstLayerIntent;
    readonly promptFixtures: readonly string[];
    readonly matchedTerms: readonly string[];
    readonly route: 'docs-first' | 'create-atom';
    readonly command: string;
    readonly authority: string;
    readonly negativeCase: string;
}
export interface FirstLayerTicketState {
    readonly state: string;
    readonly errorCode: string | null;
    readonly nextAction: string;
    readonly statusCommand: string;
    readonly continuation: string;
}
export declare const firstLayerRouteMatrix: readonly FirstLayerRouteMatrixRow[];
export declare const firstLayerTicketStates: readonly FirstLayerTicketState[];
export declare const firstLayerWindowsSafeExamples: Readonly<{
    markdownRead: "node -e \"const fs=require('node:fs'); console.log(fs.readFileSync(process.argv[1],'utf8').slice(0,4000))\" -- <file.md>";
    textSearch: "rg \"pattern\" <path>";
    fileSearch: "rg --files <path>";
    forbiddenPattern: "Do not recommend PowerShell range indexing or document parsing for Markdown/JSON/text planning docs.";
}>;
export declare const firstLayerCommonCommands: Readonly<{
    release: "node atm.mjs broker release --task <task-id> --actor <actor> --json";
    checkpoint: "node atm.mjs batch checkpoint --actor <actor> --json";
    backlog: "node atm.mjs guide first-layer --json";
    audit: "node atm.mjs tasks audit --json";
    promptScopedNext: "node atm.mjs next --prompt \"<user prompt>\" --json";
    fullNext: "node atm.mjs next --prompt \"<user prompt>\" --verbose --json";
}>;
export declare function classifyFirstLayerIntent(goal: string): FirstLayerRouteMatrixRow | null;
export declare function buildFirstLayerCommandContract(): {
    schemaId: string;
    specVersion: string;
    routeMatrix: readonly FirstLayerRouteMatrixRow[];
    routeMatrixDigest: string;
    ticketStates: readonly FirstLayerTicketState[];
    commonCommands: Readonly<{
        release: "node atm.mjs broker release --task <task-id> --actor <actor> --json";
        checkpoint: "node atm.mjs batch checkpoint --actor <actor> --json";
        backlog: "node atm.mjs guide first-layer --json";
        audit: "node atm.mjs tasks audit --json";
        promptScopedNext: "node atm.mjs next --prompt \"<user prompt>\" --json";
        fullNext: "node atm.mjs next --prompt \"<user prompt>\" --verbose --json";
    }>;
    windowsSafeExamples: Readonly<{
        markdownRead: "node -e \"const fs=require('node:fs'); console.log(fs.readFileSync(process.argv[1],'utf8').slice(0,4000))\" -- <file.md>";
        textSearch: "rg \"pattern\" <path>";
        fileSearch: "rg --files <path>";
        forbiddenPattern: "Do not recommend PowerShell range indexing or document parsing for Markdown/JSON/text planning docs.";
    }>;
    frameworkAdopterDifference: string[];
    compactOrientationDefault: string[];
    dataDrivenDecision: {
        consumedSource: string;
        liveUsageTelemetryAvailable: boolean;
        claimScope: string;
    };
    rollback: string[];
};
