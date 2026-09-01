import { CliError, makeResult, message, parseOptions, relativePathFrom } from './shared.js';
import { listSupportedAgentIds, verifyAgentsMarkdown } from './agent-confidence.js';
import { evaluateSeedSelfVerification, registryFilePath, validateRegistryDocumentAgainstSchema } from './registry-shared.js';
import { defaultNeutralityPolicyRelativePath, scanNeutralityRepository } from '../../../plugin-rule-guard/dist/neutrality-scanner.js';
import { checkGuardJustification } from '../../../plugin-rule-guard/dist/rule-justification.js';
import { existsSync, readFileSync } from 'node:fs';
export function runVerify(argv) {
    const { options } = parseOptions(argv, 'verify');
    const selectedModes = [options.self, options.neutrality, options.agentsMd, options.guards].filter((value) => value === true).length;
    if (selectedModes !== 1) {
        throw new CliError('ATM_CLI_USAGE', 'verify requires exactly one of --self, --neutrality, --agents-md, or --guards', { exitCode: 2 });
    }
    if (options.neutrality) {
        return runNeutralityVerify(options.cwd);
    }
    if (options.agentsMd) {
        return runAgentsMdVerify(options.cwd);
    }
    if (options.guards) {
        return runGuardsVerify(options.cwd, options.evidence);
    }
    return runSelfVerify(options.cwd);
}
function runSelfVerify(cwd) {
    const schemaResult = validateRegistryDocumentAgainstSchema(cwd, registryFilePath, {
        commandName: 'verify',
        successCode: 'ATM_VERIFY_REGISTRY_SCHEMA_OK',
        successText: 'Atomic registry validated against JSON Schema.'
    });
    if (!schemaResult.ok) {
        return schemaResult;
    }
    const verification = evaluateSeedSelfVerification();
    const messages = [
        ...schemaResult.messages,
        verification.ok
            ? message('info', 'ATM_VERIFY_SELF_OK', 'Seed self-verification hashes match the committed registry entry.')
            : message('error', 'ATM_VERIFY_SELF_DRIFT', 'Seed self-verification detected registry drift.', { issues: verification.issues })
    ];
    return makeResult({
        ok: verification.ok,
        command: 'verify',
        cwd,
        messages,
        evidence: {
            registryPath: relativePathFrom(cwd, registryFilePath),
            atomId: verification.entry?.atomId,
            legacyPlanningId: verification.report?.legacyPlanningId?.actual,
            selfVerification: verification.report,
            validated: schemaResult.evidence.validated
        }
    });
}
function runNeutralityVerify(cwd) {
    const report = scanNeutralityRepository({
        repositoryRoot: cwd,
        policyPath: defaultNeutralityPolicyRelativePath
    });
    const messages = report.ok
        ? [message('info', 'ATM_VERIFY_NEUTRALITY_OK', 'Neutrality scan passed across protected framework surfaces.', { scannedFiles: report.totals.scannedFiles })]
        : [message('error', 'ATM_VERIFY_NEUTRALITY_FAILED', 'Neutrality scan found adopter-specific references in protected framework surfaces.', { violations: report.totals.violations })];
    return makeResult({
        ok: report.ok,
        command: 'verify',
        cwd,
        messages,
        evidence: {
            atomId: report.atomId,
            legacyPlanningId: report.legacyPlanningId,
            policyPath: report.policyPath,
            scannedFiles: report.totals.scannedFiles,
            termViolations: report.totals.termViolations,
            pathViolations: report.totals.pathViolations,
            violations: report.violations,
            validated: [report.policyPath]
        }
    });
}
function runAgentsMdVerify(cwd) {
    const verification = verifyAgentsMarkdown(cwd);
    return makeResult({
        ok: verification.ok,
        command: 'verify',
        cwd,
        messages: [
            verification.ok
                ? message('info', 'ATM_VERIFY_AGENTS_MD_OK', 'AGENTS bootstrap instructions are vendor-neutral and complete.', { mode: verification.mode })
                : message('error', 'ATM_VERIFY_AGENTS_MD_FAILED', 'AGENTS bootstrap instructions are missing required markers or contain vendor-specific guidance.', { issues: verification.issues, mode: verification.mode })
        ],
        evidence: {
            path: verification.path,
            mode: verification.mode,
            checked: verification.checked,
            issues: verification.issues,
            supportedAgents: listSupportedAgentIds(),
            validated: verification.path ? [verification.path] : []
        }
    });
}
function runGuardsVerify(cwd, evidencePath) {
    if (!evidencePath) {
        throw new CliError('ATM_CLI_USAGE', 'verify --guards requires --evidence <path>', { exitCode: 2 });
    }
    const absoluteEvidencePath = evidencePath.startsWith('/') || /^[A-Za-z]:/.test(evidencePath)
        ? evidencePath
        : `${cwd}/${evidencePath}`;
    if (!existsSync(absoluteEvidencePath)) {
        throw new CliError('ATM_VERIFY_GUARDS_EVIDENCE_NOT_FOUND', `Guard evidence file not found: ${evidencePath}`, {
            exitCode: 1,
            details: { evidencePath }
        });
    }
    let evidenceDoc;
    try {
        evidenceDoc = JSON.parse(readFileSync(absoluteEvidencePath, 'utf8'));
    }
    catch {
        throw new CliError('ATM_VERIFY_GUARDS_EVIDENCE_PARSE_ERROR', `Guard evidence file is not valid JSON: ${evidencePath}`, {
            exitCode: 1,
            details: { evidencePath }
        });
    }
    const violations = Array.isArray(evidenceDoc.violations) ? evidenceDoc.violations : [];
    const result = checkGuardJustification({ violations });
    if (!result.ok) {
        return makeResult({
            ok: false,
            command: 'verify',
            cwd,
            messages: [message('error', 'ATM_VERIFY_GUARDS_MISSING_JUSTIFICATION', `Guard violations are missing required justification: ${result.missingJustifications.join(', ')}`, { missingJustifications: result.missingJustifications })],
            evidence: {
                evidencePath: relativePathFrom(cwd, absoluteEvidencePath),
                checkedViolations: result.checkedViolations,
                missingJustifications: result.missingJustifications,
                requiredJustification: result.requiredJustification
            }
        });
    }
    return makeResult({
        ok: true,
        command: 'verify',
        cwd,
        messages: [message('info', 'ATM_VERIFY_GUARDS_OK', `All ${result.checkedViolations} guard violation(s) have justification.`)],
        evidence: {
            evidencePath: relativePathFrom(cwd, absoluteEvidencePath),
            checkedViolations: result.checkedViolations,
            missingJustifications: [],
            requiredJustification: null
        }
    });
}
