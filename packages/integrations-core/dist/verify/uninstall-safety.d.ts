import type { IntegrationInstallContext, InstallManifest } from '../manifest/types.js';
import type { IntegrationUninstallResult } from './types.js';
export declare function uninstallManifestFiles(adapterId: string, context: IntegrationInstallContext, manifest: InstallManifest): IntegrationUninstallResult;
