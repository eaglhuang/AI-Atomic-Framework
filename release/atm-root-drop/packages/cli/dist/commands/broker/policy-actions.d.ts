import type { BrokerCommandContext } from './types.ts';
import type { ParsedBrokerOptions } from './parser.ts';
export declare function handleBrokerParallelAdmissionPolicy(options: ParsedBrokerOptions, _context: BrokerCommandContext): import("../shared.ts").CommandResult | null;
