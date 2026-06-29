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

export function adoptDefaultBootstrap(cwd: string, options = {}) {
  return adoptLocalGovernanceBundle(cwd, options);
}

export function installDefaultRootDropScripts(cwd: string, options = {}) {
  return installRootDropScripts(cwd, options);
}