import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runBroker } from '../broker.js';
import { CliError } from '../shared.js';
import { describeMissingGitBase } from '../shared/git-base-remediation.js';
import { prepareTaskForClaim } from '../tasks/public-surface.js';
import { projectGovernanceSharedSurfacesFromPaths } from '../../_vendor/core/dist/broker/global-resource-projection.js';
import { normalizeTaskRouteStatus } from './intent-normalizers.js';
import { reserveDerivedAtoms } from '../shared/derived-atom-occupancy.js';
export async function prepareImportedTaskForClaim(input) {
    const normalizedStatus = normalizeTaskRouteStatus(input.task.status);
    const prepared = prepareTaskForClaim({
        cwd: input.cwd,
        taskId: input.task.workItemId,
        actorId: input.actorId,
        status: input.task.status,
        title: input.task.title,
        transitionCommand: `node atm.mjs next --claim --task ${input.task.workItemId} --actor ${input.actorId} --auto-intent --json`
    });
    return {
        taskId: input.task.workItemId,
        originalStatus: normalizedStatus,
        steps: prepared.steps.map((step) => ({
            action: step.action,
            evidence: {
                action: step.action,
                taskId: input.task.workItemId,
                actorId: input.actorId,
                status: step.status,
                transitionPath: step.transitionPath,
                importEvidencePath: step.importEvidencePath ?? null
            }
        }))
    };
}
export async function registerPreClaimBrokerTransaction(input) {
    const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: input.cwd, encoding: 'utf8' });
    const baseCommit = head.status === 0 ? head.stdout.trim() : '';
    if (!baseCommit) {
        throw new CliError('ATM_BROKER_TRANSACTION_BASE_MISSING', 'next --claim requires a resolvable HEAD before registering its Broker transaction.', { exitCode: 1, details: describeMissingGitBase(input.cwd).details });
    }
    const derivedAtomReservation = (input.atoms ?? []).length > 0
        ? reserveDerivedAtoms({ cwd: input.cwd, baseCommit, targetFiles: input.targetFiles, symbols: input.atoms ?? [] })
        : null;
    const intent = buildPreClaimWriteIntent({
        taskId: input.taskId,
        actorId: input.actorId,
        baseCommit,
        targetFiles: input.targetFiles,
        atomRefs: derivedAtomReservation?.refs ?? []
    });
    const intentPath = path.join(input.cwd, '.atm', 'runtime', 'broker-intents', `${input.taskId}.json`);
    mkdirSync(path.dirname(intentPath), { recursive: true });
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
    const result = await runBroker([
        'register', '--cwd', input.cwd, '--task', input.taskId, '--actor', input.actorId, '--intent-file', intentPath
    ]);
    const evidence = result && typeof result === 'object' && 'evidence' in result
        ? result.evidence
        : null;
    const admission = evidence?.admission;
    // Empty legacy claim metadata carries no file-write authority. A native ticket,
    // including an owner/scope mismatch, must still block that metadata-only route.
    const metadataOnly = intent.targetFiles.length === 0 && !admission?.ticket?.queue;
    if (admission?.disposition === 'queue' || (admission?.disposition === 'revalidate' && !metadataOnly)) {
        throw new CliError('ATM_NEXT_CLAIM_BLOCKED', admission.decisionReason ?? 'Native broker ticket must be revalidated before task claim.', {
            exitCode: 1, details: { taskId: input.taskId, brokerAdmission: admission,
                requiredCommand: evidence?.resumeCommand ?? 'node atm.mjs broker status --json', writeAuthorized: false }
        });
    }
    const queueAdmission = evidence?.queueAdmission;
    if (!queueAdmission || typeof queueAdmission !== 'object' || !('status' in queueAdmission)) {
        throw new CliError('ATM_BROKER_TRANSACTION_INVALID', 'Broker pre-claim registration returned no canonical queue admission.', { exitCode: 1 });
    }
    return {
        intentPath: path.relative(input.cwd, intentPath).replace(/\\/g, '/'),
        baseCommit,
        queueAdmission,
        brokerDecision: evidence.decision ?? null,
        ...(derivedAtomReservation ? {
            derivedAtomReservation: {
                resolved: derivedAtomReservation.resolved,
                unresolved: derivedAtomReservation.unresolved,
                staleFormalFiles: derivedAtomReservation.staleFormalFiles,
                note: 'Reserved atoms are an intent ceiling; the staged diff confirms final occupancy at commit time. Unresolved symbols (new code) are confirmed when committed.'
            }
        } : {})
    };
}
export function buildPreClaimWriteIntent(input) {
    const targetFiles = [...new Set(input.targetFiles.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))].sort();
    return {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'next pre-claim Broker transaction' },
        taskId: input.taskId,
        actorId: input.actorId,
        baseCommit: input.baseCommit,
        targetFiles,
        atomRefs: [...(input.atomRefs ?? [])],
        sharedSurfaces: projectGovernanceSharedSurfacesFromPaths(targetFiles),
        requestedLane: 'auto'
    };
}
