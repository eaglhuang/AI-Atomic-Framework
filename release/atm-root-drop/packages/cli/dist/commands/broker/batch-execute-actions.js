import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CliError, makeResult, message } from '../shared.js';
import { planWaveBrokerBatch } from '../../../../core/dist/broker/wave-broker-scheduler.js';
import { planSharedDeliveryCommit } from '../../../../core/dist/broker/shared-delivery-commit.js';
import { SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID } from '../../../../core/dist/broker/shared-write-provenance-policy.js';
import { planSharedDeliverySaga } from '../../../../core/dist/broker/shared-delivery-saga.js';
import { planWaveGeneratedWrite } from '../../../../core/dist/broker/wave-generated-executor.js';
import { assertRecordCommitPayloadPresent } from '../git-governance/record-commit-payload-assertion.js';
function readJson(pathName) {
    if (!existsSync(pathName)) {
        throw new CliError('ATM_BROKER_SCHEDULER_MISSING', `Wave broker scheduler document does not exist: ${pathName}`, { exitCode: 2 });
    }
    return JSON.parse(readFileSync(pathName, 'utf8'));
}
/**
 * A batch file is a shared canonical write when two or more member tasks claim
 * it. Cardinality is the only rule; no task, actor, or path is special-cased.
 */
function buildSharedDeliveryProvenance(input) {
    const claimsByFile = new Map();
    for (const [taskId, files] of Object.entries(input.fileSlices)) {
        for (const file of files) {
            const existing = claimsByFile.get(file) ?? new Set();
            existing.add(taskId);
            claimsByFile.set(file, existing);
        }
    }
    const observedFiles = [];
    for (const [file, taskIds] of claimsByFile) {
        if (taskIds.size < 2)
            continue;
        observedFiles.push({
            path: file,
            writeClaimTaskIds: [...taskIds].sort(),
            stagedBlobDigest: readStagedBlobDigest(input.cwd, file)
        });
    }
    if (observedFiles.length === 0)
        return null;
    return {
        canonicalRoot: input.cwd,
        baseSha: input.sealedBaseSha,
        headSha: input.headSha,
        observedFiles,
        receipts: readSharedWriteProvenanceReceipts(input.cwd)
    };
}
function readStagedBlobDigest(cwd, file) {
    const result = spawnSync('git', ['rev-parse', `:${file}`], { cwd, encoding: 'utf8' });
    const value = result.status === 0 ? result.stdout.trim() : '';
    return value.length > 0 ? `git-blob:${value}` : null;
}
function readSharedWriteProvenanceReceipts(cwd) {
    const evidenceDir = path.join(cwd, '.atm', 'history', 'evidence');
    if (!existsSync(evidenceDir))
        return [];
    const receipts = [];
    for (const entry of readdirSync(evidenceDir)) {
        if (!entry.toLowerCase().endsWith('.shared-write-provenance.json'))
            continue;
        try {
            const document = JSON.parse(readFileSync(path.join(evidenceDir, entry), 'utf8'));
            if (document?.schemaId === SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID)
                receipts.push(document);
        }
        catch {
            // Unreadable evidence is not admission proof; the verifier fails closed.
        }
    }
    return receipts;
}
function currentHead(cwd) {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
    if (result.status !== 0) {
        throw new CliError('ATM_BROKER_BATCH_HEAD_UNAVAILABLE', 'Unable to resolve current HEAD for shared delivery commit executor.', {
            exitCode: 2,
            details: { stderr: result.stderr }
        });
    }
    return result.stdout.trim();
}
function runGit(cwd, args, env = {}) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0) {
        throw new CliError('ATM_BROKER_BATCH_COMMIT_BLOCKED', `git ${args.join(' ')} failed while executing shared delivery commit.`, {
            exitCode: 1,
            details: { args, stdout: result.stdout, stderr: result.stderr }
        });
    }
    return result.stdout.trim();
}
function runGitWithPathspecStdin(cwd, args, files, env = {}) {
    const pathspec = uniqueSorted(files).join('\0') + '\0';
    const result = spawnSync('git', [...args, '--pathspec-from-file=-', '--pathspec-file-nul'], {
        cwd,
        input: pathspec,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    if (result.status !== 0) {
        throw new CliError('ATM_BROKER_BATCH_COMMIT_BLOCKED', `git ${args.join(' ')} failed while executing shared delivery commit.`, {
            exitCode: 1,
            details: { args, stdout: result.stdout, stderr: result.stderr }
        });
    }
    return result.stdout.trim();
}
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
function executeTemporaryIndexCommit(input) {
    const files = uniqueSorted(input.files);
    if (files.length === 0) {
        throw new CliError('ATM_BROKER_BATCH_COMMIT_BLOCKED', 'Shared delivery commit apply requires at least one payload file.', {
            exitCode: 1,
            details: { taskIds: input.taskIds }
        });
    }
    const env = { GIT_INDEX_FILE: input.temporaryIndexPath };
    runGit(input.cwd, ['read-tree', input.expectedHeadSha], env);
    runGitWithPathspecStdin(input.cwd, ['add', '-A', '-f'], files, env);
    const treeSha = runGit(input.cwd, ['write-tree'], env);
    const headTreeSha = runGit(input.cwd, ['rev-parse', `${input.expectedHeadSha}^{tree}`]);
    if (treeSha === headTreeSha) {
        throw new CliError('ATM_BROKER_BATCH_COMMIT_BLOCKED', 'Shared delivery commit payload produced no tree changes.', {
            exitCode: 1,
            details: { taskIds: input.taskIds, files }
        });
    }
    const commitSha = runGit(input.cwd, [
        'commit-tree',
        treeSha,
        '-p',
        input.expectedHeadSha,
        '-m',
        `shared-delivery: commit ${input.taskIds.join(', ')}`
    ], {
        ...env,
        GIT_AUTHOR_NAME: input.actorId,
        GIT_AUTHOR_EMAIL: `${input.actorId}@atm.local`,
        GIT_COMMITTER_NAME: input.actorId,
        GIT_COMMITTER_EMAIL: `${input.actorId}@atm.local`
    });
    runGit(input.cwd, ['update-ref', 'HEAD', commitSha, input.expectedHeadSha]);
    return {
        commitSha,
        payloadAssertion: assertRecordCommitPayloadPresent({
            cwd: input.cwd,
            commitSha,
            expectedStagedFiles: files
        })
    };
}
function parseFileSlices(entries, fallbackTasks, fallbackFiles) {
    const slices = {};
    for (const entry of entries) {
        const separator = entry.indexOf(':');
        if (separator <= 0) {
            throw new CliError('ATM_CLI_USAGE', '--file-slice must use TASK-ID:path/to/file format.', { exitCode: 2 });
        }
        const taskId = entry.slice(0, separator).trim();
        const filePath = entry.slice(separator + 1).trim();
        if (!taskId || !filePath) {
            throw new CliError('ATM_CLI_USAGE', '--file-slice must include both task id and file path.', { exitCode: 2 });
        }
        slices[taskId] = [...(slices[taskId] ?? []), filePath];
    }
    if (Object.keys(slices).length === 0) {
        for (const taskId of fallbackTasks)
            slices[taskId] = [...fallbackFiles];
    }
    return slices;
}
function writeReceipt(cwd, outPath, value) {
    const absolute = path.resolve(cwd, outPath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return path.relative(cwd, absolute).replace(/\\/g, '/');
}
function digestOutputFiles(cwd, files) {
    const normalized = uniqueSorted(files);
    const hash = createHash('sha256');
    for (const relative of normalized) {
        const absolute = path.resolve(cwd, relative);
        if (!existsSync(absolute)) {
            throw new CliError('ATM_BROKER_BATCH_GENERATED_BLOCKED', `generated output file does not exist: ${relative}`, { exitCode: 1 });
        }
        const stat = statSync(absolute);
        if (stat.isDirectory()) {
            throw new CliError('ATM_BROKER_BATCH_GENERATED_BLOCKED', `generated output path is a directory; pass concrete --output-file entries: ${relative}`, { exitCode: 1 });
        }
        hash.update(relative);
        hash.update('\0');
        hash.update(readFileSync(absolute));
        hash.update('\0');
    }
    return `sha256:${hash.digest('hex')}`;
}
function timeOutputDigest(cwd, files) {
    const started = Date.now();
    const digest = digestOutputFiles(cwd, files);
    return { digest, durationMs: Date.now() - started };
}
function digestCommandManifest(manifest) {
    return `sha256:${createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`;
}
function readCommandManifest(cwd, manifestPath) {
    const absolute = path.resolve(cwd, manifestPath);
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(absolute, 'utf8'));
    }
    catch (error) {
        throw new CliError('ATM_COMMAND_MANIFEST_INVALID', `command manifest is not valid JSON: ${manifestPath}`, {
            exitCode: 2,
            details: { error: error instanceof Error ? error.message : String(error) }
        });
    }
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    if (!record
        || record.schemaId !== 'atm.commandManifest.v1'
        || typeof record.executable !== 'string'
        || !record.executable.trim()
        || !Array.isArray(record.argv)
        || !record.argv.every((entry) => typeof entry === 'string')) {
        throw new CliError('ATM_COMMAND_MANIFEST_INVALID', 'command manifest must be atm.commandManifest.v1 with executable and argv[].', { exitCode: 2 });
    }
    if ('command' in record || 'shell' in record) {
        throw new CliError('ATM_COMMAND_MANIFEST_SHELL_FORBIDDEN', 'command manifest must not contain shell command string fields.', { exitCode: 2 });
    }
    const timeoutMs = typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs) && record.timeoutMs > 0
        ? Math.floor(record.timeoutMs)
        : undefined;
    const env = record.env && typeof record.env === 'object' && !Array.isArray(record.env)
        ? Object.fromEntries(Object.entries(record.env).filter(([, value]) => typeof value === 'string'))
        : undefined;
    return {
        schemaId: 'atm.commandManifest.v1',
        specVersion: record.specVersion === '0.1.0' ? '0.1.0' : '0.1.0',
        executable: record.executable.trim(),
        argv: record.argv.map((entry) => entry),
        cwd: typeof record.cwd === 'string' && record.cwd.trim() ? record.cwd.trim() : undefined,
        env,
        envRefs: Array.isArray(record.envRefs) ? record.envRefs.filter((entry) => typeof entry === 'string' && entry.trim().length > 0) : undefined,
        timeoutMs,
        stdinSha256: typeof record.stdinSha256 === 'string' ? record.stdinSha256 : null,
        ioDigest: typeof record.ioDigest === 'string' ? record.ioDigest : null
    };
}
function runGeneratedCommandManifest(cwd, manifest) {
    const started = Date.now();
    const result = spawnSync(manifest.executable, [...manifest.argv], {
        cwd: manifest.cwd ? path.resolve(cwd, manifest.cwd) : cwd,
        shell: false,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: manifest.timeoutMs,
        env: { ...process.env, ...(manifest.env ?? {}) }
    });
    const durationMs = Date.now() - started;
    if ((result.status ?? 1) !== 0) {
        throw new CliError('ATM_BROKER_BATCH_GENERATED_BLOCKED', `generated write command failed: ${manifest.executable}`, {
            exitCode: 1,
            details: { commandManifestDigest: digestCommandManifest(manifest), exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr, durationMs }
        });
    }
    return { exitCode: result.status ?? 0, stdout: result.stdout, stderr: result.stderr, durationMs };
}
function runDeprecatedGeneratedShellCommand(cwd, command) {
    const started = Date.now();
    const result = spawnSync(command, {
        cwd,
        shell: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const durationMs = Date.now() - started;
    if ((result.status ?? 1) !== 0) {
        throw new CliError('ATM_BROKER_BATCH_GENERATED_BLOCKED', `generated write command failed: ${command}`, {
            exitCode: 1,
            details: { command, exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr, durationMs }
        });
    }
    return { exitCode: result.status ?? 0, stdout: result.stdout, stderr: result.stderr, durationMs };
}
export function handleBrokerBatchExecute(options, context) {
    if (options.action !== 'batch')
        return null;
    if (options.batchAction !== 'execute') {
        throw new CliError('ATM_CLI_USAGE', 'broker batch supports execute.', { exitCode: 2 });
    }
    const selectedSurface = options.surfaces.find((surface) => ['commit', 'build', 'projection'].includes(surface));
    if (!selectedSurface) {
        throw new CliError('ATM_CLI_USAGE', 'broker batch execute requires --surface commit, --surface build, or --surface projection.', { exitCode: 2 });
    }
    if (!options.actorId || !options.waveId || !options.surfaceFamily || !options.manifestDigest || !options.sealedSourceSha) {
        throw new CliError('ATM_CLI_USAGE', 'broker batch execute requires --actor, --wave, --surface-family, --manifest-digest, and --sealed-source-sha.', { exitCode: 2 });
    }
    const scheduler = readJson(context.waveSchedulerPath);
    if (selectedSurface === 'build' || selectedSurface === 'projection') {
        if (!options.payloadDigest) {
            throw new CliError('ATM_CLI_USAGE', 'broker batch execute --surface build|projection requires --payload-digest <source-digest>.', { exitCode: 2 });
        }
        if (options.apply && options.runCommand && options.policyFallbackMode !== 'queue-only') {
            throw new CliError('ATM_COMMAND_MANIFEST_REQUIRED', 'broker batch execute generated writes reject shell command strings by default; use --command-manifest or --fallback-mode queue-only for deprecated queue-only compatibility.', { exitCode: 2 });
        }
        if (options.apply && !options.commandManifestPath && !options.runCommand && !options.receiptDigest) {
            throw new CliError('ATM_CLI_USAGE', 'broker batch execute --surface build|projection --apply requires --command-manifest or --receipt-digest.', { exitCode: 2 });
        }
        if ((options.commandManifestPath || options.runCommand) && options.outputFiles.length === 0) {
            throw new CliError('ATM_CLI_USAGE', 'broker batch execute generated writes require at least one --output-file so ATM can observe the output digest.', { exitCode: 2 });
        }
        const surfaceKind = selectedSurface;
        const commandManifest = options.commandManifestPath ? readCommandManifest(options.cwd, options.commandManifestPath) : null;
        const commandRun = options.apply
            ? commandManifest
                ? runGeneratedCommandManifest(options.cwd, commandManifest)
                : options.runCommand && options.policyFallbackMode === 'queue-only'
                    ? runDeprecatedGeneratedShellCommand(options.cwd, options.runCommand)
                    : null
            : null;
        const outputDigestMeasurement = options.commandManifestPath || options.runCommand
            ? timeOutputDigest(options.cwd, options.outputFiles)
            : null;
        const observedOutputDigest = outputDigestMeasurement?.digest ?? options.receiptDigest;
        if (!observedOutputDigest) {
            throw new CliError('ATM_CLI_USAGE', 'broker batch execute --surface build|projection requires --receipt-digest when no --run-command is provided.', { exitCode: 2 });
        }
        const decision = planWaveBrokerBatch({
            document: scheduler,
            waveId: options.waveId,
            surfaceKind,
            surfaceFamily: options.surfaceFamily,
            expectedTaskIds: options.expectedTasks,
            collectionTimeoutMs: options.collectionTimeoutMs
        });
        const plan = planWaveGeneratedWrite({
            decision,
            scheduler,
            actorId: options.actorId,
            surfaceKind,
            surfaceFamily: options.surfaceFamily,
            manifestDigest: options.manifestDigest,
            sealedSourceSha: options.sealedSourceSha,
            sourceDigest: options.payloadDigest,
            outputDigest: observedOutputDigest,
            command: commandRun
                ? commandManifest
                    ? `${commandManifest.executable} ${commandManifest.argv.join(' ')}`
                    : options.runCommand
                : null,
            commandExitCode: commandRun?.exitCode ?? null,
            commandDurationMs: commandRun?.durationMs ?? null,
            phaseTimingsMs: commandRun ? {
                command: commandRun.durationMs,
                outputDigestCalculation: outputDigestMeasurement?.durationMs ?? 0,
                totalElapsed: commandRun.durationMs + (outputDigestMeasurement?.durationMs ?? 0)
            } : null,
            observedOutputFiles: options.commandManifestPath || options.runCommand ? options.outputFiles : [],
            expectedTaskIds: options.expectedTasks
        });
        const receiptPath = options.evidenceOutPath && plan.receipt
            ? writeReceipt(options.cwd, options.evidenceOutPath, plan.receipt)
            : null;
        return makeResult({
            ok: plan.ok,
            command: 'broker',
            cwd: options.cwd,
            messages: [
                message(plan.ok ? 'info' : 'error', plan.ok ? 'ATM_BROKER_BATCH_GENERATED_RECEIPT_READY' : 'ATM_BROKER_BATCH_GENERATED_BLOCKED', plan.reason, {
                    receiptPath,
                    blockers: plan.blockers,
                    commandManifestDigest: commandManifest ? digestCommandManifest(commandManifest) : null
                }),
                ...(options.runCommand && options.policyFallbackMode === 'queue-only'
                    ? [message('warning', 'ATM_RUN_COMMAND_DEPRECATED', '--run-command is deprecated for generated writes and is allowed only in queue-only compatibility mode.', {})]
                    : [])
            ],
            evidence: {
                action: 'broker-batch-execute',
                surface: surfaceKind,
                schedulerPath: '.atm/runtime/wave-broker-scheduler.json',
                decision,
                plan,
                receiptPath
            }
        });
    }
    const decision = planWaveBrokerBatch({
        document: scheduler,
        waveId: options.waveId,
        surfaceKind: 'commit',
        surfaceFamily: options.surfaceFamily,
        expectedTaskIds: options.expectedTasks,
        collectionTimeoutMs: options.collectionTimeoutMs
    });
    const taskIds = scheduler.tickets
        .filter((ticket) => decision.ticketIds.includes(ticket.ticketId))
        .map((ticket) => ticket.taskId);
    const tempIndexDir = mkdtempSync(path.join(tmpdir(), 'atm-shared-delivery-index-'));
    const temporaryIndexPath = path.join(tempIndexDir, 'index');
    const stagedFiles = options.scopeFiles.length > 0 ? options.scopeFiles : [];
    const fileSlices = parseFileSlices(options.fileSlices, taskIds, stagedFiles);
    const payloadFiles = uniqueSorted(Object.values(fileSlices).flat());
    const expectedHead = options.expectedHeadSha ?? options.currentHeadSha ?? currentHead(options.cwd);
    const applied = options.apply
        ? executeTemporaryIndexCommit({
            cwd: options.cwd,
            actorId: options.actorId,
            taskIds,
            expectedHeadSha: expectedHead,
            temporaryIndexPath,
            files: payloadFiles
        })
        : null;
    // Adapter boundary: gather local shared-write evidence only. The admission
    // rules are the same ones the pre-commit / git commit route runs.
    // Only explicitly declared per-task slices carry ownership evidence; a
    // defaulted fan-out slice declares no split and is not a shared-write claim.
    const provenance = buildSharedDeliveryProvenance({
        cwd: options.cwd,
        fileSlices: options.fileSlices.length > 0 ? fileSlices : {},
        sealedBaseSha: options.sealedSourceSha,
        headSha: applied?.commitSha ?? options.currentHeadSha ?? currentHead(options.cwd)
    });
    const plan = planSharedDeliveryCommit({
        provenance,
        decision,
        scheduler,
        actorId: options.actorId,
        manifestDigest: options.manifestDigest,
        sealedBaseSha: options.sealedSourceSha,
        currentHeadSha: applied?.commitSha ?? options.currentHeadSha ?? currentHead(options.cwd),
        expectedHeadSha: applied ? null : options.expectedHeadSha,
        claimedTaskIds: options.claimedTasks.length > 0 ? options.claimedTasks : taskIds,
        validatorTaskIds: options.validatorTasks,
        stagedFiles,
        fileSlices,
        commitSha: applied?.commitSha ?? null,
        temporaryIndexPath
    });
    const saga = planSharedDeliverySaga({
        decision,
        scheduler,
        expectedHeadSha: expectedHead,
        actualHeadSha: applied?.commitSha ?? options.currentHeadSha ?? expectedHead,
        sharedWriteReceipt: plan.receipt,
        fileSlices,
        validatorRefs: Object.fromEntries(taskIds.map((taskId) => [taskId, options.validatorTasks.includes(taskId) ? ['validator-evidence:present'] : []])),
        semanticRefs: Object.fromEntries(taskIds.map((taskId) => [taskId, ['semantic-revalidation:pre-publish']]))
    });
    const receiptPath = options.evidenceOutPath && plan.receipt
        ? writeReceipt(options.cwd, options.evidenceOutPath, plan.receipt)
        : null;
    const result = makeResult({
        ok: plan.ok,
        command: 'broker',
        cwd: options.cwd,
        messages: [
            message(plan.ok ? 'info' : 'error', plan.ok ? 'ATM_BROKER_BATCH_COMMIT_RECEIPT_READY' : 'ATM_BROKER_BATCH_COMMIT_BLOCKED', plan.reason, {
                receiptPath,
                blockers: plan.blockers
            })
        ],
        evidence: {
            action: 'broker-batch-execute',
            surface: 'commit',
            schedulerPath: '.atm/runtime/wave-broker-scheduler.json',
            decision,
            plan,
            saga,
            receiptPath,
            temporaryIndexPath,
            payloadAssertion: applied?.payloadAssertion ?? null
        }
    });
    rmSync(tempIndexDir, { recursive: true, force: true });
    return result;
}
