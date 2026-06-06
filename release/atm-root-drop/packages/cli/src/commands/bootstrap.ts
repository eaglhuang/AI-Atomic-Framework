import {
  adoptLocalGovernanceBundle,
  createOfficialBootstrapCommand,
  createRecommendedPrompt,
  createSelfHostingAlphaPrompt,
  installRootDropScripts
} from '../../../plugin-governance-local/src/index.ts';

export {
  createOfficialBootstrapCommand,
  createRecommendedPrompt,
  createSelfHostingAlphaPrompt
};

export function adoptDefaultBootstrap(cwd: any, options = {}) {
  return adoptLocalGovernanceBundle(cwd, options);
}

export function installDefaultRootDropScripts(cwd: any, options = {}) {
  return installRootDropScripts(cwd, options);
}