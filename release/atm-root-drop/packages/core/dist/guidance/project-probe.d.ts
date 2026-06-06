import { type HostGate, type MutationPolicy, type NoTouchZone, type ProjectOrientationReport } from './guidance-packet.ts';
export interface ProjectProbeOptions {
    readonly hostGates?: readonly HostGate[];
    readonly noTouchZones?: readonly NoTouchZone[];
    readonly mutationPolicy?: Partial<MutationPolicy>;
}
export declare function probeProject(repositoryRoot: string, options?: ProjectProbeOptions): ProjectOrientationReport;
