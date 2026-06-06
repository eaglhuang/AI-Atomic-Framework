export declare function buildUpgradeNextActionHint(cwd: string, proposal: any): {
    status: string;
    route: string;
    reason: any;
    command: string;
    commandTemplate: boolean;
    requiredEvidenceKinds: any;
    requiredCliOptions: any;
    missingInputs: string[];
} | {
    status: string;
    route: string;
    reason: any;
    command: string;
    requiredEvidenceKinds: any;
    requiredCliOptions: any;
    commandTemplate?: undefined;
    missingInputs?: undefined;
} | null;
