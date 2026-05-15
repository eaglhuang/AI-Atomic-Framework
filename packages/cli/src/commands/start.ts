import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildLegacyRoutePlan, createGuidanceSession, decideGuidanceRoute, probeProject } from '../../../core/src/guidance/index.ts';
import type { LegacyRoutePlan } from '../../../core/src/guidance/legacy-route-plan.ts';
import { getCommandSpec } from './command-specs.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';

export async function runStart(argv: string[] = []) {
  const spec = getCommandSpec('start');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for start.', { exitCode: 2 });
  }
  const parsed = parseArgsForCommand(spec, argv);
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
  const goal = String(parsed.options.goal ?? '').trim();
  if (!goal) {
    throw new CliError('ATM_CLI_USAGE', 'start requires --goal "<goal>"', { exitCode: 2 });
  }

  const targetFileRaw = parsed.options.targetFile ? String(parsed.options.targetFile).trim() : null;
  const releaseBlockerRaw = parsed.options.releaseBlocker ? String(parsed.options.releaseBlocker).trim() : null;
  const shadowMode = Boolean(parsed.options.shadow);
  const legacyFlow = Boolean(parsed.options.legacyFlow);

  const releaseBlockerSymbols: string[] = releaseBlockerRaw
    ? releaseBlockerRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const orientation = probeProject(cwd);

  let legacyRoutePlan: LegacyRoutePlan | undefined;

  if (targetFileRaw || (legacyFlow && orientation.configLegacyHotspots.length > 0)) {
    let targetFile: string;
    let extraReleaseBlockers: string[] = [...releaseBlockerSymbols];

    if (targetFileRaw) {
      targetFile = path.isAbsolute(targetFileRaw) ? targetFileRaw : path.join(cwd, targetFileRaw);
    } else {
      const firstHotspot = orientation.configLegacyHotspots[0];
      targetFile = path.join(cwd, firstHotspot.path);
      extraReleaseBlockers = [...extraReleaseBlockers, ...firstHotspot.releaseBlockers];
    }

    if (!existsSync(targetFile)) {
      throw new CliError('ATM_CLI_TARGET_FILE_NOT_FOUND', `--target-file not found: ${targetFile}`, { exitCode: 2 });
    }

    const sourceText = readFileSync(targetFile, 'utf8');
    const targetFileRelative = path.relative(cwd, targetFile).replace(/\\/g, '/');

    legacyRoutePlan = await buildLegacyRoutePlan({
      sourceText,
      targetFile: targetFileRelative,
      releaseBlockerSymbols: extraReleaseBlockers,
      noTouchZones: orientation.noTouchZones.map((z) => z.path)
    });
  }

  const routeDecision = decideGuidanceRoute({
    goal,
    orientation,
    evidence: legacyRoutePlan ? { legacyRoutePlan } : undefined
  });
  const session = createGuidanceSession({
    repositoryRoot: cwd,
    goal,
    orientation,
    routeDecision,
    actor: String(parsed.options.actor ?? 'ATM CLI'),
    legacyRoutePlan,
    shadowMode: shadowMode || undefined
  });

  return makeResult({
    ok: true,
    command: 'start',
    cwd,
    messages: [message('info', 'ATM_GUIDANCE_SESSION_STARTED', 'Guidance session started.', { sessionId: session.sessionId })],
    evidence: {
      sessionId: session.sessionId,
      routeDecision,
      guidancePacket: session.packet,
      legacyRoutePlan: session.legacyRoutePlan,
      shadowMode: session.shadowMode ?? false,
      session
    }
  });
}
