import {
  adoptLocalGovernanceBundle,
  createOfficialBootstrapCommand,
  createRecommendedPrompt,
  createSelfHostingAlphaPrompt
} from '../../../plugin-governance-local/src/index.ts';

export {
  createOfficialBootstrapCommand,
  createRecommendedPrompt,
  createSelfHostingAlphaPrompt
};

export function adoptDefaultBootstrap(cwd: any, options = {}) {
  return adoptLocalGovernanceBundle(cwd, options);
}