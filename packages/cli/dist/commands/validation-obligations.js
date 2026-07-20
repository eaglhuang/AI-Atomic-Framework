export const VALIDATION_OBLIGATION_MAP_SCHEMA_ID = 'atm.validationObligationMap.v1';
export const VALIDATION_OBLIGATION_MAP_VERSION = '2026-07-14.phase1';
export const VALIDATION_OBLIGATION_RULES = [
    {
        id: 'validator-facade-selection',
        description: 'Validator facade selection and test catalog changes must exercise the facade contract.',
        patterns: [
            'scripts/run-validators.ts',
            'scripts/lib/test-catalog.ts',
            'scripts/test-catalog.config.json',
            'scripts/validators.config.json',
            'packages/cli/src/commands/validation-obligations.ts'
        ],
        validators: ['validate-test-facade'],
        rationale: 'Path-scoped validator selection is the public cost-control lane for task validation.'
    },
    {
        id: 'typescript-static',
        description: 'TypeScript and JavaScript source changes require static language validation.',
        patterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
        validators: ['typecheck'],
        rationale: 'Static validation is the first available language adapter obligation.'
    },
    {
        id: 'task-ledger-governance',
        description: 'Task ledger command and validator changes must keep ledger governance covered.',
        patterns: [
            'packages/cli/src/commands/tasks/**',
            'scripts/validators/task-ledger/**',
            '.atm/history/tasks/*.json'
        ],
        validators: ['validate-task-ledger-governance'],
        rationale: 'Task ledger state is a governed commit surface and should not rely only on broad suites.'
    },
    {
        id: 'git-evidence-head',
        description: 'Git head evidence and closeout surfaces require git-head evidence validation.',
        patterns: [
            'packages/cli/src/commands/framework-development/**',
            'scripts/validate-git-head-evidence.ts'
        ],
        validators: ['validate-git-head-evidence'],
        rationale: 'Receipt and sealed-commit flows depend on exact HEAD identity.'
    }
];
export function resolveValidationObligations(changedPaths) {
    const normalizedPaths = [...new Set(changedPaths.map(normalizePath).filter(Boolean))];
    const validators = new Set();
    const matchedRules = [];
    for (const rule of VALIDATION_OBLIGATION_RULES) {
        for (const pattern of rule.patterns) {
            for (const candidatePath of normalizedPaths) {
                if (!matchesPattern(pattern, candidatePath))
                    continue;
                for (const validator of rule.validators) {
                    validators.add(validator);
                }
                matchedRules.push({
                    ruleId: rule.id,
                    pattern,
                    path: candidatePath,
                    validators: [...rule.validators]
                });
            }
        }
    }
    return {
        schemaId: VALIDATION_OBLIGATION_MAP_SCHEMA_ID,
        mappingVersion: VALIDATION_OBLIGATION_MAP_VERSION,
        changedPaths: normalizedPaths,
        validators: [...validators].sort(),
        matchedRules,
        deferred: {
            symbolLevelMinimization: {
                status: 'deferred',
                reason: 'Phase 1 uses path-level obligations only; symbol-level minimization needs import graph or fs-trace evidence.',
                requiredEvidence: ['import-graph', 'fs-trace']
            }
        }
    };
}
export function createSealedCommitCanaryPlan(options) {
    const commitSha = normalizeCommitSha(options.commitSha);
    const validators = [...new Set(options.validators?.length ? options.validators.map(String) : ['full-suite'])].sort();
    return {
        schemaId: 'atm.sealedCommitCanaryPlan.v1',
        mappingVersion: VALIDATION_OBLIGATION_MAP_VERSION,
        commitSha,
        mode: 'non-blocking',
        checkout: {
            cleanCheckoutRequired: true,
            exactCommitSha: commitSha
        },
        validators,
        command: `git worktree add --detach <clean-checkout-dir> ${commitSha} && node --strip-types scripts/run-validators.ts full --parallel --json`,
        failureIncidentSchemaId: 'atm.mappingGapIncident.v1'
    };
}
export function createMappingGapIncident(options) {
    return {
        schemaId: 'atm.mappingGapIncident.v1',
        mappingVersion: VALIDATION_OBLIGATION_MAP_VERSION,
        commitSha: normalizeCommitSha(options.commitSha),
        changedPaths: [...new Set(options.changedPaths.map(normalizePath).filter(Boolean))],
        expectedValidators: [...new Set(options.expectedValidators.map(String))].sort(),
        failedValidators: [...new Set(options.failedValidators.map(String))].sort(),
        severity: 'advisory',
        remediation: 'Review the declarative path-to-validator obligation map and add or tighten rules before promoting the canary lane to blocking.'
    };
}
function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}
function normalizeCommitSha(value) {
    const text = String(value || '').trim();
    if (!/^[0-9a-f]{7,40}$/i.test(text)) {
        throw new Error(`Invalid commit SHA for sealed canary: ${value}`);
    }
    return text;
}
function matchesPattern(pattern, candidatePath) {
    const escaped = String(pattern || '')
        .replace(/\\/g, '/')
        .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
        .replace(/\*\*/g, '::DOUBLE_STAR::')
        .replace(/\*/g, '[^/]*')
        .replace(/::DOUBLE_STAR::/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(normalizePath(candidatePath));
}
