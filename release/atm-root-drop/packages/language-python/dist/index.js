export const pythonLanguageAdapterPackage = {
    packageName: '@ai-atomic-framework/language-python',
    packageRole: 'python-language-adapter',
    packageVersion: '0.0.0'
};
export const languagePythonPackage = pythonLanguageAdapterPackage;
export const defaultPythonImportPolicy = {
    forbiddenSpecifiers: []
};
export const pythonLanguageRuntime = {
    entrypoint: './language-python-adapter.ts',
    supportsEntrypointRules: true,
    supportsImportScan: true,
    supportsDelegatedTestCommands: true,
    supportsAtomizeDryRun: true,
    supportsInfectDryRun: true,
    resultFormat: 'PythonLanguageAdapterValidationReport'
};
export { defaultPythonLanguageAdapterManifest, createPythonLanguageAdapter, createPythonAtomizationPlanningAdapter, detectPythonProjectProfile, discoverPythonAtomCandidates, planPythonAtomizeFromCandidate, scanPythonImports, scanPythonEntrypoints, planPythonAtomize, validatePythonComputeAtom, createPythonCommandRunnerContract } from './language-python-adapter.js';
