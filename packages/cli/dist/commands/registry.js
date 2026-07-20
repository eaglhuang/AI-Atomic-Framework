import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { computeHashDiffReport, resolveRegistryDiffTarget } from '../../../core/dist/registry/diff.js';
import { validateRegistryDocument } from '../../../core/dist/registry/registry.js';
import { validatePropagationReport } from '../../../core/dist/test-runner/propagation.js';
import { validateHumanReviewDecisionLog } from '../../../plugin-human-review/dist/index.js';
import { getCommandSpec } from './command-specs.js';
import { lineageLogMatchesMap, normalizeVersionLineage, resolveBackfillTimestamp } from './registry/lineage-normalization.js';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.js';
const defaultRegistryPath = 'atomic-registry.json';
const commandName = 'registry';
export function runRegistry(argv = []) {
    const spec = getCommandSpec(commandName);
    if (!spec) {
        throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for registry.', { exitCode: 2 });
    }
    const parsed = parseArgsForCommand(spec, argv);
    const [area, action] = parsed.positional;
    if (area !== 'lineage' || action !== 'backfill') {
        throw new CliError('ATM_CLI_USAGE', 'Usage: atm registry lineage backfill --atom <id> --from <version> --to <version> --map <map-id> --lineage-log <path> (--dry-run|--apply)', { exitCode: 2, details: { positional: parsed.positional } });
    }
    return runRegistryLineageBackfill(parsed.options);
}
function runRegistryLineageBackfill(options) {
    const cwd = path.resolve(String(options.cwd ?? process.cwd()));
    const dryRun = options.dryRun === true;
    const apply = options.apply === true;
    if (dryRun === apply) {
        throw new CliError('ATM_CLI_USAGE', 'Pass exactly one of --dry-run or --apply.', { exitCode: 2 });
    }
    const required = requireBackfillOptions(options);
    const registryPath = resolveInputPath(cwd, String(options.registry ?? defaultRegistryPath));
    const registryProjectPath = toProjectPath(cwd, registryPath);
    const lineageLogPath = resolveInputPath(cwd, required.lineageLog);
    const lineageLogProjectPath = toProjectPath(cwd, lineageLogPath);
    const reviewPathValue = String(options.reviewAdvisory ?? options.review ?? '').trim();
    const evidencePaths = {
        lineageLog: lineageLogProjectPath,
        equivalence: normalizeOptionalProjectPath(cwd, options.equivalence),
        propagation: normalizeOptionalProjectPath(cwd, options.propagation),
        reviewAdvisory: normalizeOptionalProjectPath(cwd, reviewPathValue),
        humanReview: normalizeOptionalProjectPath(cwd, options.humanReview)
    };
    const missingForApply = [
        ['equivalence', evidencePaths.equivalence],
        ['propagation', evidencePaths.propagation],
        ['review-advisory', evidencePaths.reviewAdvisory],
        ['human-review', evidencePaths.humanReview]
    ]
        .filter(([, value]) => !value)
        .map(([kind]) => kind);
    if (apply && missingForApply.length > 0) {
        return makeBackfillFailure(cwd, 'ATM_REGISTRY_LINEAGE_EVIDENCE_MISSING', 'Apply mode requires equivalence, propagation, review advisory, and human review evidence.', {
            atomId: required.atomId,
            mapId: required.mapId,
            missingEvidence: missingForApply,
            requiredEvidence: ['lineage-log', 'equivalence', 'propagation', 'review-advisory', 'human-review']
        });
    }
    const registryDocument = readJsonFile(registryPath, 'ATM_REGISTRY_LINEAGE_REGISTRY_NOT_FOUND');
    const target = findMapMemberTarget(registryDocument, required.mapId, required.atomId);
    if (!target.ok) {
        return makeBackfillFailure(cwd, target.code, target.message, {
            atomId: required.atomId,
            mapId: required.mapId,
            registryPath: registryProjectPath
        });
    }
    const lineageLog = readJsonFile(lineageLogPath, 'ATM_REGISTRY_LINEAGE_EVIDENCE_NOT_FOUND');
    const timestamp = resolveBackfillTimestamp(options.at, lineageLog, required.atomId);
    const lineageResult = normalizeVersionLineage(lineageLog, {
        atomId: required.atomId,
        mapId: required.mapId,
        fromVersion: required.fromVersion,
        toVersion: required.toVersion,
        sourceRef: lineageLogProjectPath,
        timestamp
    });
    if (!lineageResult.ok) {
        return makeBackfillFailure(cwd, 'ATM_REGISTRY_LINEAGE_CONTRACT_INVALID', 'Lineage log does not contain a valid member versionLineage contract.', {
            atomId: required.atomId,
            mapId: required.mapId,
            lineageLogPath: lineageLogProjectPath,
            issues: lineageResult.issues
        });
    }
    const validations = validateEvidenceSet(cwd, {
        atomId: required.atomId,
        mapId: required.mapId,
        lineageLog,
        lineageLogPath: lineageLogProjectPath,
        equivalencePath: evidencePaths.equivalence,
        propagationPath: evidencePaths.propagation,
        reviewAdvisoryPath: evidencePaths.reviewAdvisory,
        humanReviewPath: evidencePaths.humanReview
    });
    const failedValidations = validations.filter((entry) => entry.ok !== true);
    if (failedValidations.length > 0) {
        return makeBackfillFailure(cwd, 'ATM_REGISTRY_LINEAGE_EVIDENCE_INVALID', 'One or more lineage backfill evidence documents failed validation.', {
            atomId: required.atomId,
            mapId: required.mapId,
            evidenceValidation: validations
        });
    }
    const closeoutReportPath = buildCloseoutReportPath(cwd, required.atomId, required.fromVersion, required.toVersion);
    const closeoutProjectPath = toProjectPath(cwd, closeoutReportPath);
    const evidenceRefs = normalizeEvidenceRefs([
        evidencePaths.lineageLog,
        evidencePaths.equivalence,
        evidencePaths.propagation,
        evidencePaths.reviewAdvisory,
        evidencePaths.humanReview,
        closeoutProjectPath
    ]);
    const nextRegistry = cloneJson(registryDocument);
    nextRegistry.generatedAt = timestamp;
    nextRegistry.entries[target.entryIndex] = {
        ...target.entry,
        lineageLogRef: lineageLogProjectPath,
        evidence: normalizeEvidenceRefs([...(Array.isArray(target.entry.evidence) ? target.entry.evidence : []), ...evidenceRefs]),
        members: target.entry.members.map((member, index) => index === target.memberIndex
            ? { ...member, versionLineage: lineageResult.lineage }
            : member)
    };
    const mapSpecResult = prepareMapSpecPatch(cwd, target.entry, required.atomId, lineageResult.lineage, lineageLogProjectPath);
    const nextLineageLog = appendBackfillRecord(lineageLog, {
        atomId: required.atomId,
        mapId: required.mapId,
        fromVersion: required.fromVersion,
        toVersion: required.toVersion,
        actor: String(options.actor ?? 'atm-registry-lineage-backfill'),
        timestamp,
        evidenceRefs,
        versionLineage: lineageResult.lineage
    });
    const registryDiff = computeRegistryDiff(nextRegistry, {
        atomId: required.atomId,
        fromVersion: required.fromVersion,
        toVersion: required.toVersion,
        timestamp
    });
    if (!registryDiff.ok) {
        return makeBackfillFailure(cwd, 'ATM_REGISTRY_LINEAGE_DIFF_FAILED', 'Backfilled registry could not produce a registry-diff report.', {
            atomId: required.atomId,
            mapId: required.mapId,
            registryDiff
        });
    }
    const validation = validateRegistryDocument(nextRegistry);
    if (validation.ok !== true) {
        return makeBackfillFailure(cwd, 'ATM_REGISTRY_LINEAGE_REGISTRY_INVALID', 'Backfilled registry document failed schema validation.', {
            atomId: required.atomId,
            mapId: required.mapId,
            validation: validation.promptReport
        });
    }
    const patch = {
        registry: {
            path: registryProjectPath,
            operations: [
                {
                    op: target.member.versionLineage ? 'replace' : 'add',
                    path: `/entries/${target.entryIndex}/members/${target.memberIndex}/versionLineage`,
                    before: target.member.versionLineage ?? null,
                    after: lineageResult.lineage
                }
            ]
        },
        mapSpec: mapSpecResult.patch,
        lineageLog: {
            path: lineageLogProjectPath,
            operations: [
                {
                    op: 'upsert',
                    path: '/versionBackfills',
                    recordId: buildBackfillRecordId(required.atomId, required.fromVersion, required.toVersion)
                }
            ]
        },
        closeoutReport: {
            path: closeoutProjectPath,
            action: 'write'
        }
    };
    const closeoutReport = createCloseoutReport({
        atomId: required.atomId,
        mapId: required.mapId,
        fromVersion: required.fromVersion,
        toVersion: required.toVersion,
        actor: String(options.actor ?? 'atm-registry-lineage-backfill'),
        timestamp,
        registryPath: registryProjectPath,
        mapSpecPath: mapSpecResult.projectPath,
        lineageLogPath: lineageLogProjectPath,
        evidenceRefs,
        patch,
        registryDiff: registryDiff.report
    });
    if (apply) {
        writeJsonFile(registryPath, nextRegistry);
        if (mapSpecResult.nextDocument) {
            writeJsonFile(mapSpecResult.absolutePath, mapSpecResult.nextDocument);
        }
        writeJsonFile(lineageLogPath, nextLineageLog);
        writeJsonFile(closeoutReportPath, closeoutReport);
    }
    const dryRunText = dryRun ? 'Dry-run registry lineage backfill patch is ready.' : 'Registry lineage backfill applied.';
    return makeResult({
        ok: true,
        command: commandName,
        cwd,
        messages: [message('info', dryRun ? 'ATM_REGISTRY_LINEAGE_BACKFILL_DRY_RUN' : 'ATM_REGISTRY_LINEAGE_BACKFILL_APPLIED', dryRunText, {
                atomId: required.atomId,
                mapId: required.mapId,
                registryPath: registryProjectPath
            })],
        evidence: {
            dryRun,
            applied: apply,
            atomId: required.atomId,
            mapId: required.mapId,
            fromVersion: required.fromVersion,
            toVersion: required.toVersion,
            applyReady: missingForApply.length === 0,
            missingForApply,
            evidenceValidation: validations,
            evidenceRefs,
            patch,
            closeoutReportPath: closeoutProjectPath,
            registryDiff: registryDiff.report
        }
    });
}
function requireBackfillOptions(options) {
    return {
        atomId: requireOption(options, 'atom', '--atom'),
        fromVersion: requireOption(options, 'from', '--from'),
        toVersion: requireOption(options, 'to', '--to'),
        mapId: requireOption(options, 'map', '--map'),
        lineageLog: requireOption(options, 'lineageLog', '--lineage-log')
    };
}
function requireOption(options, key, flag) {
    const value = String(options[key] ?? '').trim();
    if (!value) {
        throw new CliError('ATM_CLI_USAGE', `Missing required flag: ${flag}`, { exitCode: 2 });
    }
    return value;
}
function findMapMemberTarget(registryDocument, mapId, atomId) {
    const entries = registryDocument && Array.isArray(registryDocument.entries) ? registryDocument.entries : [];
    const entryIndex = entries.findIndex((entry) => isObject(entry) && entry.schemaId === 'atm.atomicMap' && String(entry.mapId ?? '').trim() === mapId);
    if (entryIndex === -1) {
        return { ok: false, code: 'ATM_REGISTRY_LINEAGE_MAP_NOT_FOUND', message: `Map ${mapId} was not found in the registry.` };
    }
    const entry = entries[entryIndex];
    const memberIndex = Array.isArray(entry.members)
        ? entry.members.findIndex((member) => isObject(member) && String(member.atomId ?? '').trim() === atomId)
        : -1;
    if (memberIndex === -1) {
        return { ok: false, code: 'ATM_REGISTRY_LINEAGE_MEMBER_NOT_FOUND', message: `Atom ${atomId} was not found in map ${mapId}.` };
    }
    return {
        ok: true,
        entry,
        entryIndex,
        member: entry.members[memberIndex],
        memberIndex
    };
}
function validateEvidenceSet(cwd, input) {
    const validations = [
        validateLineageLog(input.lineageLog, input.lineageLogPath, input.mapId)
    ];
    if (input.equivalencePath) {
        validations.push(validateMapEquivalence(readJsonFile(resolveInputPath(cwd, input.equivalencePath), 'ATM_REGISTRY_LINEAGE_EVIDENCE_NOT_FOUND'), input.equivalencePath, input.mapId));
    }
    if (input.propagationPath) {
        validations.push(validatePropagation(readJsonFile(resolveInputPath(cwd, input.propagationPath), 'ATM_REGISTRY_LINEAGE_EVIDENCE_NOT_FOUND'), input.propagationPath, input.atomId, input.mapId));
    }
    if (input.reviewAdvisoryPath) {
        validations.push(validateReviewAdvisory(readJsonFile(resolveInputPath(cwd, input.reviewAdvisoryPath), 'ATM_REGISTRY_LINEAGE_EVIDENCE_NOT_FOUND'), input.reviewAdvisoryPath, input.mapId));
    }
    if (input.humanReviewPath) {
        validations.push(validateHumanReview(readJsonFile(resolveInputPath(cwd, input.humanReviewPath), 'ATM_REGISTRY_LINEAGE_EVIDENCE_NOT_FOUND'), input.humanReviewPath, input.atomId, input.mapId));
    }
    return validations;
}
function validateLineageLog(lineageLog, lineageLogPath, mapId) {
    const issues = [];
    if (lineageLog?.schemaId !== 'atm.mapLineageLog') {
        issues.push('lineage log schemaId must be atm.mapLineageLog.');
    }
    if (!lineageLogMatchesMap(lineageLog, mapId)) {
        issues.push(`lineage log must match map ${mapId}.`);
    }
    return { ok: issues.length === 0, kind: 'lineage-log', path: lineageLogPath, issues };
}
function validateMapEquivalence(report, reportPath, mapId) {
    const issues = [];
    if (report?.schemaId !== 'atm.mapEquivalenceReport') {
        issues.push('equivalence report schemaId must be atm.mapEquivalenceReport.');
    }
    if (report?.passed !== true) {
        issues.push('equivalence report must pass.');
    }
    if (String(report?.mapId ?? '').trim() !== mapId) {
        issues.push(`equivalence report mapId must match ${mapId}.`);
    }
    return { ok: issues.length === 0, kind: 'equivalence', path: reportPath, issues };
}
function validatePropagation(report, reportPath, atomId, mapId) {
    const validation = validatePropagationReport(report, { atomId, mapId });
    return { ok: validation.ok, kind: 'propagation', path: reportPath, issues: validation.issues };
}
function validateReviewAdvisory(report, reportPath, mapId) {
    const issues = [];
    if (report?.schemaVersion !== '1.0.0') {
        issues.push('review advisory schemaVersion must be 1.0.0.');
    }
    if (!['ok', 'warn'].includes(String(report?.status ?? ''))) {
        issues.push('review advisory status must be ok or warn.');
    }
    if (report?.advisoryUnavailable === true) {
        issues.push('review advisory must not be advisory-unavailable.');
    }
    if (report?.target?.kind === 'map' && report.target?.id && String(report.target?.id).trim() !== mapId) {
        issues.push(`review advisory map target must match ${mapId}.`);
    }
    return { ok: issues.length === 0, kind: 'review-advisory', path: reportPath, issues };
}
function validateHumanReview(report, reportPath, atomId, mapId) {
    const issues = [];
    if (!report) {
        issues.push('human review report is missing.');
    }
    else {
        try {
            const validation = validateHumanReviewDecisionLog(report); // 這裡轉成 HumanReviewDecisionLog 型別
            issues.push(...validation.issues);
        }
        catch (error) {
            issues.push(`human review decision validation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (report?.schemaId !== 'atm.humanReviewDecision') {
        issues.push('human review schemaId must be atm.humanReviewDecision.');
    }
    if (report?.decision !== 'approve') {
        issues.push('human review decision must be approve.');
    }
    if (String(report?.atomId ?? '').trim() !== atomId) {
        issues.push(`human review atomId must match ${atomId}.`);
    }
    const fromVersion = String(report?.queueRecord?.fromVersion ?? '').trim();
    const toVersion = String(report?.queueRecord?.toVersion ?? '').trim();
    if (fromVersion && fromVersion === toVersion) {
        issues.push('human review queueRecord must carry a version transition.');
    }
    const reviewedMapId = String(report?.queueRecord?.proposal?.target?.mapId ?? report?.queueRecord?.proposal?.reviewedMapId ?? '').trim();
    if (reviewedMapId && reviewedMapId !== mapId) {
        issues.push(`human review map target must match ${mapId}.`);
    }
    return { ok: issues.length === 0, kind: 'human-review', path: reportPath, issues };
}
function prepareMapSpecPatch(cwd, entry, atomId, versionLineage, lineageLogRef) {
    const specProjectPath = String(entry?.location?.specPath ?? '').trim();
    if (!specProjectPath) {
        return {
            absolutePath: '',
            projectPath: null,
            nextDocument: null,
            patch: {
                path: null,
                skipped: 'registry entry has no location.specPath'
            }
        };
    }
    const absolutePath = resolveInputPath(cwd, specProjectPath);
    if (!existsSync(absolutePath)) {
        return {
            absolutePath,
            projectPath: specProjectPath,
            nextDocument: null,
            patch: {
                path: specProjectPath,
                skipped: 'map spec file not found'
            }
        };
    }
    const document = readJsonFile(absolutePath, 'ATM_REGISTRY_LINEAGE_MAP_SPEC_NOT_FOUND');
    const memberIndex = Array.isArray(document?.members)
        ? document.members.findIndex((member) => isObject(member) && String(member?.atomId ?? '').trim() === atomId)
        : -1;
    if (memberIndex === -1) {
        return {
            absolutePath,
            projectPath: specProjectPath,
            nextDocument: null,
            patch: {
                path: specProjectPath,
                skipped: `map spec does not contain member ${atomId}`
            }
        };
    }
    const nextDocument = {
        ...document,
        lineageLogRef,
        members: document.members.map((member, index) => index === memberIndex
            ? { ...member, versionLineage }
            : member)
    };
    return {
        absolutePath,
        projectPath: specProjectPath,
        nextDocument,
        patch: {
            path: specProjectPath,
            operations: [
                {
                    op: document.members[memberIndex].versionLineage ? 'replace' : 'add',
                    path: `/members/${memberIndex}/versionLineage`,
                    before: document.members[memberIndex].versionLineage ?? null,
                    after: versionLineage
                }
            ]
        }
    };
}
function computeRegistryDiff(registryDocument, input) {
    const resolution = resolveRegistryDiffTarget(registryDocument, input.atomId);
    if (!resolution.ok) {
        return { ok: false, resolution };
    }
    const report = computeHashDiffReport({
        entry: {
            ...resolution.entry,
            versions: [...resolution.entry.versions]
        },
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        driftReason: 'Registry lineage backfill closeout.'
    });
    report.generatedAt = input.timestamp;
    return { ok: true, resolution, report };
}
function appendBackfillRecord(lineageLog, record) {
    const recordId = buildBackfillRecordId(record.atomId, record.fromVersion, record.toVersion);
    const existing = lineageLog && Array.isArray(lineageLog.versionBackfills) ? lineageLog.versionBackfills : [];
    const nextRecords = [
        ...existing.filter((entry) => isObject(entry) && String(entry?.backfillId ?? '') !== recordId),
        { backfillId: recordId, ...record }
    ].sort((left, right) => String(left.backfillId).localeCompare(String(right.backfillId)));
    return {
        ...lineageLog,
        versionBackfills: nextRecords
    };
}
function createCloseoutReport(input) {
    return {
        schemaId: 'atm.registryLineageBackfillReport',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Initial registry lineage backfill closeout contract.'
        },
        reportId: buildBackfillRecordId(input.atomId, input.fromVersion, input.toVersion),
        generatedAt: input.timestamp,
        ...input
    };
}
function buildBackfillRecordId(atomId, fromVersion, toVersion) {
    return `registry-lineage-backfill.${String(atomId).toLowerCase()}.${String(fromVersion).replace(/[^0-9a-z.-]/gi, '-')}-to-${String(toVersion).replace(/[^0-9a-z.-]/gi, '-')}`;
}
function buildCloseoutReportPath(cwd, atomId, fromVersion, toVersion) {
    return path.join(cwd, '.atm', 'history', 'reports', 'registry-lineage-backfill', `${buildBackfillRecordId(atomId, fromVersion, toVersion)}.json`);
}
function normalizeEvidenceRefs(values) {
    return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
function normalizeOptionalProjectPath(cwd, value) {
    const normalized = String(value ?? '').trim();
    if (!normalized)
        return null;
    return toProjectPath(cwd, resolveInputPath(cwd, normalized));
}
function resolveInputPath(cwd, value) {
    return path.isAbsolute(value) ? path.resolve(value) : path.resolve(cwd, value);
}
function toProjectPath(cwd, absolutePath) {
    const relative = path.relative(cwd, absolutePath);
    if (!relative || relative.startsWith('..')) {
        return toPortablePath(absolutePath);
    }
    return toPortablePath(relative);
}
function toPortablePath(value) {
    return value.split(path.sep).join('/');
}
function readJsonFile(filePath, code) {
    if (!existsSync(filePath)) {
        throw new CliError(code, `JSON file not found: ${filePath}`);
    }
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch (error) {
        throw new CliError('ATM_REGISTRY_LINEAGE_JSON_INVALID', `Invalid JSON file: ${filePath}`, {
            details: { path: filePath, reason: error instanceof Error ? error.message : String(error) }
        });
    }
}
function writeJsonFile(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function makeBackfillFailure(cwd, code, text, evidence) {
    return makeResult({
        ok: false,
        command: commandName,
        cwd,
        messages: [message('error', code, text, evidence)],
        evidence
    });
}
function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
