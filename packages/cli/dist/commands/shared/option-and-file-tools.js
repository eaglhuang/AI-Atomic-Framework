import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, configRelativePath, setFieldsProjection, setOutputJsonPath, setSummaryProjection } from './result-core.js';
const ALLOWED_FLAGS_MAP = {
    doctor: ['--ci-profile', '--skip-check'],
    spec: ['--spec', '--validate'],
    verify: ['--spec', '--self', '--neutrality', '--agents-md', '--guards', '--evidence'],
    'self-host-alpha': ['--verify', '--agent'],
    next: ['--spec', '--claim', '--tasks', '--actor', '--prompt', '--intent', '--task'],
    batch: ['--batch', '--scope', '--compact', '--hold', '--actor', '--reason', '--task'],
    quickfix: ['--actor', '--prompt', '--files', '--reason'],
    init: ['--spec', '--dry-run', '--adopt', '--integration', '--task'],
    bootstrap: ['--spec', '--task'],
    test: ['--atom', '--spec', '--profile', '--suite', '--map', '--equivalence-fixtures', '--fingerprint-check', '--edge-contracts', '--propagate'],
    welcome: ['--dry-run'],
    status: [],
    validate: ['--spec'],
    integration: ['--integration']
};
function getAllowedFlags(commandName) {
    const custom = ALLOWED_FLAGS_MAP[commandName] || [];
    const defaults = ['--cwd', '--force', '--json', '--pretty', '--output-json', '--summary', '--fields'];
    return [...new Set([...custom, ...defaults])].sort();
}
function createUsageError(commandName, messageText, options = {}) {
    const allowedFlags = getAllowedFlags(commandName);
    return new CliError('ATM_CLI_USAGE', messageText, {
        exitCode: 2,
        details: {
            invalidFlags: options.invalidFlags ?? [],
            missingRequired: options.missingRequired ?? [],
            allowedFlags,
            suggestedCommand: null
        }
    });
}
export function parseOptions(argv, commandName) {
    const options = {
        cwd: process.cwd(),
        ciProfile: undefined,
        spec: undefined,
        validate: undefined,
        self: false,
        neutrality: false,
        agentsMd: false,
        guards: false,
        evidence: undefined,
        verify: false,
        claim: false,
        apply: false,
        dryRun: false,
        force: false,
        adopt: undefined,
        integration: undefined,
        task: undefined,
        tasks: [],
        batch: undefined,
        scope: undefined,
        compact: false,
        hold: false,
        atom: undefined,
        map: undefined,
        propagate: undefined,
        profile: undefined,
        suite: undefined,
        fingerprintCheck: false,
        edgeContracts: false,
        agent: undefined,
        prompt: undefined,
        intent: undefined,
        files: [],
        reason: undefined,
        skipChecks: [],
        outputJson: undefined,
        summary: false,
        fields: null
    };
    const positional = [];
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--output-json') {
            options.outputJson = requireOptionValue(argv, index, '--output-json', commandName);
            setOutputJsonPath(options.outputJson ?? null);
            index += 1;
            continue;
        }
        if (arg === '--cwd') {
            options.cwd = requireOptionValue(argv, index, '--cwd', commandName);
            index += 1;
            continue;
        }
        if (arg === '--ci-profile') {
            if (commandName !== 'doctor') {
                throw createUsageError(commandName, `${commandName} does not support option --ci-profile`, { invalidFlags: ['--ci-profile'] });
            }
            options.ciProfile = requireOptionValue(argv, index, '--ci-profile', commandName);
            index += 1;
            continue;
        }
        if (arg === '--skip-check') {
            if (commandName !== 'doctor') {
                throw createUsageError(commandName, `${commandName} does not support option --skip-check`, { invalidFlags: ['--skip-check'] });
            }
            const raw = requireOptionValue(argv, index, '--skip-check', commandName);
            options.skipChecks = options.skipChecks.concat(raw.split(',').map((entry) => entry.trim()).filter(Boolean));
            index += 1;
            continue;
        }
        if (arg === '--spec') {
            if (!['spec', 'init', 'bootstrap', 'validate', 'test'].includes(commandName)) {
                throw createUsageError(commandName, `${commandName} does not support option --spec`, { invalidFlags: ['--spec'] });
            }
            options.spec = requireOptionValue(argv, index, '--spec', commandName);
            index += 1;
            continue;
        }
        if (arg === '--profile') {
            if (commandName !== 'test') {
                throw createUsageError(commandName, `${commandName} does not support option --profile`, { invalidFlags: ['--profile'] });
            }
            options.profile = requireOptionValue(argv, index, '--profile', commandName);
            index += 1;
            continue;
        }
        if (arg === '--suite') {
            if (commandName !== 'test') {
                throw createUsageError(commandName, `${commandName} does not support option --suite`, { invalidFlags: ['--suite'] });
            }
            options.suite = requireOptionValue(argv, index, '--suite', commandName);
            index += 1;
            continue;
        }
        if (arg === '--validate') {
            if (commandName !== 'spec') {
                throw createUsageError(commandName, `${commandName} does not support option --validate`, { invalidFlags: ['--validate'] });
            }
            options.validate = requireOptionValue(argv, index, '--validate', commandName);
            index += 1;
            continue;
        }
        if (arg === '--self') {
            if (commandName !== 'verify') {
                throw createUsageError(commandName, `${commandName} does not support option --self`, { invalidFlags: ['--self'] });
            }
            options.self = true;
            continue;
        }
        if (arg === '--neutrality') {
            if (commandName !== 'verify') {
                throw createUsageError(commandName, `${commandName} does not support option --neutrality`, { invalidFlags: ['--neutrality'] });
            }
            options.neutrality = true;
            continue;
        }
        if (arg === '--agents-md') {
            if (commandName !== 'verify') {
                throw createUsageError(commandName, `${commandName} does not support option --agents-md`, { invalidFlags: ['--agents-md'] });
            }
            options.agentsMd = true;
            continue;
        }
        if (arg === '--guards') {
            if (commandName !== 'verify') {
                throw createUsageError(commandName, `${commandName} does not support option --guards`, { invalidFlags: ['--guards'] });
            }
            options.guards = true;
            continue;
        }
        if (arg === '--evidence') {
            if (commandName !== 'verify') {
                throw createUsageError(commandName, `${commandName} does not support option --evidence`, { invalidFlags: ['--evidence'] });
            }
            options.evidence = requireOptionValue(argv, index, '--evidence', commandName);
            index += 1;
            continue;
        }
        if (arg === '--verify') {
            if (commandName !== 'self-host-alpha') {
                throw createUsageError(commandName, `${commandName} does not support option --verify`, { invalidFlags: ['--verify'] });
            }
            options.verify = true;
            continue;
        }
        if (arg === '--agent') {
            if (commandName !== 'self-host-alpha') {
                throw createUsageError(commandName, `${commandName} does not support option --agent`, { invalidFlags: ['--agent'] });
            }
            options.agent = requireOptionValue(argv, index, '--agent', commandName);
            index += 1;
            continue;
        }
        if (arg === '--claim') {
            if (commandName !== 'next') {
                throw createUsageError(commandName, `${commandName} does not support option --claim`, { invalidFlags: ['--claim'] });
            }
            options.claim = true;
            continue;
        }
        if (arg === '--apply') {
            if (commandName !== 'residue') {
                throw createUsageError(commandName, `${commandName} does not support option --apply`, { invalidFlags: ['--apply'] });
            }
            options.apply = true;
            continue;
        }
        if (arg === '--tasks') {
            if (commandName !== 'next') {
                throw createUsageError(commandName, `${commandName} does not support option --tasks`, { invalidFlags: ['--tasks'] });
            }
            const raw = requireOptionValue(argv, index, '--tasks', commandName);
            options.tasks = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
            index += 1;
            continue;
        }
        if (arg === '--batch') {
            if (commandName !== 'batch') {
                throw createUsageError(commandName, `${commandName} does not support option --batch`, { invalidFlags: ['--batch'] });
            }
            options.batch = requireOptionValue(argv, index, '--batch', commandName);
            index += 1;
            continue;
        }
        if (arg === '--scope') {
            if (commandName !== 'batch') {
                throw createUsageError(commandName, `${commandName} does not support option --scope`, { invalidFlags: ['--scope'] });
            }
            options.scope = requireOptionValue(argv, index, '--scope', commandName);
            index += 1;
            continue;
        }
        if (arg === '--compact') {
            if (commandName !== 'batch') {
                throw createUsageError(commandName, `${commandName} does not support option --compact`, { invalidFlags: ['--compact'] });
            }
            options.compact = true;
            continue;
        }
        if (arg === '--hold') {
            if (commandName !== 'batch') {
                throw createUsageError(commandName, `${commandName} does not support option --hold`, { invalidFlags: ['--hold'] });
            }
            options.hold = true;
            continue;
        }
        if (arg === '--actor') {
            if (!['next', 'batch', 'quickfix'].includes(commandName)) {
                throw createUsageError(commandName, `${commandName} does not support option --actor`, { invalidFlags: ['--actor'] });
            }
            options.agent = requireOptionValue(argv, index, '--actor', commandName);
            index += 1;
            continue;
        }
        if (arg === '--prompt') {
            if (!['next', 'quickfix'].includes(commandName)) {
                throw createUsageError(commandName, `${commandName} does not support option --prompt`, { invalidFlags: ['--prompt'] });
            }
            options.prompt = requireOptionValue(argv, index, '--prompt', commandName);
            index += 1;
            continue;
        }
        if (arg === '--intent') {
            if (commandName !== 'next') {
                throw createUsageError(commandName, `${commandName} does not support option --intent`, { invalidFlags: ['--intent'] });
            }
            options.intent = requireOptionValue(argv, index, '--intent', commandName);
            index += 1;
            continue;
        }
        if (arg === '--files') {
            if (!['next', 'quickfix'].includes(commandName)) {
                throw createUsageError(commandName, `${commandName} does not support option --files`, { invalidFlags: ['--files'] });
            }
            const raw = requireOptionValue(argv, index, '--files', commandName);
            options.files = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            if (!['batch', 'quickfix'].includes(commandName)) {
                throw createUsageError(commandName, `${commandName} does not support option --reason`, { invalidFlags: ['--reason'] });
            }
            options.reason = requireOptionValue(argv, index, '--reason', commandName);
            index += 1;
            continue;
        }
        if (arg === '--dry-run') {
            if (commandName !== 'init') {
                throw createUsageError(commandName, `${commandName} does not support option --dry-run`, { invalidFlags: ['--dry-run'] });
            }
            options.dryRun = true;
            continue;
        }
        if (arg === '--force') {
            options.force = true;
            continue;
        }
        if (arg === '--adopt') {
            if (commandName !== 'init') {
                throw createUsageError(commandName, `${commandName} does not support option --adopt`, { invalidFlags: ['--adopt'] });
            }
            if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
                options.adopt = 'default';
            }
            else {
                options.adopt = requireOptionValue(argv, index, '--adopt', commandName);
                index += 1;
            }
            continue;
        }
        if (arg === '--integration') {
            if (commandName !== 'init') {
                throw createUsageError(commandName, `${commandName} does not support option --integration`, { invalidFlags: ['--integration'] });
            }
            options.integration = requireOptionValue(argv, index, '--integration', commandName);
            index += 1;
            continue;
        }
        if (arg === '--atom') {
            if (commandName !== 'test') {
                throw createUsageError(commandName, `${commandName} does not support option --atom`, { invalidFlags: ['--atom'] });
            }
            options.atom = requireOptionValue(argv, index, '--atom', commandName);
            index += 1;
            continue;
        }
        if (arg === '--map') {
            if (commandName !== 'test') {
                throw createUsageError(commandName, `${commandName} does not support option --map`, { invalidFlags: ['--map'] });
            }
            options.map = requireOptionValue(argv, index, '--map', commandName);
            index += 1;
            continue;
        }
        if (arg === '--equivalence-fixtures') {
            if (commandName !== 'test') {
                throw createUsageError(commandName, `${commandName} does not support option --equivalence-fixtures`, { invalidFlags: ['--equivalence-fixtures'] });
            }
            options.equivalenceFixtures = requireOptionValue(argv, index, '--equivalence-fixtures', commandName);
            index += 1;
            continue;
        }
        if (arg === '--fingerprint-check') {
            if (commandName !== 'test') {
                throw createUsageError(commandName, `${commandName} does not support option --fingerprint-check`, { invalidFlags: ['--fingerprint-check'] });
            }
            options.fingerprintCheck = true;
            continue;
        }
        if (arg === '--edge-contracts') {
            if (!['test'].includes(commandName)) {
                throw createUsageError(commandName, `${commandName} does not support option --edge-contracts`, { invalidFlags: ['--edge-contracts'] });
            }
            options.edgeContracts = true;
            continue;
        }
        if (arg === '--propagate') {
            if (commandName !== 'test') {
                throw createUsageError(commandName, `${commandName} does not support option --propagate`, { invalidFlags: ['--propagate'] });
            }
            options.propagate = requireOptionValue(argv, index, '--propagate', commandName);
            index += 1;
            continue;
        }
        if (arg === '--task') {
            if (!['init', 'bootstrap', 'next', 'tasks', 'batch'].includes(commandName)) {
                throw createUsageError(commandName, `${commandName} does not support option --task`, { invalidFlags: ['--task'] });
            }
            options.task = requireOptionValue(argv, index, '--task', commandName);
            index += 1;
            continue;
        }
        if (arg === '--summary') {
            options.summary = true;
            setSummaryProjection(true);
            continue;
        }
        if (arg === '--fields') {
            const raw = requireOptionValue(argv, index, '--fields', commandName);
            options.fields = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
            setFieldsProjection(options.fields);
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        if (arg.startsWith('--')) {
            throw createUsageError(commandName, `${commandName} does not support option ${arg}`, { invalidFlags: [arg] });
        }
        positional.push(arg);
    }
    return {
        options: {
            ...options,
            cwd: path.resolve(options.cwd)
        },
        positional
    };
}
export function configPathFor(cwd) {
    return path.join(cwd, configRelativePath);
}
export function relativePathFrom(cwd, absolutePath) {
    return path.relative(cwd, absolutePath).replace(/\\/g, '/');
}
export function ensureAtmDirectory(cwd) {
    const directory = path.join(cwd, '.atm');
    mkdirSync(directory, { recursive: true });
    return directory;
}
export function readJsonFile(filePath, missingCode = 'ATM_JSON_NOT_FOUND') {
    if (!existsSync(filePath)) {
        throw new CliError(missingCode, `JSON file not found: ${filePath}`, { details: { filePath } });
    }
    try {
        return parseJsonText(readFileSync(filePath, 'utf8'));
    }
    catch (error) {
        throw new CliError('ATM_JSON_INVALID', `Invalid JSON file: ${filePath}`, {
            details: {
                filePath,
                reason: error instanceof Error ? error.message : String(error)
            }
        });
    }
}
export function writeJsonFile(filePath, value) {
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export function stripUtf8Bom(text) {
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
export function parseJsonText(text) {
    return JSON.parse(stripUtf8Bom(text));
}
function requireOptionValue(argv, optionIndex, optionName, commandName) {
    const value = argv[optionIndex + 1];
    if (!value || value.startsWith('--')) {
        throw createUsageError(commandName, `${commandName} requires a value for ${optionName}`, { missingRequired: [optionName] });
    }
    return value;
}
