import type { ParsedBrokerOptions } from './parser.ts';
export declare function validateProposalLaneDurableRef(filePath: string): {
    readonly ok: boolean;
    readonly reason: string;
};
export declare function handleBrokerProposalActions(options: ParsedBrokerOptions): import("../shared.ts").CommandResult | null;
