import { createValidateCliContext, formatDuration, parseOptions, scrubAmbientEnvironment } from './context.ts';
import { runFullSuite } from './full-suite.ts';
import { runSurfaceSuite } from './surface-suite.ts';

export async function runValidateCli(argv: string[]) {
  const options = parseOptions(argv);
  scrubAmbientEnvironment();
  const ctx = createValidateCliContext(options);
  try {
    await runSurfaceSuite(ctx);
    if (!ctx.fastOnly && !ctx.surfaceOnly) {
      await runFullSuite(ctx);
    }
  } finally {
    clearInterval(ctx.progressHeartbeat);
  }
  if (!process.exitCode) {
    const label = ctx.fastOnly ? 'fast' : ctx.surfaceOnly ? 'surface' : 'validate';
    const commandCount = Array.isArray(ctx.fixture.commands) ? ctx.fixture.commands.length : ctx.publicCommandNames.length;
    console.log(`[cli:${ctx.mode}] ok ${label} (${commandCount} commands, ${formatDuration(Date.now() - ctx.startedAt)})`);
  }
}
