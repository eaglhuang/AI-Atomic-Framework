import { adoptLocalGovernanceBundle, createOfficialBootstrapCommand, createRecommendedPrompt, createSelfHostingAlphaPrompt, installRootDropScripts } from '../_vendor/plugin-governance-local/dist/index.js';
export { createOfficialBootstrapCommand, createRecommendedPrompt, createSelfHostingAlphaPrompt };
export function adoptDefaultBootstrap(cwd, options = {}) {
    return adoptLocalGovernanceBundle(cwd, options);
}
export function installDefaultRootDropScripts(cwd, options = {}) {
    return installRootDropScripts(cwd, options);
}
