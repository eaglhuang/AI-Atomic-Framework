import { type LaneSessionDocument } from './store.ts';
import { type CommandMessage } from '../shared.ts';
export interface LaneSessionEnvelope {
    readonly laneSessionId: string;
    readonly status: LaneSessionDocument['status'];
    readonly source: 'option' | 'env' | 'minted';
    readonly exportHint: string;
}
export interface LaneSessionResolution {
    readonly session: LaneSessionDocument;
    readonly source: LaneSessionEnvelope['source'];
    readonly exportHint: string;
    readonly messages: readonly CommandMessage[];
    readonly envelope: LaneSessionEnvelope;
}
export interface ResolveLaneSessionInput {
    readonly cwd: string;
    readonly laneSessionId?: string | null;
    readonly actorId?: string | null;
    readonly taskId?: string | null;
    readonly command?: string | null;
    readonly now?: string;
    readonly ttlMs?: number;
}
export declare function resolveLaneSession(input: ResolveLaneSessionInput): LaneSessionResolution;
