#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const createAtmPackage = {
    packageName: 'create-atm',
    packageRole: 'npm-create-governance-onboarding',
    packageVersion: '0.0.0'
};
export function runCreateAtm(argv = process.argv.slice(2)) {
    const startedAt = Date.now();
    if (argv.includes('--help') || argv.includes('-h')) {
        process.stdout.write('Usage: create-atm <project-name> [--agent <pack-id>] [--cwd <dir>] [--tag latest|next|beta|lts] [--cli-version <exact-semver>] [--json]\n');
        return 0;
    }
    const options = parseArgs(argv);
    const distTag = resolveCreateAtmDistTag(options.tag, argv.includes('--tag'), options.cliVersion);
    const targetRoot = path.resolve(options.cwd, options.projectName);
    ensureCreatableTarget(targetRoot);
    mkdirSync(targetRoot, { recursive: true });
    writeDistTagSelection(targetRoot, distTag);
    let atmExecution = resolveAtmExecutionPlan(distTag.requestedTag);
    const steps = [];
    if (options.cliVersion || atmExecution.source !== 'source-tree') {
        const runtime = installTargetRuntime(targetRoot, distTag.npmPackageSpec);
        steps.push(runtime.step);
        if (runtime.execution)
            atmExecution = runtime.execution;
    }
    const plannedSteps = [
        { name: 'bootstrap', args: ['bootstrap', '--cwd', targetRoot, '--json'] },
        { name: 'atm-chart render', args: ['atm-chart', 'render', '--cwd', targetRoot, '--json'] }
    ];
    if (options.agent) {
        plannedSteps.push({ name: `integration add ${options.agent}`, args: ['integration', 'add', options.agent, '--cwd', targetRoot, '--json'] });
        if (options.agent === 'codex') {
            plannedSteps.push({ name: 'guide install-skill host', args: ['guide', 'install-skill', '--target', 'host', '--cwd', targetRoot, '--json'] });
        }
    }
    if (atmExecution.source === 'target-dependency') {
        plannedSteps.push({ name: 'first-use next', args: ['next', '--cwd', targetRoot, '--json'] });
    }
    for (const step of steps.some((entry) => entry.exitCode !== 0) ? [] : plannedSteps) {
        const result = runAtmStep(step.name, atmExecution, step.args);
        steps.push(result);
        if (result.exitCode !== 0)
            break;
    }
    if (steps.every((step) => step.exitCode === 0))
        steps.push(createInitialCommit(targetRoot));
    const failedStep = steps.find((step) => step.exitCode !== 0);
    const payload = {
        ok: failedStep === undefined,
        command: 'create-atm',
        cwd: options.cwd,
        messages: [
            failedStep
                ? { level: 'error', code: 'ATM_CREATE_FAILED', text: `create-atm failed at step: ${failedStep.name}${failedStep.name === 'initial commit' ? `. ${failedStep.stderr.trim()}` : ''}` }
                : { level: 'info', code: 'ATM_CREATE_READY', text: `ATM governance project created at ${targetRoot}` }
        ],
        evidence: {
            projectRoot: targetRoot,
            agent: options.agent ?? null,
            atmEntrypoint: atmExecution.display,
            atmEntrypointSource: atmExecution.source,
            runtimeVersion: atmExecution.runtimeVersion ?? null,
            distTag,
            durationMs: Date.now() - startedAt,
            steps: steps.map((step) => ({
                name: step.name,
                exitCode: step.exitCode,
                durationMs: step.durationMs
            }))
        }
    };
    writePayload(payload, options.json);
    return failedStep ? failedStep.exitCode : 0;
}
function createInitialCommit(targetRoot) {
    const startedAt = Date.now();
    const env = { ...process.env };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'])
        delete env[key];
    const run = (...args) => spawnSync('git', ['-C', targetRoot, ...args], { encoding: 'utf8', env, windowsHide: true, timeout: 30_000 });
    const result = (exitCode, stderr, stdout = '') => ({ name: 'initial commit', exitCode, stderr, stdout, durationMs: Date.now() - startedAt });
    const init = run('init', '--quiet');
    if (init.status !== 0)
        return result(init.status ?? 1, init.stderr || init.error?.message || 'Git initialization failed.');
    const top = run('rev-parse', '--show-toplevel');
    if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(targetRoot))
        return result(1, 'Git root does not match the new project; no files were staged.');
    const name = run('config', 'user.name').stdout.trim();
    const email = run('config', 'user.email').stdout.trim();
    if ((!name && (!env.GIT_AUTHOR_NAME || !env.GIT_COMMITTER_NAME)) || (!email && (!env.GIT_AUTHOR_EMAIL || !env.GIT_COMMITTER_EMAIL))) {
        return result(1, 'Configure Git user.name and user.email, then create the initial commit in the generated project. Generated files are preserved.');
    }
    if (existsSync(path.join(targetRoot, 'node_modules')) && run('check-ignore', '--quiet', 'node_modules').status !== 0) {
        return result(1, 'Project dependencies are not ignored; no files were staged.');
    }
    const add = run('add', '--all', '--', '.');
    if (add.status !== 0)
        return result(add.status ?? 1, add.stderr || 'Initial staging failed.');
    const commit = run('commit', '-m', 'chore: initialize ATM project');
    return result(commit.status ?? 1, commit.stderr || commit.error?.message || '', commit.stdout);
}
function installTargetRuntime(targetRoot, packageSpec) {
    writeFileSync(path.join(targetRoot, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
    const npmCli = process.env.npm_execpath?.endsWith('npm-cli.js')
        ? process.env.npm_execpath
        : path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const npmExecution = existsSync(npmCli)
        ? { command: process.execPath, argsPrefix: [npmCli], display: 'npm', source: 'npm-dist-tag', cwd: targetRoot }
        : { command: 'npm', argsPrefix: [], display: 'npm', source: 'npm-dist-tag', cwd: targetRoot };
    const step = runAtmStep('runtime install', npmExecution, ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', packageSpec]);
    if (step.exitCode !== 0)
        return { step };
    try {
        const packageRoot = path.join(targetRoot, 'node_modules', '@ai-atomic-framework', 'cli');
        const installed = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
        const manifest = JSON.parse(readFileSync(path.join(targetRoot, 'package.json'), 'utf8'));
        const lock = JSON.parse(readFileSync(path.join(targetRoot, 'package-lock.json'), 'utf8'));
        const requestedVersion = packageSpec.slice(packageSpec.lastIndexOf('@') + 1);
        if (!['latest', 'next', 'beta', 'lts'].includes(requestedVersion) && installed.version !== requestedVersion) {
            throw new Error('Installed CLI version does not match the starter dependency.');
        }
        if (installed.name !== '@ai-atomic-framework/cli' || typeof installed.version !== 'string'
            || manifest.dependencies?.[installed.name] !== installed.version
            || lock.packages?.['node_modules/@ai-atomic-framework/cli']?.version !== installed.version
            || typeof installed.bin?.atm !== 'string')
            throw new Error('Target runtime is not an exact locked official CLI dependency.');
        const binPath = realpathSync(path.resolve(packageRoot, installed.bin.atm));
        const relative = path.relative(realpathSync(packageRoot), binPath);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
            throw new Error('Target CLI bin is outside its package.');
        const launcher = path.join(targetRoot, 'atm.mjs');
        const importPath = `./${path.relative(targetRoot, binPath).replace(/\\/g, '/')}`;
        writeFileSync(launcher, `#!/usr/bin/env node\nimport ${JSON.stringify(importPath)};\n`);
        return { step, execution: {
                command: process.execPath, argsPrefix: [launcher], display: 'node atm.mjs', source: 'target-dependency',
                runtimeVersion: installed.version, cwd: targetRoot,
                env: { ...process.env, ATM_PINNED_RUNNER_SOURCE: launcher }
            } };
    }
    catch (error) {
        return { step: { ...step, exitCode: 1, stderr: error instanceof Error ? error.message : String(error) } };
    }
}
function parseArgs(argv) {
    const args = [...argv];
    if (args.some(arg => arg.startsWith('--cli-version=')))
        throwUsage('Use --cli-version <exact-semver>; inline values are not supported.');
    const projectName = args.find((arg) => !arg.startsWith('-'));
    if (!projectName) {
        throwUsage('Usage: create-atm <project-name> [--agent <pack-id>] [--cwd <dir>] [--tag latest|next|beta|lts] [--cli-version <exact-semver>] [--json]');
    }
    const tag = parseDistTag(readOption(args, '--tag') ?? 'latest');
    const versionArg = readOption(args, '--cli-version');
    if (args.filter(arg => arg === '--cli-version').length > 1)
        throwUsage('--cli-version may only be provided once.');
    const cliVersion = versionArg === undefined ? undefined : parseExactCliVersion(versionArg, tag);
    return {
        projectName,
        cwd: path.resolve(readOption(args, '--cwd') ?? process.cwd()),
        agent: readOption(args, '--agent'),
        tag,
        cliVersion,
        json: args.includes('--json') || !process.stdout.isTTY
    };
}
function readOption(args, name) {
    const index = args.indexOf(name);
    if (index < 0)
        return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith('-')) {
        throwUsage(`${name} requires a value.`);
    }
    return value;
}
export function parseExactCliVersion(value, tag) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
    const prerelease = match?.[4]?.split('.') ?? [];
    if (!match || prerelease.some(part => /^\d+$/.test(part) && !/^(0|[1-9]\d*)$/.test(part)))
        throwUsage('--cli-version requires one exact semver, not a tag, range, package, path or URL.');
    const allowed = tag === 'latest' ? prerelease.length === 0
        : tag === 'next' ? prerelease[0] === 'beta'
            : tag === 'beta' ? prerelease[0] === 'alpha'
                : prerelease.length === 0 || prerelease[0] === 'lts';
    if (!allowed)
        throwUsage(`--cli-version prerelease does not match the ${tag} release channel.`);
    return value;
}
function parseDistTag(value) {
    if (value === 'latest' || value === 'next' || value === 'beta' || value === 'lts') {
        return value;
    }
    throwUsage(`--tag must be one of: latest, next, beta, lts. Got: ${value}`);
}
function throwUsage(message) {
    process.stderr.write(`[create-atm] ${message}\n`);
    process.exit(2);
}
function ensureCreatableTarget(targetRoot) {
    if (!existsSync(targetRoot))
        return;
    const entries = readdirSync(targetRoot);
    if (entries.length > 0) {
        process.stderr.write(`[create-atm] target directory is not empty: ${targetRoot}\n`);
        process.exit(2);
    }
}
function resolveCreateAtmDistTag(tag, explicitTag, cliVersion) {
    const table = {
        latest: { tier: 'stable', expectedCliPrerelease: null },
        next: { tier: 'beta', expectedCliPrerelease: 'beta' },
        beta: { tier: 'experimental', expectedCliPrerelease: 'alpha' },
        lts: { tier: 'lts', expectedCliPrerelease: null }
    };
    let packageVersion = cliVersion ?? tag;
    if (!explicitTag && cliVersion === undefined) {
        const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        const declared = manifest.dependencies?.['@ai-atomic-framework/cli'];
        if (typeof declared !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(declared)) {
            throwUsage('create-atm must declare an exact CLI dependency; use --tag explicitly to select a release channel.');
        }
        packageVersion = declared;
    }
    return {
        schemaVersion: 'atm.distTagSelection.v0.1',
        requestedTag: tag,
        ...table[tag],
        npmPackageSpec: `@ai-atomic-framework/cli@${packageVersion}`,
        source: 'create-atm'
    };
}
function writeDistTagSelection(targetRoot, selection) {
    const selectionPath = path.join(targetRoot, '.atm', 'runtime', 'dist-tag.json');
    mkdirSync(path.dirname(selectionPath), { recursive: true });
    writeFileSync(selectionPath, `${JSON.stringify(selection, null, 2)}\n`, 'utf8');
}
function resolveAtmExecutionPlan(tag) {
    try {
        const cliIndexPath = fileURLToPath(import.meta.resolve('@ai-atomic-framework/cli'));
        const packagedEntrypoint = path.join(path.dirname(cliIndexPath), 'atm.mjs');
        if (existsSync(packagedEntrypoint) && tag === 'latest') {
            return {
                command: process.execPath,
                argsPrefix: [packagedEntrypoint],
                display: packagedEntrypoint,
                source: 'packaged-dependency'
            };
        }
    }
    catch {
        // Fall through to source-tree lookup.
    }
    const sourceTreeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const sourceEntrypoint = path.join(sourceTreeRoot, 'atm.mjs');
    if (existsSync(sourceEntrypoint)) {
        return {
            command: process.execPath,
            argsPrefix: [sourceEntrypoint],
            display: sourceEntrypoint,
            source: 'source-tree'
        };
    }
    if (tag !== 'latest') {
        const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        return {
            command: npxCommand,
            argsPrefix: ['--yes', `@ai-atomic-framework/cli@${tag}`, 'atm'],
            display: `${npxCommand} --yes @ai-atomic-framework/cli@${tag} atm`,
            source: 'npm-dist-tag'
        };
    }
    process.stderr.write('[create-atm] unable to locate ATM CLI entrypoint.\n');
    process.exit(1);
}
function runAtmStep(name, atmExecution, args) {
    const startedAt = Date.now();
    const child = spawnSync(atmExecution.command, [...atmExecution.argsPrefix, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        cwd: atmExecution.cwd,
        env: atmExecution.env,
        timeout: 180_000
    });
    return {
        name,
        exitCode: child.status ?? 1,
        stdout: child.stdout ?? '',
        stderr: child.stderr ?? '',
        durationMs: Date.now() - startedAt
    };
}
function writePayload(payload, json) {
    if (json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
    }
    const message = payload.messages?.[0]?.text ?? 'create-atm complete.';
    process.stdout.write(`[create-atm] ${message}\n`);
}
const isDirectRun = process.argv[1]
    ? realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    : false;
if (isDirectRun) {
    process.exitCode = runCreateAtm();
}
