import { parseRouteArgs } from './parser.js';
import { runLifecycleRoute } from './lifecycle.js';
import { runTakeover } from './takeover.js';
export async function runRoute(argv) {
    const options = parseRouteArgs(argv);
    if (options.action === 'takeover') {
        return runTakeover(options);
    }
    return runLifecycleRoute(options);
}
