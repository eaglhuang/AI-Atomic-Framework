export const csharpLanguageAdapterPackage = {
    packageName: '@ai-atomic-framework/language-csharp',
    packageRole: 'csharp-language-adapter',
    packageVersion: '0.0.0'
};
export const defaultCSharpImportPolicy = {
    forbiddenSpecifiers: []
};
export const csharpLanguageRuntime = {
    entrypoint: './language-csharp-adapter.ts',
    supportsEntrypointRules: true,
    supportsImportScan: true,
    supportsDelegatedTestCommands: true,
    resultFormat: 'CSharpLanguageAdapterValidationReport'
};
export { createAllCSharpStaticCheck, createCSharpCommandRunnerContract, createCSharpLanguageAdapter, createDefaultCSharpStaticCheck, createFastCSharpStaticCheck, defaultCSharpLanguageAdapterManifest, detectCSharpProjectProfile, scanCSharpEntrypoints, scanCSharpImports, validateCSharpComputeAtom } from './language-csharp-adapter.js';
