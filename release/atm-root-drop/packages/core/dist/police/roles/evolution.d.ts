import type { EvolutionPoliceInput, PoliceFamilyReport } from '../types.ts';
export declare const DEFAULT_EVOLUTION_RECURRENCE_THRESHOLD = 2;
export declare const DEFAULT_EVOLUTION_CONFIDENCE_THRESHOLD = 0.6;
export declare function runEvolutionPolice(input?: EvolutionPoliceInput): PoliceFamilyReport;
