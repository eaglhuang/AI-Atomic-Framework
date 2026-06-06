import type { IntegrationInstallContext, InstallManifest } from '../manifest/types.ts';
import type { IntegrationVerifyResult } from './types.ts';
export declare function verifyManifestFiles(adapterId: string, context: IntegrationInstallContext, manifest: InstallManifest): IntegrationVerifyResult;
