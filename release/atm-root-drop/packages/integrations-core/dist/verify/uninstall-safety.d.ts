import type { IntegrationInstallContext, InstallManifest } from '../manifest/types.ts';
import type { IntegrationUninstallResult } from './types.ts';
export declare function uninstallManifestFiles(adapterId: string, context: IntegrationInstallContext, manifest: InstallManifest): IntegrationUninstallResult;
