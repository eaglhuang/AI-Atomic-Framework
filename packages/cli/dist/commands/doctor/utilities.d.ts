import { checkIntegrationHealth } from '../integration.ts';
import { loadCharterAuthorityBundle } from '../../../../integrations-core/src/compiler/charter-block.ts';
import type { DoctorCheck } from './types.ts';
export declare function createCheck(name: string, ok: boolean, details: unknown): DoctorCheck;
export declare function createIntegrationDriftRemediation(integrationHealth: Awaited<ReturnType<typeof checkIntegrationHealth>>): {
    schemaId: string;
    failedAdapters: {
        adapterId: string | null;
        manifestPath: string;
        status: string;
        driftedFiles: any[];
        verifyCommand: string | null;
        reinstallCommand: string | null;
        removeCommand: string | null;
    }[];
    recommendedAction: string;
};
export declare function readJsonIfExists(filePath: string): Record<string, unknown> | null;
export declare function listPackageDirs(root: string): string[];
export declare function packageDirLabel(root: string, packageDir: string): string;
export declare function listFiles(directory: string): string[];
export declare function checkCharterIntegrity(root: string): {
    ok: boolean;
    charterPath: string;
    charterInvariantsPath: string;
    charterPresent: boolean;
    invariantsPresent: boolean;
    invariantsParseable: boolean;
    hashField: string | null;
};
export declare function checkCharterIntegrityV2(root: string): {
    ok: boolean;
    charterPath: string;
    firstPrinciplesPath: string;
    charterInvariantsPath: string;
    charterPresent: boolean;
    firstPrinciplesPresent: boolean;
    invariantsPresent: boolean;
    invariantsParseable: boolean;
    hashField: string | null;
    bundle: ReturnType<typeof loadCharterAuthorityBundle> | null;
};
