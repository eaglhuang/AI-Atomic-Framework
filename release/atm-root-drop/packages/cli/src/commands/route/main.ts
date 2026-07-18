import { parseRouteArgs } from './parser.ts';
import { runLifecycleRoute } from './lifecycle.ts';
import { runTakeover } from './takeover.ts';

export async function runRoute(argv: string[]) {
  const options = parseRouteArgs(argv);

  if (options.action === 'takeover') {
    return runTakeover(options);
  }

  return runLifecycleRoute(options);
}

