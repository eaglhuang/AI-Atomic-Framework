import type { BrokerCommandContext } from './types.ts';
import type { ParsedBrokerOptions } from './parser.ts';
export declare function handleBrokerRegistryActions(options: ParsedBrokerOptions, context: BrokerCommandContext): import("../shared.ts").CommandResult | null;
