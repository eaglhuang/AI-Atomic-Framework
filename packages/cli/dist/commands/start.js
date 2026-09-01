import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildLegacyRoutePlan, createGuidanceSession, decideGuidanceRoute, probeProject } from '../../../core/dist/guidance/index.js';
import { getCommandSpec } from './command-specs.js';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.js';
export async function runStart(argv = []) {
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
    const releaseBlockerSymbols = releaseBlockerRaw
        ? releaseBlockerRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const orientation = probeProject(cwd);
    let legacyRoutePlan;
    if (targetFileRaw || (legacyFlow && orientation.configLegacyHotspots.length > 0)) {
        let targetFile;
        let extraReleaseBlockers = [...releaseBlockerSymbols];
        let configHotspot = targetFileRaw
            ? orientation.configLegacyHotspots.find((entry) => entry.path === targetFileRaw.replace(/\\/g, '/'))
            : undefined;
        if (targetFileRaw) {
            targetFile = path.isAbsolute(targetFileRaw) ? targetFileRaw : path.join(cwd, targetFileRaw);
        }
        else {
            const firstHotspot = orientation.configLegacyHotspots[0];
            configHotspot = firstHotspot;
            targetFile = path.join(cwd, firstHotspot.path);
            extraReleaseBlockers = [...extraReleaseBlockers, ...firstHotspot.releaseBlockers];
        }
        if (!existsSync(targetFile)) {
            throw new CliError('ATM_CLI_TARGET_FILE_NOT_FOUND', `--target-file not found: ${targetFile}`, { exitCode: 2 });
        }
        const sourceText = readFileSync(targetFile, 'utf8');
        const targetFileRelative = path.relative(cwd, targetFile).replace(/\\/g, '/');
        const configEvidence = loadConfigHotspotEvidence(cwd, configHotspot);
        legacyRoutePlan = await buildLegacyRoutePlan({
            sourceText,
            targetFile: targetFileRelative,
            releaseBlockerSymbols: extraReleaseBlockers,
            noTouchZones: orientation.noTouchZones.map((z) => z.path),
            existingAtomMatches: configEvidence.existingAtomMatches,
            callerDistribution: configEvidence.callerDistribution,
            demandThreshold: configEvidence.demandThreshold
        });
    }
    const effectiveShadowMode = shadowMode || (legacyFlow && orientation.defaultLegacyFlow === 'shadow');
    const effectiveLegacyFlow = legacyFlow
        ? (effectiveShadowMode ? 'shadow' : 'dry-run')
        : null;
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
        shadowMode: effectiveShadowMode || undefined
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
            effectiveLegacyFlow,
            session
        }
    });
}
function loadConfigHotspotEvidence(cwd, hotspot) {
    const atomIndex = readJsonIfExists(hotspot?.existingAtomIndexPath ? path.join(cwd, hotspot.existingAtomIndexPath) : null);
    const demandReport = readJsonIfExists(hotspot?.demandReportPath ? path.join(cwd, hotspot.demandReportPath) : null);
    const matches = Array.isArray(atomIndex?.matches) ? atomIndex.matches : [];
    const existingAtomMatches = matches.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null)
            return [];
        const candidate = entry;
        if (typeof candidate.symbolName !== 'string' || typeof candidate.atomId !== 'string')
            return [];
        return [{ symbolName: candidate.symbolName, atomId: candidate.atomId }];
    });
    const callerDistribution = typeof demandReport?.callerDistribution === 'object' && demandReport.callerDistribution !== null
        ? demandReport.callerDistribution
        : undefined;
    const demandThreshold = typeof demandReport?.demandThreshold === 'number'
        ? demandReport.demandThreshold
        : undefined;
    return { existingAtomMatches, callerDistribution, demandThreshold };
}
function readJsonIfExists(filePath) {
    if (!filePath || !existsSync(filePath))
        return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
