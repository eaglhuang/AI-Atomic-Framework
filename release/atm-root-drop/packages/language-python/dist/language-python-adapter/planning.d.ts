import type { AtomCandidate, AtomCandidateDiscoveryRequest, AtomizationPlan, AtomizationPlanRequest, AtomizationPlanningAdapter } from '@ai-atomic-framework/plugin-sdk';
import type { PythonAtomizePlan, PythonAtomizePlanRequest } from '../index.ts';
export declare function planPythonAtomize(request: PythonAtomizePlanRequest): PythonAtomizePlan;
export declare function discoverPythonAtomCandidates(request: AtomCandidateDiscoveryRequest): readonly AtomCandidate[];
export declare function planPythonAtomizeFromCandidate(request: AtomizationPlanRequest): AtomizationPlan;
export declare function createPythonAtomizationPlanningAdapter(): AtomizationPlanningAdapter;
