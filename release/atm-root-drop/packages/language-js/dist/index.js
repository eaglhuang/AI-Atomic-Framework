export const languageJsPackage = {
    packageName: '@ai-atomic-framework/language-js',
    packageRole: 'javascript-typescript-language-adapter',
    packageVersion: '0.0.0'
};
export const defaultJavaScriptImportPolicy = {
    forbiddenSpecifiers: ['fs', 'node:fs', 'child_process', 'node:child_process']
};
export const languageJsRuntime = {
    entrypoint: './language-js-adapter.ts',
    supportsImportScan: true,
    supportsEntrypointRules: true,
    supportsDelegatedTestCommands: true,
    resultFormat: 'JavaScriptValidationReport'
};
export { defaultJavaScriptLanguageAdapterManifest, createJavaScriptLanguageAdapter, createJavaScriptAtomizationPlanningAdapter, discoverJavaScriptAtomCandidates, detectProjectProfile, validateComputeAtom, scanImports, createCommandRunnerContract } from './language-js-adapter.js';
