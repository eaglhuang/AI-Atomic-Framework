import { createAllPythonStaticCheck, createDefaultPythonStaticCheck, createFastPythonStaticCheck, detectPythonProjectProfile } from './language-python-adapter/profile.js';
import { mergePolicy } from './language-python-adapter/shared.js';
import { validatePythonComputeAtom } from './language-python-adapter/validation.js';
export const defaultPythonLanguageAdapterManifest = {
    symbolCanonicalization: {
        policy: 'declaration-name',
        reExportAliasBehavior: 'not-supported',
        decoratorResolutionStance: 'not-supported'
    },
    notes: [
        'The Python adapter canonicalizes declared function/class/module symbols only; it does not resolve alias provenance semantically.',
        'Decorator semantics are not resolved by this adapter.'
    ]
};
export function createPythonLanguageAdapter(policyOverrides = {}) {
    const basePolicy = mergePolicy({ forbiddenSpecifiers: [] }, policyOverrides);
    return {
        adapterName: '@ai-atomic-framework/language-python',
        languageIds: ['python'],
        manifest: defaultPythonLanguageAdapterManifest,
        supportsAtomizeDryRun: true,
        supportsInfectDryRun: true,
        async detectProjectProfile(repositoryRoot) {
            return detectPythonProjectProfile(repositoryRoot);
        },
        getFastStaticCheck: createFastPythonStaticCheck,
        getDefaultStaticCheck: createDefaultPythonStaticCheck,
        getAllStaticCheck: createAllPythonStaticCheck,
        async validateComputeAtom(request) {
            return validatePythonComputeAtom(request, detectPythonProjectProfile(process.cwd()), basePolicy);
        }
    };
}
export { createAllPythonStaticCheck, createDefaultPythonStaticCheck, createFastPythonStaticCheck, createPythonCommandRunnerContract, detectPythonProjectProfile } from './language-python-adapter/profile.js';
export { PIPELINE_FOLDER_HINTS, scanPythonEntrypoints, scanPythonImports } from './language-python-adapter/scanner.js';
export { createPythonAtomizationPlanningAdapter, discoverPythonAtomCandidates, planPythonAtomize, planPythonAtomizeFromCandidate } from './language-python-adapter/planning.js';
export { validatePythonComputeAtom } from './language-python-adapter/validation.js';
