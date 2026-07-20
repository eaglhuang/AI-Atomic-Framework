/**
 * ATM CLI: registry-diff
 *
 * Usage: atm registry-diff <atomId> --from <v1> --to <v2> [--json] [--registry <path>] [--reason <text>]
 */
import { computeHashDiffReport, loadRegistryDocument, resolveRegistryDiffTarget } from '../../../core/dist/registry/diff.js';
import { makeResult, message } from './shared.js';
function parseArgs(args) {
    const parsed = {
        atomId: null,
        fromVersion: null,
        toVersion: null,
        registryPath: null,
        driftReason: null,
        json: false
    };
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--from' && i + 1 < args.length) {
            parsed.fromVersion = args[++i];
        }
        else if (arg === '--to' && i + 1 < args.length) {
            parsed.toVersion = args[++i];
        }
        else if (arg === '--registry' && i + 1 < args.length) {
            parsed.registryPath = args[++i];
        }
        else if (arg === '--reason' && i + 1 < args.length) {
            parsed.driftReason = args[++i];
        }
        else if (arg === '--json') {
            parsed.json = true;
        }
        else if (!arg.startsWith('-') && !parsed.atomId) {
            parsed.atomId = arg;
        }
        i++;
    }
    return parsed;
}
export function runRegistryDiff(args) {
    const cwd = process.cwd();
    const parsed = parseArgs(args);
    if (!parsed.atomId) {
        return makeResult({
            ok: false,
            command: 'registry-diff',
            cwd,
            messages: [message('error', 'ATM_DIFF_MISSING_ATOM_ID', 'Missing required argument: atomId. Usage: atm registry-diff <atomId> --from <v1> --to <v2>')],
            evidence: {}
        });
    }
    if (!parsed.fromVersion || !parsed.toVersion) {
        return makeResult({
            ok: false,
            command: 'registry-diff',
            cwd,
            messages: [message('error', 'ATM_DIFF_MISSING_VERSIONS', 'Missing required flags: --from <version> --to <version>')],
            evidence: {}
        });
    }
    let registryDoc;
    try {
        registryDoc = loadRegistryDocument(parsed.registryPath);
    }
    catch (error) {
        return makeResult({
            ok: false,
            command: 'registry-diff',
            cwd,
            messages: [message('error', 'ATM_DIFF_REGISTRY_NOT_FOUND', error instanceof Error ? error.message : String(error))],
            evidence: {}
        });
    }
    const resolution = resolveRegistryDiffTarget(registryDoc, parsed.atomId);
    if (!resolution.ok) {
        return makeResult({
            ok: false,
            command: 'registry-diff',
            cwd,
            messages: [message('error', resolution.code, resolution.summary, {
                    advisory: resolution.advisory,
                    atomId: parsed.atomId,
                    candidateMapIds: resolution.details.candidateMapIds,
                    candidateMemberPaths: resolution.details.candidateMemberPaths,
                    requiredContract: resolution.details.requiredContract
                })],
            evidence: {
                atomId: parsed.atomId,
                fromVersion: parsed.fromVersion,
                toVersion: parsed.toVersion,
                resolution,
                registryPath: parsed.registryPath ?? null
            }
        });
    }
    const entry = resolution.entry;
    let report;
    try {
        report = computeHashDiffReport({
            entry: {
                ...entry,
                versions: [...entry.versions]
            },
            fromVersion: parsed.fromVersion,
            toVersion: parsed.toVersion,
            driftReason: parsed.driftReason ?? undefined
        });
    }
    catch (error) {
        return makeResult({
            ok: false,
            command: 'registry-diff',
            cwd,
            messages: [message('error', 'ATM_DIFF_COMPUTE_FAILED', error instanceof Error ? error.message : String(error))],
            evidence: {
                atomId: parsed.atomId,
                fromVersion: parsed.fromVersion,
                toVersion: parsed.toVersion,
                resolution
            }
        });
    }
    const summaryText = report.driftSummary.totalChanged === 0
        ? `No hash drift between ${parsed.fromVersion} and ${parsed.toVersion}.`
        : `Hash drift detected: ${report.driftSummary.changedFields.join(', ')} changed between ${parsed.fromVersion} and ${parsed.toVersion}.`;
    return makeResult({
        ok: true,
        command: 'registry-diff',
        cwd,
        messages: [message('info', 'ATM_DIFF_OK', summaryText)],
        evidence: {
            report,
            atomId: parsed.atomId,
            fromVersion: parsed.fromVersion,
            toVersion: parsed.toVersion,
            totalChanged: report.driftSummary.totalChanged,
            sourceKind: entry.sourceKind,
            sourceRef: entry.sourceRef ?? null,
            mapId: entry.mapId ?? null,
            memberIndex: entry.memberIndex ?? null
        }
    });
}
