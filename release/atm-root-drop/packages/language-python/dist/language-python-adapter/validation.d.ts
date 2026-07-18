import type { PythonImportPolicy, PythonLanguageAdapterValidationReport, PythonLanguageAdapterValidationRequest, PythonProjectProfile } from '../index.ts';
export declare function validatePythonComputeAtom(request: PythonLanguageAdapterValidationRequest, profile?: PythonProjectProfile, basePolicy?: PythonImportPolicy): PythonLanguageAdapterValidationReport;
