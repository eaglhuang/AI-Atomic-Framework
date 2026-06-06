import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const semverPattern = /^\d+\.\d+\.\d+$/;
const planIdPattern = /^decomposition-plan\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const mapIdPattern = /^ATM-MAP-\d{4}$/;
const atomIdPattern = /^ATM-[A-Z][A-Z0-9]*-\d{4}$/;
const memberRoles = new Set(['entry-adapter', 'domain-step', 'validator', 'side-effect', 'rollback-adapter']);
const edgeKinds = new Set(['data-flow', 'control-flow', 'event-flow', 'validation', 'fallback', 'side-effect', 'rollback']);
const migrationStrategies = new Set(['none', 'additive', 'breaking']);
export const defaultDecompositionPlanSchemaPath = path.join(frameworkRoot, 'schemas', 'governance', 'decomposition-plan.schema.json');
export function readDecompositionPlan(planPath, options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const absolutePlanPath = path.resolve(cwd, planPath);
    if (!existsSync(absolutePlanPath)) {
        throw createDecompositionPlanError('ATM_DECOMP_PLAN_INVALID', 'Decomposition plan file was not found.', {
            planPath: toPortablePath(absolutePlanPath)
        });
    }
    let document;
    try {
        document = JSON.parse(readFileSync(absolutePlanPath, 'utf8'));
    }
    catch (error) {
        throw createDecompositionPlanError('ATM_DECOMP_PLAN_INVALID', 'Failed to parse decomposition plan JSON.', {
            planPath: toPortablePath(absolutePlanPath),
            reason: error instanceof Error ? error.message : String(error)
        });
    }
    const validation = validateDecompositionPlanDocument(document, {
        schemaPath: options.schemaPath ?? defaultDecompositionPlanSchemaPath
    });
    if (!validation.ok) {
        throw createDecompositionPlanError('ATM_DECOMP_PLAN_INVALID', 'Decomposition plan did not satisfy its schema contract.', {
            planPath: toPortablePath(absolutePlanPath),
            issues: validation.issues
        });
    }
    return {
        plan: document,
        absolutePlanPath,
        relativePlanPath: toPortablePath(path.relative(cwd, absolutePlanPath)),
        validation
    };
}
export function validateDecompositionPlanDocument(document, options = {}) {
    const schemaPath = path.resolve(options.schemaPath ?? defaultDecompositionPlanSchemaPath);
    const issues = collectDecompositionPlanIssues(document);
    const ok = issues.length === 0;
    return {
        ok,
        schemaPath: toPortablePath(schemaPath),
        issues: ok
            ? []
            : issues
    };
}
export function createAtomicMapRequestFromDecompositionPlan(plan) {
    const qualityTargets = normalizeQualityTargets(plan?.qualityTargets);
    const members = Array.isArray(plan.proposedMembers)
        ? plan.proposedMembers.map((entry) => ({ ...entry }))
        : [];
    const edges = Array.isArray(plan.proposedEdges)
        ? plan.proposedEdges.map((entry) => ({ ...entry }))
        : [];
    return {
        mapId: String(plan.proposedMapId || '').trim(),
        request: {
            mapVersion: String(plan.mapVersion || '0.1.0').trim(),
            specVersion: '0.2.0',
            members,
            edges,
            entrypoints: Array.isArray(plan.entrypoints) ? [...plan.entrypoints] : [],
            qualityTargets,
            replacement: {
                legacyUris: Array.isArray(plan.legacyUris) ? [...plan.legacyUris] : [],
                mode: 'draft',
                evidenceRefs: []
            }
        },
        defaultsUsed: plan?.qualityTargets ? [] : ['qualityTargets']
    };
}
function normalizeQualityTargets(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {
            promoteGateRequired: true,
            requiredChecks: 1
        };
    const entries = Object.entries(source)
        .map(([key, entryValue]) => [String(key).trim(), typeof entryValue === 'string' ? entryValue.trim() : entryValue]);
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}
function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
function collectDecompositionPlanIssues(document) {
    const issues = [];
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        issues.push(issue('/', 'type', 'Document must be an object.'));
        return issues;
    }
    const record = document;
    validateNoAdditionalProperties(record, [
        'schemaId',
        'specVersion',
        'migration',
        'planId',
        'generatedAt',
        'mapVersion',
        'legacyUris',
        'proposedMapId',
        'proposedMembers',
        'proposedEdges',
        'entrypoints',
        'qualityTargets',
        'notes'
    ], issues, '/');
    validateExactString(record.schemaId, '/schemaId', 'const', 'atm.decompositionPlan', issues);
    validateExactString(record.specVersion, '/specVersion', 'const', '0.1.0', issues);
    validateMigration(record.migration, issues);
    validateOptionalPatternString(record.planId, '/planId', planIdPattern, 'must match decomposition-plan.<name>.', issues);
    validateOptionalDateTimeString(record.generatedAt, '/generatedAt', issues);
    validateOptionalPatternString(record.mapVersion, '/mapVersion', semverPattern, 'must match semver x.y.z.', issues);
    validateStringArray(record.legacyUris, '/legacyUris', { minItems: 1, unique: true, nonEmpty: true }, issues);
    validatePatternString(record.proposedMapId, '/proposedMapId', mapIdPattern, 'must match ATM-MAP-{NNNN}.', issues);
    validateMembers(record.proposedMembers, issues);
    validateEdges(record.proposedEdges, issues);
    validateEntrypoints(record.entrypoints, record.proposedMembers, issues);
    validateQualityTargets(record.qualityTargets, issues);
    validateStringArray(record.notes, '/notes', { minItems: 1, unique: false, nonEmpty: true }, issues);
    return issues;
}
function validateMigration(value, issues) {
    const path = '/migration';
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        issues.push(issue(path, 'type', 'migration must be an object.'));
        return;
    }
    const record = value;
    validateNoAdditionalProperties(record, ['strategy', 'fromVersion', 'notes'], issues, path);
    if (typeof record.strategy !== 'string' || !migrationStrategies.has(record.strategy)) {
        issues.push(issue(`${path}/strategy`, 'enum', 'migration.strategy must be one of none, additive, breaking.'));
    }
    if (record.fromVersion !== null && record.fromVersion !== undefined) {
        validatePatternString(record.fromVersion, `${path}/fromVersion`, semverPattern, 'migration.fromVersion must match semver x.y.z or be null.', issues);
    }
    if (typeof record.notes !== 'string') {
        issues.push(issue(`${path}/notes`, 'type', 'migration.notes must be a string.'));
    }
}
function validateMembers(value, issues) {
    const path = '/proposedMembers';
    if (!Array.isArray(value) || value.length === 0) {
        issues.push(issue(path, 'minItems', 'proposedMembers must be a non-empty array.'));
        return;
    }
    value.forEach((entry, index) => {
        const entryPath = `${path}/${index}`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            issues.push(issue(entryPath, 'type', 'proposedMembers entries must be objects.'));
            return;
        }
        const record = entry;
        validateNoAdditionalProperties(record, ['atomId', 'version', 'role'], issues, entryPath);
        validatePatternString(record.atomId, `${entryPath}/atomId`, atomIdPattern, 'proposedMembers[].atomId must match ATM-{BUCKET}-{NNNN}.', issues);
        validatePatternString(record.version, `${entryPath}/version`, semverPattern, 'proposedMembers[].version must match semver x.y.z.', issues);
        if (record.role !== undefined && record.role !== null) {
            if (typeof record.role !== 'string' || !memberRoles.has(record.role)) {
                issues.push(issue(`${entryPath}/role`, 'enum', 'proposedMembers[].role must be a known map member role.'));
            }
        }
    });
}
function validateEdges(value, issues) {
    const path = '/proposedEdges';
    if (!Array.isArray(value)) {
        issues.push(issue(path, 'type', 'proposedEdges must be an array.'));
        return;
    }
    value.forEach((entry, index) => {
        const entryPath = `${path}/${index}`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            issues.push(issue(entryPath, 'type', 'proposedEdges entries must be objects.'));
            return;
        }
        const record = entry;
        validateNoAdditionalProperties(record, ['from', 'to', 'binding', 'edgeKind'], issues, entryPath);
        validatePatternString(record.from, `${entryPath}/from`, atomIdPattern, 'proposedEdges[].from must match ATM-{BUCKET}-{NNNN}.', issues);
        validatePatternString(record.to, `${entryPath}/to`, atomIdPattern, 'proposedEdges[].to must match ATM-{BUCKET}-{NNNN}.', issues);
        validateNonEmptyString(record.binding, `${entryPath}/binding`, 'proposedEdges[].binding must be a non-empty string.', issues);
        if (record.edgeKind !== undefined && record.edgeKind !== null) {
            if (typeof record.edgeKind !== 'string' || !edgeKinds.has(record.edgeKind)) {
                issues.push(issue(`${entryPath}/edgeKind`, 'enum', 'proposedEdges[].edgeKind must be a known edge kind.'));
            }
        }
    });
}
function validateEntrypoints(entrypointsValue, membersValue, issues) {
    const path = '/entrypoints';
    if (!Array.isArray(entrypointsValue) || entrypointsValue.length === 0) {
        issues.push(issue(path, 'minItems', 'entrypoints must be a non-empty array.'));
        return;
    }
    const memberIds = new Set(Array.isArray(membersValue)
        ? membersValue
            .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
            .map((entry) => String(entry.atomId || '').trim())
            .filter(Boolean)
        : []);
    const seen = new Set();
    entrypointsValue.forEach((entry, index) => {
        const entryPath = `${path}/${index}`;
        if (typeof entry !== 'string' || !atomIdPattern.test(entry.trim())) {
            issues.push(issue(entryPath, 'pattern', 'entrypoints[] must match ATM-{BUCKET}-{NNNN}.'));
            return;
        }
        const normalized = entry.trim();
        if (seen.has(normalized)) {
            issues.push(issue(entryPath, 'uniqueItems', 'entrypoints must be unique.'));
        }
        seen.add(normalized);
        if (memberIds.size > 0 && !memberIds.has(normalized)) {
            issues.push(issue(entryPath, 'enum', 'entrypoints must reference proposedMembers atomIds.'));
        }
    });
}
function validateQualityTargets(value, issues) {
    const path = '/qualityTargets';
    if (value === undefined || value === null) {
        return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        issues.push(issue(path, 'type', 'qualityTargets must be an object.'));
        return;
    }
    const entries = Object.entries(value);
    if (entries.length === 0) {
        issues.push(issue(path, 'minProperties', 'qualityTargets must have at least one property.'));
        return;
    }
    for (const [key, entryValue] of entries) {
        if (typeof key !== 'string' || key.trim().length === 0) {
            issues.push(issue(path, 'propertyNames', 'qualityTargets keys must be non-empty strings.'));
        }
        if (!['string', 'number', 'boolean'].includes(typeof entryValue)) {
            issues.push(issue(`${path}/${key}`, 'type', 'qualityTargets values must be string, number, or boolean.'));
        }
    }
}
function validateStringArray(value, path, options, issues) {
    if (!Array.isArray(value) || value.length < options.minItems) {
        issues.push(issue(path, 'minItems', `${path.slice(1)} must be an array with at least ${options.minItems} item(s).`));
        return;
    }
    const seen = new Set();
    value.forEach((entry, index) => {
        const entryPath = `${path}/${index}`;
        if (typeof entry !== 'string') {
            issues.push(issue(entryPath, 'type', `${path.slice(1)} entries must be strings.`));
            return;
        }
        const normalized = entry.trim();
        if (options.nonEmpty && normalized.length === 0) {
            issues.push(issue(entryPath, 'minLength', `${path.slice(1)} entries must be non-empty strings.`));
        }
        if (options.unique) {
            if (seen.has(normalized)) {
                issues.push(issue(entryPath, 'uniqueItems', `${path.slice(1)} entries must be unique.`));
            }
            seen.add(normalized);
        }
    });
}
function validateExactString(value, path, keyword, expected, issues) {
    if (value !== expected) {
        issues.push(issue(path, keyword, `${path.slice(1)} must equal ${expected}.`, { expected }));
    }
}
function validatePatternString(value, path, pattern, message, issues) {
    if (typeof value !== 'string' || !pattern.test(value.trim())) {
        issues.push(issue(path, 'pattern', message));
    }
}
function validateOptionalPatternString(value, path, pattern, message, issues) {
    if (value === undefined || value === null) {
        return;
    }
    validatePatternString(value, path, pattern, message, issues);
}
function validateOptionalDateTimeString(value, path, issues) {
    if (value === undefined || value === null) {
        return;
    }
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        issues.push(issue(path, 'format', `${path.slice(1)} must be a valid date-time string.`));
    }
}
function validateNonEmptyString(value, path, message, issues) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push(issue(path, 'minLength', message));
    }
}
function validateNoAdditionalProperties(record, allowedKeys, issues, path) {
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(record)) {
        if (!allowed.has(key)) {
            issues.push(issue(path, 'additionalProperties', `Unexpected property ${key}.`, { additionalProperty: key }));
        }
    }
}
function issue(path, keyword, message, params = {}) {
    return { path, keyword, message, params };
}
function createDecompositionPlanError(code, message, details) {
    const error = new Error(message);
    error.name = 'DecompositionPlanError';
    error.code = code;
    error.details = details;
    return error;
}
function toPortablePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
