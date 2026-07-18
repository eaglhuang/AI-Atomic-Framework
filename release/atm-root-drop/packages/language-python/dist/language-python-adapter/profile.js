import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createStaticCheckPlan } from './shared.js';
export function detectPythonProjectProfile(repositoryRoot) {
    const hasPyprojectToml = existsSync(path.join(repositoryRoot, 'pyproject.toml'));
    const hasRequirementsTxt = existsSync(path.join(repositoryRoot, 'requirements.txt'));
    const hasSetupPy = existsSync(path.join(repositoryRoot, 'setup.py'));
    const hasSetupCfg = existsSync(path.join(repositoryRoot, 'setup.cfg'));
    const hasPipfile = existsSync(path.join(repositoryRoot, 'Pipfile'));
    const hasPoetryLock = existsSync(path.join(repositoryRoot, 'poetry.lock'));
    const packageManager = detectPackageManager(repositoryRoot, { hasPyprojectToml, hasPipfile, hasPoetryLock });
    const declaredScripts = collectDeclaredScripts(repositoryRoot, { hasPyprojectToml });
    const testCommand = pickFirstAvailableCommand([
        declaredScripts.includes('test') ? formatScriptCommand(packageManager, 'test') : null,
        hasPyprojectToml ? formatToolCommand(packageManager, 'pytest') : null,
        hasRequirementsTxt ? formatToolCommand(packageManager, 'pytest') : null
    ]);
    const typecheckCommand = pickFirstAvailableCommand([
        declaredScripts.includes('typecheck') ? formatScriptCommand(packageManager, 'typecheck') : null,
        hasPyprojectToml ? formatToolCommand(packageManager, 'mypy .') : null
    ]);
    const lintCommand = pickFirstAvailableCommand([
        declaredScripts.includes('lint') ? formatScriptCommand(packageManager, 'lint') : null,
        hasPyprojectToml ? formatToolCommand(packageManager, 'ruff check .') : null
    ]);
    return {
        packageManager,
        hasPyprojectToml,
        hasRequirementsTxt,
        hasSetupPy,
        hasSetupCfg,
        hasPipfile,
        hasPoetryLock,
        testCommand,
        typecheckCommand,
        lintCommand,
        declaredScripts
    };
}
export function createPythonCommandRunnerContract(profile) {
    const commands = [];
    if (profile.testCommand) {
        commands.push({ commandKind: 'test', command: profile.testCommand, required: true });
    }
    if (profile.typecheckCommand) {
        commands.push({ commandKind: 'typecheck', command: profile.typecheckCommand, required: false });
    }
    if (profile.lintCommand) {
        commands.push({ commandKind: 'lint', command: profile.lintCommand, required: false });
    }
    return {
        executionMode: 'delegated',
        packageManager: profile.packageManager,
        commands
    };
}
export function createFastPythonStaticCheck(profile) {
    const commands = profile.typecheckCommand
        ? [profile.typecheckCommand]
        : profile.lintCommand
            ? [profile.lintCommand]
            : [];
    return createStaticCheckPlan('fast', commands, commands.length > 0
        ? {
            source: 'adapter-composed',
            kinds: profile.typecheckCommand ? ['syntax', 'typecheck'] : ['syntax', 'lint'],
            guidance: profile.typecheckCommand
                ? 'Run Python typecheck first when available; it is the fastest broad static signal for touched Python edits.'
                : 'Run Python lint as the fastest available static gate because no typecheck command is declared.'
        }
        : {
            source: 'unavailable',
            kinds: [],
            guidance: 'No Python fast static command is declared yet. Add typecheck or lint tooling so ATM can gate touched Python changes early.'
        });
}
export function createDefaultPythonStaticCheck(profile) {
    const commands = [...new Set([profile.typecheckCommand, profile.lintCommand].filter(Boolean))];
    return createStaticCheckPlan('default', commands, commands.length > 0
        ? {
            source: 'adapter-composed',
            kinds: ['syntax', 'typecheck', 'lint'],
            guidance: 'Default Python static pass should cover both typecheck and lint before slower execution validators.'
        }
        : {
            source: 'unavailable',
            kinds: [],
            guidance: 'No Python default static commands are declared yet. Add typecheck and lint commands so ATM can offer a normal static lane.'
        });
}
export function createAllPythonStaticCheck(profile) {
    const commands = [...new Set([profile.typecheckCommand, profile.lintCommand].filter(Boolean))];
    return createStaticCheckPlan('all', commands, commands.length > 0
        ? {
            source: 'adapter-composed',
            kinds: ['syntax', 'typecheck', 'lint'],
            guidance: 'Python all-static currently runs the full declared static set. Keep runtime tests outside this static contract.'
        }
        : {
            source: 'unavailable',
            kinds: [],
            guidance: 'No Python all-static commands are declared yet. Add static tooling before expecting adapter-aware governance hints.'
        });
}
export function createUnknownProfile() {
    return {
        packageManager: 'unknown',
        hasPyprojectToml: false,
        hasRequirementsTxt: false,
        hasSetupPy: false,
        hasSetupCfg: false,
        hasPipfile: false,
        hasPoetryLock: false,
        testCommand: null,
        typecheckCommand: null,
        lintCommand: null,
        declaredScripts: []
    };
}
function collectDeclaredScripts(repositoryRoot, hints) {
    if (!hints.hasPyprojectToml)
        return [];
    try {
        const source = readFileSync(path.join(repositoryRoot, 'pyproject.toml'), 'utf8');
        const scriptsSection = /\[project\.scripts\]([\s\S]*?)(?:\n\[|$)/.exec(source);
        if (!scriptsSection)
            return [];
        const lines = scriptsSection[1].split(/\r?\n/);
        const scripts = [];
        for (const line of lines) {
            const match = /^\s*([A-Za-z_][\w-]*)\s*=/.exec(line);
            if (match) {
                scripts.push(match[1]);
            }
        }
        return scripts.sort();
    }
    catch {
        return [];
    }
}
function detectPackageManager(repositoryRoot, hints) {
    if (hints.hasPoetryLock)
        return 'poetry';
    if (hints.hasPipfile)
        return 'pipenv';
    if (existsSync(path.join(repositoryRoot, 'uv.lock')))
        return 'uv';
    if (hints.hasPyprojectToml) {
        const pyproject = safeRead(path.join(repositoryRoot, 'pyproject.toml'));
        if (pyproject.includes('[tool.poetry'))
            return 'poetry';
        if (pyproject.includes('[tool.hatch'))
            return 'hatch';
        if (pyproject.includes('[tool.uv'))
            return 'uv';
        return 'pip';
    }
    if (existsSync(path.join(repositoryRoot, 'requirements.txt')))
        return 'pip';
    return 'unknown';
}
function formatScriptCommand(packageManager, scriptName) {
    if (packageManager === 'poetry')
        return `poetry run ${scriptName}`;
    if (packageManager === 'pipenv')
        return `pipenv run ${scriptName}`;
    if (packageManager === 'uv')
        return `uv run ${scriptName}`;
    if (packageManager === 'hatch')
        return `hatch run ${scriptName}`;
    return scriptName;
}
function formatToolCommand(packageManager, command) {
    if (packageManager === 'poetry')
        return `poetry run ${command}`;
    if (packageManager === 'pipenv')
        return `pipenv run ${command}`;
    if (packageManager === 'uv')
        return `uv run ${command}`;
    if (packageManager === 'hatch')
        return `hatch run ${command}`;
    return command;
}
function pickFirstAvailableCommand(candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0)
            return candidate;
    }
    return null;
}
function safeRead(filePath) {
    try {
        return readFileSync(filePath, 'utf8');
    }
    catch {
        return '';
    }
}
