import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateAtomRefReadability } from '../../../core/dist/registry/atom-ref-readability.js';
import { runFrameworkDevelopmentValidation } from './framework-development.js';
import { configPathFor, makeResult, message, parseOptions, readJsonFile, relativePathFrom } from './shared.js';
const requiredAtomicSpecFields = [
    'schemaId',
    'specVersion',
    'migration',
    'id',
    'title',
    'language',
    'runtime',
    'adapterRequirements',
    'compatibility',
    'hashLock'
];
export function runValidate(argv) {
    if (argv.includes('taxonomy')) {
        const repo = valueAfter(argv, '--repo') ?? valueAfter(argv, '--cwd') ?? process.cwd();
        const taskId = valueAfter(argv, '--task');
        return runValidateTaxonomy(repo, taskId);
    }
    if (argv.includes('atom-callsite-readability')) {
        const repo = valueAfter(argv, '--repo') ?? valueAfter(argv, '--cwd') ?? process.cwd();
        const report = validateAtomRefReadability(path.resolve(repo));
        return makeResult({
            ok: report.ok,
            command: 'validate',
            cwd: path.resolve(repo),
            messages: [report.ok
                    ? message('info', 'ATM_VALIDATE_ATOM_CALLSITE_READABILITY_OK', 'Atom/map callsite readability validation passed.')
                    : message('error', 'ATM_VALIDATE_ATOM_CALLSITE_READABILITY_FAILED', 'Atom/map callsite readability validation failed.', { violationCount: report.violationCount })],
            evidence: {
                validation: 'atom-callsite-readability',
                report
            }
        });
    }
    if (argv.includes('atomization-coverage')) {
        const repo = valueAfter(argv, '--repo') ?? valueAfter(argv, '--cwd') ?? process.cwd();
        return validateAtomizationCoverage(path.resolve(repo));
    }
    if (argv.includes('framework-development')) {
        const repo = valueAfter(argv, '--repo') ?? valueAfter(argv, '--cwd') ?? process.cwd();
        const files = (valueAfter(argv, '--files') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
        const targetRepo = valueAfter(argv, '--target-repo');
        return runFrameworkDevelopmentValidation(path.resolve(repo), files, targetRepo);
    }
    const { options } = parseOptions(argv, 'validate');
    if (options.spec) {
        return validateAtomicSpecFile(options.cwd, options.spec);
    }
    return validateRepositoryConfig(options.cwd);
}
function valueAfter(argv, flag) {
    const index = argv.indexOf(flag);
    if (index === -1) {
        return null;
    }
    const value = argv[index + 1];
    return typeof value === 'string' && !value.startsWith('--') ? value : null;
}
function validateAtomizationCoverage(cwd) {
    // Delegate to scripts/validate-atomization-coverage.ts for real validation
    // against atm.atomizationCoverageValidation.v1 schema.
    const scriptPath = path.resolve(cwd, 'scripts', 'validate-atomization-coverage.ts');
    if (!existsSync(scriptPath)) {
        return makeResult({
            ok: false,
            command: 'validate',
            cwd,
            messages: [
                message('error', 'ATM_VALIDATE_ATOMIZATION_COVERAGE_SCRIPT_MISSING', 'scripts/validate-atomization-coverage.ts is missing. Run TASK-ASA-0004 to add it.', {})
            ],
            evidence: { validation: 'atomization-coverage' }
        });
    }
    try {
        const cmd = `node --strip-types "${scriptPath}" --mode validate --repo "${cwd}"`;
        let stdout = '';
        let exitCode = 0;
        try {
            stdout = execSync(cmd, { encoding: 'utf8' });
        }
        catch (err) {
            stdout = err.stdout?.toString() ?? '';
            exitCode = err.status ?? 1;
        }
        const report = stdout ? JSON.parse(stdout) : { ok: false, violations: [{ detail: 'no output' }] };
        const violations = report.violations ?? [];
        return makeResult({
            ok: exitCode === 0,
            command: 'validate',
            cwd,
            messages: exitCode === 0
                ? [message('info', 'ATM_VALIDATE_ATOMIZATION_COVERAGE_OK', 'Atomization coverage validation passed.')]
                : [message('error', 'ATM_VALIDATE_ATOMIZATION_COVERAGE_FAILED', `Atomization coverage has ${violations.length} violations.`, { violations })],
            evidence: {
                validation: 'atomization-coverage',
                schemaId: report.schemaId,
                report
            }
        });
    }
    catch (err) {
        return makeResult({
            ok: false,
            command: 'validate',
            cwd,
            messages: [
                message('error', 'ATM_VALIDATE_ATOMIZATION_COVERAGE_FAILED', `Atomization coverage validation failed: ${err.message}`, {})
            ],
            evidence: { validation: 'atomization-coverage', error: err.message }
        });
    }
}
function validateRepositoryConfig(cwd) {
    const configPath = configPathFor(cwd);
    if (!existsSync(configPath)) {
        return makeResult({
            ok: false,
            command: 'validate',
            cwd,
            messages: [message('error', 'ATM_CONFIG_MISSING', 'ATM config is missing. Run atm init before repository validation.')],
            evidence: {
                configPath: relativePathFrom(cwd, configPath),
                validated: []
            }
        });
    }
    const config = readJsonFile(configPath, 'ATM_CONFIG_MISSING');
    const messages = [];
    if (config.schemaVersion !== 'atm.config.v0.1') {
        messages.push(message('error', 'ATM_CONFIG_UNSUPPORTED_VERSION', 'ATM config schemaVersion is not supported.', { schemaVersion: config.schemaVersion }));
    }
    if (config.adapter?.mode !== 'standalone') {
        messages.push(message('error', 'ATM_CONFIG_ADAPTER_MODE', 'ATM-1 CLI MVP only supports standalone mode.', { adapterMode: config.adapter?.mode }));
    }
    if (messages.length === 0) {
        messages.push(message('info', 'ATM_VALIDATE_REPOSITORY_OK', 'ATM repository config validated in standalone mode.'));
    }
    return makeResult({
        ok: messages.every((entry) => entry.level !== 'error'),
        command: 'validate',
        cwd,
        messages,
        evidence: {
            validated: [relativePathFrom(cwd, configPath)],
            adapterMode: config.adapter?.mode,
            adapterImplemented: config.adapter?.implemented === true
        }
    });
}
function validateAtomicSpecFile(cwd, specOption) {
    const specPath = path.resolve(cwd, specOption);
    if (!existsSync(specPath)) {
        return makeResult({
            ok: false,
            command: 'validate',
            cwd,
            messages: [message('error', 'ATM_SPEC_NOT_FOUND', 'Atomic spec file was not found.', { specPath })],
            evidence: {
                specPath,
                validated: []
            }
        });
    }
    const spec = readJsonFile(specPath, 'ATM_SPEC_NOT_FOUND');
    const errors = validateAtomicSpecShape(spec);
    const messages = errors.length > 0
        ? errors.map((entry) => message('error', entry.code, entry.text, { path: entry.path }))
        : [message('info', 'ATM_VALIDATE_SPEC_OK', 'Atomic spec validated against CLI MVP checks.')];
    return makeResult({
        ok: errors.length === 0,
        command: 'validate',
        cwd,
        messages,
        evidence: {
            specPath,
            schemaId: spec.schemaId,
            specVersion: spec.specVersion,
            atomId: spec.id,
            validated: [specPath]
        }
    });
}
function validateAtomicSpecShape(spec) {
    const errors = [];
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        return [{ code: 'ATM_SPEC_INVALID_OBJECT', path: '/', text: 'Atomic spec must be a JSON object.' }];
    }
    for (const field of requiredAtomicSpecFields) {
        if (!(field in spec)) {
            errors.push({ code: 'ATM_SPEC_REQUIRED_FIELD', path: `/${field}`, text: `Atomic spec is missing required field: ${field}` });
        }
    }
    requireConst(errors, spec.schemaId, 'atm.atomicSpec', '/schemaId');
    requireConst(errors, spec.specVersion, '0.1.0', '/specVersion');
    requireStringPattern(errors, spec.id, /^ATM-[A-Z][A-Z0-9]*-\d{4}$/, '/id', 'ATM_SPEC_ID_PATTERN');
    requireNonEmptyString(errors, spec.title, '/title');
    requireEnum(errors, spec.migration?.strategy, ['none', 'additive', 'breaking'], '/migration/strategy');
    requireEnum(errors, spec.language?.primary, ['language-neutral', 'javascript', 'typescript', 'json', 'markdown', 'shell', 'other'], '/language/primary');
    requireEnum(errors, spec.runtime?.kind, ['language-neutral', 'node', 'browser', 'deno', 'shell', 'custom'], '/runtime/kind');
    requireEnum(errors, spec.runtime?.environment, ['local', 'ci', 'sandbox', 'any'], '/runtime/environment');
    requireEnum(errors, spec.adapterRequirements?.storage, ['local-fs', 'git', 'host-adapter', 'none'], '/adapterRequirements/storage');
    requireStringPattern(errors, spec.compatibility?.coreVersion, /^\d+\.\d+\.\d+$/, '/compatibility/coreVersion', 'ATM_SPEC_VERSION_PATTERN');
    requireStringPattern(errors, spec.compatibility?.registryVersion, /^\d+\.\d+\.\d+$/, '/compatibility/registryVersion', 'ATM_SPEC_VERSION_PATTERN');
    requireConst(errors, spec.hashLock?.algorithm, 'sha256', '/hashLock/algorithm');
    requireStringPattern(errors, spec.hashLock?.digest, /^sha256:[a-f0-9]{64}$/, '/hashLock/digest', 'ATM_SPEC_HASH_PATTERN');
    requireEnum(errors, spec.hashLock?.canonicalization, ['json-stable-v1', 'text-normalized-v1'], '/hashLock/canonicalization');
    if (spec.dependencyPolicy) {
        requireEnum(errors, spec.dependencyPolicy.external, ['none', 'workspace-only', 'declared'], '/dependencyPolicy/external');
        requireEnum(errors, spec.dependencyPolicy.hostCoupling, ['forbidden', 'adapter-only', 'allowed'], '/dependencyPolicy/hostCoupling');
    }
    return errors;
}
function requireConst(errors, value, expected, checkPath) {
    if (value !== expected) {
        errors.push({ code: 'ATM_SPEC_CONST_MISMATCH', path: checkPath, text: `${checkPath} must be ${expected}.` });
    }
}
function requireEnum(errors, value, allowed, checkPath) {
    if (!allowed.includes(value)) {
        errors.push({ code: 'ATM_SPEC_ENUM_MISMATCH', path: checkPath, text: `${checkPath} must be one of: ${allowed.join(', ')}.` });
    }
}
function requireNonEmptyString(errors, value, checkPath) {
    if (typeof value !== 'string' || value.length === 0) {
        errors.push({ code: 'ATM_SPEC_STRING_REQUIRED', path: checkPath, text: `${checkPath} must be a non-empty string.` });
    }
}
function requireStringPattern(errors, value, pattern, checkPath, code) {
    if (typeof value !== 'string' || !pattern.test(value)) {
        errors.push({ code, path: checkPath, text: `${checkPath} does not match the required pattern.` });
    }
}
function runValidateTaxonomy(repo, taskId) {
    const resolvedCwd = path.resolve(repo);
    let touchedFiles = [];
    if (taskId) {
        const taskPath = path.resolve(resolvedCwd, '.atm', 'history', 'tasks', `${taskId.trim()}.json`);
        if (existsSync(taskPath)) {
            try {
                const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
                if (taskDocument && typeof taskDocument === 'object') {
                    const readList = (key) => {
                        const value = taskDocument[key];
                        if (!Array.isArray(value))
                            return [];
                        return value.filter((entry) => typeof entry === 'string');
                    };
                    const uniq = (arr) => [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
                    touchedFiles = uniq([
                        ...readList('deliverables'),
                        ...readList('scopePaths'),
                        ...readList('targetAllowedFiles')
                    ]);
                }
            }
            catch {
                // ignore JSON parse errors
            }
        }
    }
    const standardGates = [
        'typecheck',
        'validate:cli',
        'validate:git-head-evidence',
        'validate:neutrality',
        'doctor',
        'framework-development',
        'tasks-audit',
        'validate:integration-adapter',
        'validate:skill-templates',
        'validate:root-drop-release',
        'validate:onefile-release'
    ];
    const taxonomy = {};
    const descriptions = {
        'typecheck': 'TypeScript compilation and static type validation.',
        'validate:cli': 'CLI integration tests and help snapshot validation.',
        'validate:git-head-evidence': 'Git HEAD backfill verification.',
        'validate:neutrality': 'Vocabulary neutrality validation to prevent downstream leak.',
        'doctor': 'Repository environment setup diagnostics.',
        'framework-development': 'Framework development consistency checks.',
        'tasks-audit': 'Task status and lifecycle synchronization audit.',
        'validate:integration-adapter': 'Release-blocking integration adapter validation.',
        'validate:skill-templates': 'Release-blocking skill template validation.',
        'validate:root-drop-release': 'Release-blocking root drop release check.',
        'validate:onefile-release': 'Release-blocking onefile single bundle check.'
    };
    for (const gate of standardGates) {
        const scope = getValidatorScope(gate, touchedFiles);
        taxonomy[gate] = {
            scope,
            description: descriptions[gate] ?? 'Validator check.'
        };
    }
    return makeResult({
        ok: true,
        command: 'validate',
        cwd: resolvedCwd,
        messages: [
            message('info', 'ATM_VALIDATE_TAXONOMY_OK', `Loaded validator scope taxonomy${taskId ? ` for task ${taskId}` : ''}.`)
        ],
        evidence: {
            validation: 'taxonomy',
            taskId: taskId ?? null,
            taxonomy
        }
    });
}
/**
 * TASK-MAO-0042: 依據 Validator Scope Taxonomy 分類 gate 的範疇
 */
export function getValidatorScope(gateName, touchedFiles = []) {
    const gate = gateName.trim();
    // 1. Release blocking
    if (gate === 'validate:integration-adapter' ||
        gate === 'validate:skill-templates' ||
        gate === 'validate:root-drop-release' ||
        gate === 'validate:onefile-release') {
        return 'release-blocking';
    }
    // 2. Neutrality special case (touched protected surface makes it task-local)
    if (gate === 'validate:neutrality') {
        const hasProtected = touchedFiles.some((file) => {
            const normalized = file.replace(/\\/g, '/');
            return (normalized.startsWith('packages/core/') ||
                normalized.startsWith('packages/plugin-rule-guard/') ||
                normalized === 'scripts/validate-neutrality-scanner.ts' ||
                normalized === 'specs/neutrality-scanner.atom.json' ||
                normalized === 'tests/neutrality.fixture.json');
        });
        return hasProtected ? 'task-local' : 'global-advisory';
    }
    // 3. Task Local
    if (gate === 'typecheck' ||
        gate === 'validate:cli' ||
        gate === 'validate:git-head-evidence' ||
        gate.startsWith('validate:')) {
        return 'task-local';
    }
    // 4. Global Advisory
    if (gate === 'doctor' ||
        gate === 'framework-development' ||
        gate === 'tasks-audit' ||
        gate === 'git-head-evidence') {
        return 'global-advisory';
    }
    // Default to diagnostic
    return 'diagnostic';
}
