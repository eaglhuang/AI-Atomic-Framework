import type { PythonAtomizePlan, PythonAtomizePlanRequest, PythonCommandRunnerContract, PythonEntrypointRecord, PythonImportPolicy, PythonImportRecord, PythonLanguageAdapter, PythonLanguageAdapterValidationReport, PythonLanguageAdapterValidationRequest, PythonProjectProfile, PythonSourceFile } from './index.ts';
export declare function createPythonLanguageAdapter(policyOverrides?: Partial<PythonImportPolicy>): PythonLanguageAdapter;
export declare function detectPythonProjectProfile(repositoryRoot: string): PythonProjectProfile;
export declare function validatePythonComputeAtom(request: PythonLanguageAdapterValidationRequest, profile?: PythonProjectProfile, basePolicy?: PythonImportPolicy): PythonLanguageAdapterValidationReport;
export declare function scanPythonImports(sourceFile: PythonSourceFile): readonly PythonImportRecord[];
export declare function scanPythonEntrypoints(sourceFile: PythonSourceFile): readonly PythonEntrypointRecord[];
export declare function planPythonAtomize(request: PythonAtomizePlanRequest): PythonAtomizePlan;
export declare function createPythonCommandRunnerContract(profile: PythonProjectProfile): PythonCommandRunnerContract;
