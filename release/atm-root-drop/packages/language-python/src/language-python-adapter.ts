import type {
  PythonImportPolicy,
  PythonLanguageAdapter,
  PythonLanguageAdapterManifest,
  PythonLanguageAdapterValidationRequest
} from './index.ts';
import {
  createAllPythonStaticCheck,
  createDefaultPythonStaticCheck,
  createFastPythonStaticCheck,
  detectPythonProjectProfile
} from './language-python-adapter/profile.ts';
import { mergePolicy } from './language-python-adapter/shared.ts';
import { validatePythonComputeAtom } from './language-python-adapter/validation.ts';

export const defaultPythonLanguageAdapterManifest: PythonLanguageAdapterManifest = {
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

export function createPythonLanguageAdapter(
  policyOverrides: Partial<PythonImportPolicy> = {}
): PythonLanguageAdapter {
  const basePolicy = mergePolicy({ forbiddenSpecifiers: [] }, policyOverrides);
  return {
    adapterName: '@ai-atomic-framework/language-python',
    languageIds: ['python'],
    manifest: defaultPythonLanguageAdapterManifest,
    supportsAtomizeDryRun: true,
    supportsInfectDryRun: true,
    async detectProjectProfile(repositoryRoot: string) {
      return detectPythonProjectProfile(repositoryRoot);
    },
    getFastStaticCheck: createFastPythonStaticCheck,
    getDefaultStaticCheck: createDefaultPythonStaticCheck,
    getAllStaticCheck: createAllPythonStaticCheck,
    async validateComputeAtom(request: PythonLanguageAdapterValidationRequest) {
      return validatePythonComputeAtom(request, detectPythonProjectProfile(process.cwd()), basePolicy);
    }
  };
}

export {
  createAllPythonStaticCheck,
  createDefaultPythonStaticCheck,
  createFastPythonStaticCheck,
  createPythonCommandRunnerContract,
  detectPythonProjectProfile
} from './language-python-adapter/profile.ts';
export {
  PIPELINE_FOLDER_HINTS,
  scanPythonEntrypoints,
  scanPythonImports
} from './language-python-adapter/scanner.ts';
export {
  createPythonAtomizationPlanningAdapter,
  discoverPythonAtomCandidates,
  planPythonAtomize,
  planPythonAtomizeFromCandidate
} from './language-python-adapter/planning.ts';
export { validatePythonComputeAtom } from './language-python-adapter/validation.ts';
