import type { PythonCommandRunnerContract, PythonProjectProfile, PythonStaticCheckPlan } from '../index.ts';
export declare function detectPythonProjectProfile(repositoryRoot: string): PythonProjectProfile;
export declare function createPythonCommandRunnerContract(profile: PythonProjectProfile): PythonCommandRunnerContract;
export declare function createFastPythonStaticCheck(profile: PythonProjectProfile): PythonStaticCheckPlan;
export declare function createDefaultPythonStaticCheck(profile: PythonProjectProfile): PythonStaticCheckPlan;
export declare function createAllPythonStaticCheck(profile: PythonProjectProfile): PythonStaticCheckPlan;
export declare function createUnknownProfile(): PythonProjectProfile;
