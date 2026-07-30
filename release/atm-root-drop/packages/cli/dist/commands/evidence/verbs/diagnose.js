import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateDiagnosticLoopReceipt } from '../../../../../core/dist/evidence/diagnostic-loop.js';
import { CliError, makeResult, message } from '../../shared.js';
export function runEvidenceDiagnose(argv) {
    const options = parseDiagnoseOptions(argv);
    const receipt = evaluateDiagnosticLoopReceipt({
        taskId: options.taskId,
        symptom: options.symptom,
        severity: options.severity,
        reproducer: {
            command: options.reproducerCommand,
            exitCode: options.reproducerExitCode,
            stdoutSha256: options.reproducerStdoutSha256,
            stderrSha256: options.reproducerStderrSha256
        },
        symptomObserved: options.symptomObserved,
        reproductionRate: options.reproductionRate,
        minimizedFixture: options.minimizedFixture,
        candidateDigest: options.candidateDigest,
        environmentDigest: options.environmentDigest,
        hypotheses: options.hypotheses,
        winningHypothesisId: options.winningHypothesisId,
        regressionCaseId: options.regressionCaseId,
        greenEvidence: {
            command: options.greenCommand,
            exitCode: options.greenExitCode,
            stdoutSha256: options.greenStdoutSha256,
            stderrSha256: options.greenStderrSha256
        },
        temporaryInstrumentation: options.temporaryInstrumentation,
        emergencyRationale: options.emergencyRationale,
        createdAt: new Date(0).toISOString()
    });
    const receiptPath = path.join(options.cwd, '.atm', 'history', 'evidence', `${options.taskId}.diagnostic-loop-receipt.json`);
    if (options.write) {
        if (!receipt.valid) {
            throw new CliError('ATM_DIAGNOSTIC_LOOP_RECEIPT_INVALID', 'Diagnostic loop receipt failed closed; refusing to write.', {
                exitCode: 1,
                details: { receipt, receiptPath: path.relative(options.cwd, receiptPath).replace(/\\/g, '/') }
            });
        }
        mkdirSync(path.dirname(receiptPath), { recursive: true });
        writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    }
    return makeResult({
        ok: receipt.valid,
        command: 'evidence diagnose',
        cwd: options.cwd,
        messages: [
            message(receipt.valid ? 'info' : 'error', receipt.valid ? 'ATM_DIAGNOSTIC_LOOP_RECEIPT_VALID' : 'ATM_DIAGNOSTIC_LOOP_RECEIPT_INVALID', receipt.valid
                ? 'Diagnostic loop receipt admits repair evidence.'
                : 'Diagnostic loop receipt failed closed before repair evidence can be accepted.', { taskId: options.taskId, reasons: receipt.reasons, receiptPath: path.relative(options.cwd, receiptPath).replace(/\\/g, '/') })
        ],
        evidence: {
            action: options.write ? 'write' : 'dry-run',
            taskId: options.taskId,
            receiptPath: path.relative(options.cwd, receiptPath).replace(/\\/g, '/'),
            receipt
        }
    });
}
export { runEvidenceDiagnose as run };
function parseDiagnoseOptions(argv) {
    let cwd = process.cwd();
    let taskId = '';
    let symptom = '';
    let severity = 'blocking';
    let reproducerCommand = '';
    let reproducerExitCode = 1;
    let reproducerStdoutSha256 = '';
    let reproducerStderrSha256 = '';
    let symptomObserved = false;
    let reproductionRate = 0;
    let minimizedFixture = '';
    let candidateDigest = '';
    let environmentDigest = '';
    const hypotheses = [];
    let winningHypothesisId = '';
    let regressionCaseId = '';
    let greenCommand = '';
    let greenExitCode = 0;
    let greenStdoutSha256 = '';
    let greenStderrSha256 = '';
    let temporaryInstrumentation = 'none';
    let emergencyReason = '';
    let emergencyExpiresAt = '';
    let write = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd')
            cwd = requireValue(argv, ++index, arg);
        else if (arg === '--task')
            taskId = requireValue(argv, ++index, arg);
        else if (arg === '--symptom')
            symptom = requireValue(argv, ++index, arg);
        else if (arg === '--severity')
            severity = requireValue(argv, ++index, arg) === 'non-blocking' ? 'non-blocking' : 'blocking';
        else if (arg === '--reproducer-command')
            reproducerCommand = requireValue(argv, ++index, arg);
        else if (arg === '--reproducer-exit-code')
            reproducerExitCode = Number(requireValue(argv, ++index, arg));
        else if (arg === '--reproducer-stdout-sha256')
            reproducerStdoutSha256 = requireValue(argv, ++index, arg);
        else if (arg === '--reproducer-stderr-sha256')
            reproducerStderrSha256 = requireValue(argv, ++index, arg);
        else if (arg === '--symptom-observed')
            symptomObserved = true;
        else if (arg === '--reproduction-rate')
            reproductionRate = Number(requireValue(argv, ++index, arg));
        else if (arg === '--minimized-fixture')
            minimizedFixture = requireValue(argv, ++index, arg);
        else if (arg === '--candidate-digest')
            candidateDigest = requireValue(argv, ++index, arg);
        else if (arg === '--environment-digest')
            environmentDigest = requireValue(argv, ++index, arg);
        else if (arg === '--hypothesis')
            hypotheses.push(parseHypothesis(requireValue(argv, ++index, arg)));
        else if (arg === '--winning-hypothesis')
            winningHypothesisId = requireValue(argv, ++index, arg);
        else if (arg === '--regression-case-id')
            regressionCaseId = requireValue(argv, ++index, arg);
        else if (arg === '--green-command')
            greenCommand = requireValue(argv, ++index, arg);
        else if (arg === '--green-exit-code')
            greenExitCode = Number(requireValue(argv, ++index, arg));
        else if (arg === '--green-stdout-sha256')
            greenStdoutSha256 = requireValue(argv, ++index, arg);
        else if (arg === '--green-stderr-sha256')
            greenStderrSha256 = requireValue(argv, ++index, arg);
        else if (arg === '--temporary-instrumentation') {
            const value = requireValue(argv, ++index, arg);
            temporaryInstrumentation = value === 'removed' || value === 'promoted' ? value : 'none';
        }
        else if (arg === '--emergency-rationale')
            emergencyReason = requireValue(argv, ++index, arg);
        else if (arg === '--expires-at')
            emergencyExpiresAt = requireValue(argv, ++index, arg);
        else if (arg === '--write')
            write = true;
    }
    if (!taskId)
        throw new CliError('ATM_CLI_USAGE', 'evidence diagnose requires --task <id>', { exitCode: 2 });
    if (!symptom)
        throw new CliError('ATM_CLI_USAGE', 'evidence diagnose requires --symptom <text>', { exitCode: 2 });
    return {
        cwd: path.resolve(cwd),
        taskId,
        symptom,
        severity,
        reproducerCommand,
        reproducerExitCode: Number.isFinite(reproducerExitCode) ? reproducerExitCode : 1,
        reproducerStdoutSha256,
        reproducerStderrSha256,
        symptomObserved,
        reproductionRate: Number.isFinite(reproductionRate) ? reproductionRate : 0,
        minimizedFixture,
        candidateDigest,
        environmentDigest,
        hypotheses,
        winningHypothesisId,
        regressionCaseId,
        greenCommand,
        greenExitCode: Number.isFinite(greenExitCode) ? greenExitCode : 1,
        greenStdoutSha256,
        greenStderrSha256,
        temporaryInstrumentation,
        emergencyRationale: emergencyReason || emergencyExpiresAt
            ? { reason: emergencyReason, expiresAt: emergencyExpiresAt }
            : null,
        write
    };
}
function parseHypothesis(raw) {
    const parts = raw.split('|').map((part) => part.trim());
    return {
        id: parts[0] ?? '',
        summary: parts[1] ?? '',
        predictedObservation: parts[2] ?? '',
        experimentCommand: parts[3] ?? '',
        experimentResult: parts[4] === 'matched' || parts[4] === 'falsified' ? parts[4] : 'inconclusive'
    };
}
function requireValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `evidence diagnose ${flag} requires a value`, { exitCode: 2 });
    }
    return value;
}
