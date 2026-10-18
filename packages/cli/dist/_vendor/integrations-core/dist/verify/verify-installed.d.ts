import type { IntegrationInstallContext, InstallManifest } from '../manifest/types.js';
import type { IntegrationVerifyResult } from './types.js';
export declare function verifyManifestFiles(adapterId: string, context: IntegrationInstallContext, manifest: InstallManifest): IntegrationVerifyResult;
