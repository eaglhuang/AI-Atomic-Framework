export declare function buildUpgradeNextActionHint(cwd: string, proposal: Record<string, unknown>): {
    status: string;
    route: string;
    reason: string | undefined;
    command: string;
    commandTemplate: boolean;
    requiredEvidenceKinds: string[];
    requiredCliOptions: string[] | undefined;
    missingInputs: string[];
} | {
    status: string;
    route: string;
    reason: string | undefined;
    command: string;
    requiredEvidenceKinds: string[] | undefined;
    requiredCliOptions: string[] | undefined;
    commandTemplate?: undefined;
    missingInputs?: undefined;
} | null;
