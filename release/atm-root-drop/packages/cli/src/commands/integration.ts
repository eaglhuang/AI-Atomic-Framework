export type {
  GovernedVendorConfigSurface,
  IntegrationTeamRuntimeCapability,
  InstallIntegrationOptions
} from './integration/types.ts';
export {
  discoverGovernedVendorConfigSurface,
  inspectIntegrationBootstrap,
  describeIntegrationInstallHint
} from './integration/bootstrap.ts';
export {
  checkIntegrationHealth,
  inspectTeamRuntimeBackendCapabilities
} from './integration/health.ts';
export { installIntegrationAdapter } from './integration/install.ts';
export { detectCurrentEditorIntegrationId } from './integration/adapters.ts';
export { runIntegration } from './integration/run.ts';
