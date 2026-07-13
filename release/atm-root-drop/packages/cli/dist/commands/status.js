import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { configPathFor, makeResult, message, parseOptions, readJsonFile, relativePathFrom } from './shared.js';
import { evaluateSeedGovernance, frameworkRepoRoot, registryFilePath, validateRegistryDocumentAgainstSchema } from './registry-shared.js';
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function stringField(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}
function stringArrayField(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (Array.isArray(value)) {
            return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
                .map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').trim());
        }
    }
    return [];
}
function classifyTeamBrokerLevel(scopePaths) {
    const normalized = scopePaths.map((entry) => entry.replace(/\\/g, '/'));
    const touchesFrameworkCore = normalized.some((entry) => (entry.startsWith('packages/core/src/') ||
        entry.startsWith('packages/cli/src/commands/next') ||
        entry.startsWith('packages/cli/src/commands/broker') ||
        entry.startsWith('packages/cli/src/commands/taskflow') ||
        entry.startsWith('packages/cli/src/commands/tasks') ||
        entry.startsWith('.atm/runtime/')));
    if (touchesFrameworkCore) {
        return {
            teamBrokerLevel: 'L5',
            teamBrokerReason: 'Touches framework runtime, broker, task lifecycle, or protected governance internals.'
        };
    }
    const touchesSharedCli = normalized.some((entry) => (entry.startsWith('packages/cli/src/') ||
        entry.startsWith('scripts/') ||
        entry.startsWith('schemas/')));
    if (touchesSharedCli) {
        return {
            teamBrokerLevel: 'L4',
            teamBrokerReason: 'Touches shared CLI, validators, schemas, or framework source surfaces.'
        };
    }
    const touchesTestsOrDocs = normalized.some((entry) => entry.startsWith('tests/') || entry.startsWith('docs/'));
    if (touchesTestsOrDocs) {
        return {
            teamBrokerLevel: 'L2',
            teamBrokerReason: 'Limited to documentation or tests.'
        };
    }
    return {
        teamBrokerLevel: 'L3',
        teamBrokerReason: 'General source scope with no protected framework-core path detected.'
    };
}
function collectWorkerDashboard(cwd, nowIso = new Date().toISOString()) {
    const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
    const nowEpoch = Date.parse(nowIso);
    const workers = [];
    if (!existsSync(lockRoot)) {
        return {
            schemaId: 'atm.activeWorkerDashboard.v1',
            generatedAt: nowIso,
            activeCount: 0,
            workers
        };
    }
    for (const entry of readdirSync(lockRoot)) {
        if (!entry.endsWith('.json'))
            continue;
        const lockPath = path.join(lockRoot, entry);
        const record = asRecord(readJsonFile(lockPath, 'ATM_STATUS_LOCK_READ_FAILED'));
        if (!record)
            continue;
        const statusRaw = stringField(record, ['status', 'state']);
        const status = statusRaw === null
            ? 'active'
            : statusRaw === 'active' || statusRaw === 'released' || statusRaw === 'handoff' || statusRaw === 'taken_over'
                ? statusRaw
                : 'unknown';
        if (status !== 'active')
            continue;
        const taskId = stringField(record, ['taskId', 'workItemId']) ?? entry.replace(/\.lock\.json$/, '').replace(/\.json$/, '');
        const actorId = stringField(record, ['actorId', 'lockedBy', 'owner']) ?? 'unknown';
        const heartbeatAt = stringField(record, ['heartbeatAt', 'updatedAt', 'lockedAt', 'createdAt']);
        const heartbeatEpoch = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
        const ttlSecondsRaw = Number(record.ttlSeconds);
        const ttlSeconds = Number.isFinite(ttlSecondsRaw) && ttlSecondsRaw > 0 ? ttlSecondsRaw : null;
        const ageSeconds = Number.isFinite(nowEpoch) && Number.isFinite(heartbeatEpoch)
            ? Math.max(0, Math.floor((nowEpoch - heartbeatEpoch) / 1000))
            : null;
        const expired = ageSeconds !== null && ttlSeconds !== null ? ageSeconds > ttlSeconds : null;
        const scopePaths = stringArrayField(record, ['files', 'scopePaths', 'paths']);
        const brokerLevel = classifyTeamBrokerLevel(scopePaths);
        workers.push({
            taskId,
            actorId,
            status,
            heartbeatAt,
            ageSeconds,
            ttlSeconds,
            expired,
            scopePaths,
            lockPath: relativePathFrom(cwd, lockPath),
            ...brokerLevel
        });
    }
    workers.sort((left, right) => {
        const leftTime = left.heartbeatAt ? Date.parse(left.heartbeatAt) : 0;
        const rightTime = right.heartbeatAt ? Date.parse(right.heartbeatAt) : 0;
        return rightTime - leftTime || left.taskId.localeCompare(right.taskId);
    });
    return {
        schemaId: 'atm.activeWorkerDashboard.v1',
        generatedAt: nowIso,
        activeCount: workers.length,
        workers
    };
}
export function runStatus(argv) {
    const { options } = parseOptions(argv, 'status');
    const configPath = configPathFor(options.cwd);
    const workerDashboard = collectWorkerDashboard(options.cwd);
    const frameworkRepository = (path.resolve(options.cwd) === frameworkRepoRoot ||
        existsSync(path.join(options.cwd, 'packages/core/seed.js'))) && existsSync(registryFilePath);
    if (frameworkRepository) {
        const registryValidation = validateRegistryDocumentAgainstSchema(options.cwd, registryFilePath, {
            commandName: 'status',
            successCode: 'ATM_STATUS_REGISTRY_OK',
            successText: 'Framework registry is valid.'
        });
        if (!registryValidation.ok) {
            return registryValidation;
        }
        const governance = evaluateSeedGovernance();
        return makeResult({
            ok: governance.ok,
            command: 'status',
            cwd: options.cwd,
            messages: [
                ...registryValidation.messages,
                governance.ok
                    ? message('info', 'ATM_STATUS_PHASE_B1_COMPLETE', 'ATM framework Phase B1 is complete.')
                    : message('error', 'ATM_STATUS_PHASE_B1_INCOMPLETE', 'ATM framework Phase B1 is not complete yet.', { issues: governance.verificationIssues })
            ],
            evidence: {
                configPath: relativePathFrom(options.cwd, configPath),
                initialized: false,
                frameworkRepository: true,
                frameworkPhase: governance.frameworkPhase,
                registryPath: relativePathFrom(options.cwd, registryFilePath),
                atomId: governance.atomId,
                atomStatus: governance.atomStatus,
                governanceTier: governance.governanceTier,
                legacyPlanningId: governance.legacyPlanningId,
                governedByLegacyPlanningId: governance.governedByLegacyPlanningId,
                selfVerificationOk: governance.selfVerificationOk,
                workerDashboard
            }
        });
    }
    if (!existsSync(configPath)) {
        return makeResult({
            ok: false,
            command: 'status',
            cwd: options.cwd,
            messages: [message('error', 'ATM_CONFIG_MISSING', 'ATM config is missing. Run atm init first.')],
            evidence: {
                configPath: relativePathFrom(options.cwd, configPath),
                initialized: false
            }
        });
    }
    const config = readJsonFile(configPath, 'ATM_CONFIG_MISSING');
    const schemaVersionOk = config.schemaVersion === 'atm.config.v0.1';
    const adapterMode = config.adapter?.mode ?? 'unknown';
    const adapterImplemented = config.adapter?.implemented === true;
    const adoptedProfile = config.adoption?.profile ?? null;
    const projectProbePath = config.adoption?.projectProbePath
        ? `${options.cwd}/${config.adoption.projectProbePath}`.replace(/\\/g, '/')
        : null;
    const projectProbe = projectProbePath && existsSync(projectProbePath)
        ? readJsonFile(projectProbePath, 'ATM_PROJECT_PROBE_MISSING')
        : null;
    return makeResult({
        ok: schemaVersionOk,
        command: 'status',
        cwd: options.cwd,
        messages: [
            schemaVersionOk
                ? message('info', 'ATM_STATUS_READY', 'ATM standalone config is ready.')
                : message('error', 'ATM_CONFIG_UNSUPPORTED_VERSION', 'ATM config schemaVersion is not supported.', { schemaVersion: config.schemaVersion })
        ],
        evidence: {
            configPath: relativePathFrom(options.cwd, configPath),
            initialized: true,
            schemaVersion: config.schemaVersion,
            adapterMode,
            adapterImplemented,
            standaloneMode: adapterMode === 'standalone' && !adapterImplemented,
            adoptedProfile,
            projectProbePath: config.adoption?.projectProbePath ?? null,
            repositoryKind: projectProbe?.repositoryKind ?? null,
            recommendedPrompt: projectProbe?.recommendedPrompt ?? null,
            workerDashboard
        }
    });
}
