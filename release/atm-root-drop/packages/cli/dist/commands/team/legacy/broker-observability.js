import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createBrokerConflictResolutionArtifact } from '../../../../../core/dist/team-runtime/permission-broker.js';
import { buildTeamObservabilityContract, createBrokerConflictObservabilityEvents, queryTeamObservabilityEvents } from '../../../../../core/dist/team-runtime/observability.js';
import { CliError, makeResult, message } from '../../shared.js';
import { runtimeBackendAdmissionForTeam } from '../team-execution-lane.js';
import { listTeamRuns, readTeamRun, teamRunsDirectory } from './team-run-store.js';
export function buildBrokerConflictSharedVocabulary(brokerLane) {
    if (brokerLane.safeToStart) {
        return null;
    }
    const firstReason = brokerLane.blockedReasons[0] ?? 'Team Broker did not grant start authority.';
    return {
        decisionClass: 'blocked',
        decisionReason: firstReason.includes('broker-conflict-blocked')
            ? firstReason
            : `broker-conflict-blocked: ${firstReason}`,
        violationStatus: 'broker-conflict-blocked',
        statusCode: 'broker-conflict-blocked'
    };
}
export function evaluateTeamRuntimeBackendAdmission(runtimeContract, readiness) {
    return runtimeBackendAdmissionForTeam({
        runtimeMode: runtimeContract.runtimeMode,
        providerId: runtimeContract.providerId,
        executionSurface: runtimeContract.executionSurface,
        capabilities: readiness.capabilities
    });
}
export function buildBrokerConflictUxProjection(input) {
    const primaryTaskId = String(input.primaryTaskId ?? '').trim();
    const conflictingTaskIds = uniqueStrings(input.conflictingTaskIds.map((entry) => String(entry).trim()).filter(Boolean));
    const sharedPaths = uniqueStrings((input.sharedPaths ?? []).map((entry) => String(entry).trim()).filter(Boolean));
    const overlappingAtomIds = uniqueStrings((input.overlappingAtomIds ?? []).map((entry) => String(entry).trim()).filter(Boolean));
    const currentAllowedTaskId = input.currentAllowedTaskId ?? primaryTaskId;
    const blockedTaskIds = uniqueStrings((input.blockedTaskIds?.length ? input.blockedTaskIds : conflictingTaskIds)
        .map((entry) => String(entry).trim())
        .filter(Boolean));
    const decisionReason = String(input.decisionReason ?? '').trim()
        || 'broker-conflict-blocked until the release order grants the next task.';
    const nextSafeResolutionCommand = input.requiredCommand?.trim()
        || `node atm.mjs team broker resolve --task ${primaryTaskId} --conflict ${conflictingTaskIds[0] ?? '<task-id>'} --path ${sharedPaths[0] ?? '<shared-path>'} --decision-reason "broker-conflict-blocked until the release order grants the next task." --json`;
    return {
        schemaId: 'atm.brokerConflictUx.v1',
        playbookSlice: 'broker-conflict-resolution',
        requiredResolutionArtifact: 'atm.brokerConflictResolution.v1',
        decisionClass: input.decisionClass,
        decisionReason,
        violationStatus: input.violationStatus,
        statusCode: input.statusCode ?? input.violationStatus,
        primaryTaskId,
        conflictingTaskIds,
        blockedTaskIds,
        currentAllowedTaskId,
        sharedPaths,
        overlappingAtomIds,
        nextSafeResolutionCommand,
        captainGuidance: [
            'Stop write progression while violationStatus is broker-conflict-blocked.',
            'Use the nextSafeResolutionCommand to produce an atm.brokerConflictResolution.v1 artifact.',
            'Do not hand-edit .atm/runtime/** to clear or reorder the conflict.'
        ]
    };
}
export function runTeamBroker(argv, defaultCwd) {
    const action = String(argv[0] ?? '').toLowerCase();
    if (!['resolve', 'conflict-resolve'].includes(action)) {
        throw new CliError('ATM_CLI_USAGE', 'team broker supports: resolve', { exitCode: 2 });
    }
    return runTeamBrokerConflictResolve(argv.slice(1), defaultCwd);
}
export function runTeamObservability(argv, defaultCwd) {
    const action = String(argv[0] ?? '').toLowerCase();
    if (action !== 'query') {
        throw new CliError('ATM_CLI_USAGE', 'team observability supports: query', { exitCode: 2 });
    }
    const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? defaultCwd);
    const fixture = readOptionValue(argv, '--fixture')?.trim() ?? null;
    const filters = {
        taskId: readOptionValue(argv, '--task-filter') ?? readOptionValue(argv, '--task'),
        teamRunId: readOptionValue(argv, '--team-run-filter') ?? readOptionValue(argv, '--team-run'),
        providerId: readOptionValue(argv, '--provider-filter') ?? readOptionValue(argv, '--provider'),
        role: readOptionValue(argv, '--role-filter') ?? readOptionValue(argv, '--role'),
        artifactType: readOptionValue(argv, '--artifact') ?? readOptionValue(argv, '--artifact-type'),
        eventType: readOptionValue(argv, '--event-type')
    };
    if (!fixture) {
        const events = readTeamRuntimeObservabilityEvents(cwd, readOptionValue(argv, '--team-run'));
        const query = queryTeamObservabilityEvents(events, filters);
        return makeResult({
            ok: true,
            command: 'team observability query',
            mode: 'standalone',
            cwd,
            messages: [
                message('info', 'ATM_TEAM_OBSERVABILITY_QUERY_READY', 'Team observability query returned runtime event records.', {
                    eventCount: query.eventCount,
                    filters: query.filters
                })
            ],
            evidence: {
                action: 'observability.query',
                dryRun: true,
                fixture: null,
                eventSource: 'runtime',
                contract: buildTeamObservabilityContract(),
                query
            }
        });
    }
    if (fixture !== 'broker-conflict-resolution') {
        throw new CliError('ATM_TEAM_OBSERVABILITY_FIXTURE_UNSUPPORTED', `Unsupported team observability fixture: ${fixture}`, { exitCode: 2 });
    }
    const emittedAt = readOptionValue(argv, '--emitted-at') ?? '2026-07-10T00:00:00.000Z';
    const primaryTaskId = String(readOptionValue(argv, '--task') ?? 'TASK-TEAM-0040').trim();
    const conflictingTaskIds = readOptionValues(argv, '--conflict');
    const sharedPaths = readOptionValues(argv, '--path');
    const artifact = createBrokerConflictResolutionArtifact({
        primaryTaskId,
        conflictingTaskIds: conflictingTaskIds.length > 0 ? conflictingTaskIds : ['TASK-TEAM-0047'],
        sharedPaths: sharedPaths.length > 0 ? sharedPaths : ['packages/cli/src/commands/team.ts'],
        decisionClass: normalizeBrokerDecisionClass(readOptionValue(argv, '--decision-class')),
        decisionReason: readOptionValue(argv, '--decision-reason')
            ?? 'broker-conflict-blocked until the release order grants the next task.',
        violationStatus: normalizeBrokerViolationStatus(readOptionValue(argv, '--violation-status')),
        releaseOrder: readOptionValues(argv, '--release-order'),
        createdAt: emittedAt
    });
    const providerId = String(readOptionValue(argv, '--provider') ?? 'openai').trim();
    const role = String(readOptionValue(argv, '--role') ?? 'coordinator').trim();
    const teamRunId = readOptionValue(argv, '--team-run') ?? `team-observability-${artifact.resolutionId.toLowerCase()}`;
    const events = createBrokerConflictObservabilityEvents({
        artifact,
        providerId,
        role,
        teamRunId,
        emittedAt
    });
    const query = queryTeamObservabilityEvents(events, filters);
    return makeResult({
        ok: true,
        command: 'team observability query',
        mode: 'standalone',
        cwd,
        messages: [
            message('info', 'ATM_TEAM_OBSERVABILITY_QUERY_READY', 'Team observability query returned shared event records.', {
                eventCount: query.eventCount,
                filters: query.filters
            })
        ],
        evidence: {
            action: 'observability.query',
            dryRun: true,
            fixture,
            eventSource: 'fixture',
            contract: buildTeamObservabilityContract(),
            artifact,
            query
        }
    });
}
function readTeamRuntimeObservabilityEvents(cwd, requestedTeamRunId) {
    const runIds = requestedTeamRunId?.trim()
        ? [requestedTeamRunId.trim()]
        : listTeamRuns(cwd).map((run) => String(run.teamRunId ?? '')).filter(Boolean);
    const events = [];
    for (const teamRunId of runIds) {
        const runDir = path.join(teamRunsDirectory(cwd), teamRunId);
        const jsonlPath = path.join(runDir, 'observability-events.jsonl');
        if (existsSync(jsonlPath)) {
            for (const line of readFileSync(jsonlPath, 'utf8').split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed?.schemaId === 'atm.teamAgentObservabilityEvent.v1') {
                        events.push(parsed);
                    }
                }
                catch {
                    // Ignore malformed runtime event lines; validators can flag corruption separately.
                }
            }
        }
        const run = existsSync(path.join(teamRunsDirectory(cwd), `${teamRunId}.json`))
            ? readTeamRun(cwd, teamRunId)
            : null;
        const embedded = Array.isArray(run?.observabilityEvents) ? run.observabilityEvents : [];
        for (const event of embedded) {
            if (event?.schemaId === 'atm.teamAgentObservabilityEvent.v1') {
                events.push(event);
            }
        }
    }
    const seen = new Set();
    return events.filter((event) => {
        if (seen.has(event.eventId))
            return false;
        seen.add(event.eventId);
        return true;
    });
}
export function runTeamBrokerConflictResolve(argv, defaultCwd) {
    const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? defaultCwd);
    const primaryTaskId = readOptionValue(argv, '--task')?.trim();
    if (!primaryTaskId) {
        throw new CliError('ATM_TEAM_BROKER_RESOLVE_TASK_REQUIRED', 'team broker resolve requires --task <id>.', { exitCode: 2 });
    }
    const conflictingTaskIds = readOptionValues(argv, '--conflict');
    if (conflictingTaskIds.length === 0) {
        throw new CliError('ATM_TEAM_BROKER_RESOLVE_CONFLICT_REQUIRED', 'team broker resolve requires at least one --conflict <task-id>.', { exitCode: 2 });
    }
    const sharedPaths = readOptionValues(argv, '--path');
    if (sharedPaths.length === 0) {
        throw new CliError('ATM_TEAM_BROKER_RESOLVE_PATH_REQUIRED', 'team broker resolve requires at least one --path <file>.', { exitCode: 2 });
    }
    const decisionReason = readOptionValue(argv, '--decision-reason')?.trim()
        ?? 'Broker conflict blocked; tasks must consume the release order one at a time.';
    const decisionClass = normalizeBrokerDecisionClass(readOptionValue(argv, '--decision-class'));
    const violationStatus = normalizeBrokerViolationStatus(readOptionValue(argv, '--violation-status'));
    const releaseOrder = readOptionValues(argv, '--release-order');
    const createdAt = readOptionValue(argv, '--created-at')?.trim();
    const artifact = createBrokerConflictResolutionArtifact({
        primaryTaskId,
        conflictingTaskIds,
        sharedPaths,
        decisionClass,
        decisionReason,
        violationStatus,
        releaseOrder: releaseOrder.length ? releaseOrder : undefined,
        createdAt
    });
    const requestedOutput = readOptionValue(argv, '--output')?.trim();
    const artifactPath = requestedOutput
        ? path.resolve(cwd, requestedOutput)
        : path.join(cwd, '.atm', 'runtime', 'broker-conflict-resolutions', `${artifact.resolutionId}.json`);
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    const conflictUx = buildBrokerConflictUxProjection({
        primaryTaskId: artifact.primaryTaskId,
        conflictingTaskIds: artifact.conflictingTaskIds,
        sharedPaths: artifact.sharedPaths,
        decisionClass: artifact.decisionClass,
        decisionReason: artifact.decisionReason,
        violationStatus: artifact.violationStatus,
        statusCode: artifact.statusCode,
        currentAllowedTaskId: artifact.currentAllowedTaskId,
        blockedTaskIds: artifact.blockedTaskIds,
        requiredCommand: `node atm.mjs team broker resolve --task ${artifact.primaryTaskId} ${artifact.conflictingTaskIds.map((taskId) => `--conflict ${taskId}`).join(' ')} ${artifact.sharedPaths.map((sharedPath) => `--path ${sharedPath}`).join(' ')} --decision-reason "${artifact.decisionReason}" --json`
    });
    return makeResult({
        ok: true,
        command: 'team',
        cwd,
        messages: [
            message('info', 'ATM_TEAM_BROKER_CONFLICT_RESOLUTION_READY', 'Team Broker conflict resolution artifact generated.', {
                resolutionId: artifact.resolutionId,
                decisionClass: artifact.decisionClass,
                violationStatus: artifact.violationStatus,
                statusCode: artifact.statusCode,
                currentAllowedTaskId: artifact.currentAllowedTaskId,
                blockedTaskIds: artifact.blockedTaskIds,
                sharedPaths: artifact.sharedPaths,
                decisionReason: artifact.decisionReason,
                requiredResolutionArtifact: conflictUx.requiredResolutionArtifact,
                nextSafeResolutionCommand: conflictUx.nextSafeResolutionCommand
            })
        ],
        evidence: {
            action: 'broker.resolve',
            dryRun: false,
            runtimeWritten: true,
            agentsSpawned: false,
            artifact,
            artifactPath: path.relative(cwd, artifactPath).replace(/\\/g, '/'),
            conflictUx,
            sharedVocabulary: {
                decisionClass: artifact.decisionClass,
                decisionReason: artifact.decisionReason,
                violationStatus: artifact.violationStatus,
                statusCode: artifact.statusCode
            }
        }
    });
}
function readOptionValue(argv, flag) {
    const index = argv.indexOf(flag);
    if (index < 0) {
        return undefined;
    }
    return argv[index + 1];
}
function readOptionValues(argv, flag) {
    const values = [];
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] !== flag)
            continue;
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            continue;
        values.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
    }
    return [...new Set(values)];
}
function normalizeBrokerDecisionClass(value) {
    const normalized = value?.trim();
    if (normalized === 'serial-release'
        || normalized === 'human-signoff-required'
        || normalized === 'adr-required'
        || normalized === 'blocked') {
        return normalized;
    }
    return 'serial-release';
}
function normalizeBrokerViolationStatus(value) {
    const normalized = value?.trim();
    if (normalized === 'broker-conflict-blocked'
        || normalized === 'resolution-issued'
        || normalized === 'resolved') {
        return normalized;
    }
    return 'broker-conflict-blocked';
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}
