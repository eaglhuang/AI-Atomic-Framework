import type { RouteContext } from '../../../../core/src/routing/index.ts';
import { type PatchEnvelope } from '../../../../core/src/broker/patch-envelope.ts';
import { type RouteFreezeRuntimeRecord } from '../../../../core/src/broker/types.ts';
import type { RouteOptions } from './types.ts';
export declare function buildRouteFreezeRuntime(route: RouteContext, options: RouteOptions): RouteFreezeRuntimeRecord;
export declare function readRouteFreezeRuntime(cwd: string, routeId: string): RouteFreezeRuntimeRecord;
export declare function writeRouteFreezeRuntime(cwd: string, record: RouteFreezeRuntimeRecord): void;
export declare function clearRouteFreezeRuntime(cwd: string, routeId: string): void;
export declare function serializeFreezeProtocolEvidence(record: RouteFreezeRuntimeRecord): {
    schemaId: string;
    routeId: string;
    signal: import("@ai-atomic-framework/core").FreezeSignal;
    ack: import("@ai-atomic-framework/core").FreezeAck;
    resolution: import("@ai-atomic-framework/core").FreezeResolution;
    pauseReason: string;
    snapshotDefaultsReserved: string;
};
export declare function writePatchEnvelopeFile(cwd: string, routeId: string, envelope: PatchEnvelope): void;
export declare function buildRoutePatchEnvelopeHandoff(route: RouteContext, freezeRuntime: RouteFreezeRuntimeRecord, options: RouteOptions): {
    envelope: PatchEnvelope;
    envelopeRef: string;
    evidence: {
        schemaId: string;
        envelopeRef: string;
        envelope: PatchEnvelope;
        summary: import("@ai-atomic-framework/core").PatchEnvelopeSummary;
        validation: {
            readonly ok: boolean;
            readonly reason: string;
        };
        comparison: {
            readonly equal: boolean;
            readonly divergences: readonly import("@ai-atomic-framework/core").PatchEnvelopeDivergence[];
        } | null;
        applyOutOfScope: string;
    };
};
export declare function runRoutePatchEnvelopeHandoff(route: RouteContext, options: RouteOptions): {
    evidence: {
        schemaId: string;
        envelopeRef: string;
        envelope: PatchEnvelope;
        summary: import("@ai-atomic-framework/core").PatchEnvelopeSummary;
        validation: {
            readonly ok: boolean;
            readonly reason: string;
        };
        comparison: {
            readonly equal: boolean;
            readonly divergences: readonly import("@ai-atomic-framework/core").PatchEnvelopeDivergence[];
        } | null;
        applyOutOfScope: string;
    };
    envelope: PatchEnvelope;
    envelopeRef: string;
};
