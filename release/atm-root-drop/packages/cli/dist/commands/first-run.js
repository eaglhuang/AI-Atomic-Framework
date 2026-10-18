import { resolveRuntimePackage } from './shared/runtime-build-identity.js';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { readIdentityJson, inspectFrameworkIdentity } from '../_vendor/core/dist/project/framework-identity.js';
import { getCommandSpec } from './command-specs.js';
import { supportedAgentIds } from './setup/detection.js';
import { inspectFirstRunTarget } from './first-run/target-state.js';
const entryCommands = ['setup', 'bootstrap', 'next', 'doctor', 'framework-mode', 'taskflow', 'integration'];
const entryFlags = new Set(['--cwd', '--agents', '--dry-run', '--json', '--prompt']);
const rootHelpValueFlags = new Set(['--cwd', '--prompt', '--agents', '--fields', '--output-json']);
/** Preserve legacy help subcommands while excluding values of root-help flags. */
export function rootHelpSubcommand(argv) {
    for (let i = 0; i < argv.length; i += 1) {
        if (rootHelpValueFlags.has(argv[i])) {
            i += 1;
            continue;
        }
        if (!argv[i].startsWith('-'))
            return argv[i];
    }
    return undefined;
}
/** Commands come from the loaded CLI runner registry, not a version threshold or
 * the larger documentation spec registry. No external program is probed. */
export function resolveFirstRunRuntime(commandNames, moduleUrl, entrypoint = process.argv[1], env = process.env) {
    const commands = Object.fromEntries(entryCommands.filter(name => commandNames.includes(name))
        .map(name => [name, (getCommandSpec(name)?.options ?? []).map(option => option.flag).filter(flag => entryFlags.has(flag))]));
    const packageIdentity = resolveRuntimePackage(moduleUrl);
    const installationRoot = packageIdentity?.installationRoot ?? null;
    const version = packageIdentity?.version ?? null;
    let runner = null;
    if (installationRoot && entrypoint) {
        const actual = canonical(entrypoint);
        const candidates = ['src/atm.ts', 'src/atm-public.ts', 'dist/atm.js', 'dist/atm-public.js', 'dist/npm-runtime/atm.mjs']
            .map(relative => path.join(installationRoot, relative));
        const frameworkRoot = path.resolve(installationRoot, '../..');
        const frameworkKind = inspectFrameworkIdentity(frameworkRoot).kind;
        if (frameworkKind === 'framework') {
            candidates.push(path.join(frameworkRoot, 'atm.dev.mjs'), path.join(frameworkRoot, 'atm.mjs'));
        }
        const release = frameworkKind === 'distribution' ? readIdentityJson(path.join(frameworkRoot, 'release-manifest.json')) : null;
        if (release?.entrypoint === 'atm.mjs')
            candidates.push(path.join(frameworkRoot, 'atm.mjs'));
        if (actual && candidates.some(candidate => canonical(candidate) === actual)) {
            // A recognized direct runner ignores stale onefile environment hints.
            runner = actual;
        }
        else if (actual && matchesOnefileProvenance(actual, installationRoot, env)) {
            runner = actual;
        }
    }
    return { status: !version ? 'inconsistent-runtime' : !runner ? 'unknown-entrypoint' : 'available',
        version, versionSource: version ? 'runtime-package' : 'unavailable', installationRoot, runner, commands };
}
export function createFirstRunContract(argv, runtime) {
    const parsed = readEntryOptions(argv);
    let target = inspectFirstRunTarget(parsed.cwd);
    if (runtime.installationRoot && target.root && within(target.root, runtime.installationRoot)) {
        target = { ...target, state: 'runtime-distribution', reason: 'Select a governed project, not the CLI installation.' };
    }
    const requires = [];
    let nextAction = null;
    const supports = (command, ...flags) => Object.hasOwn(runtime.commands, command)
        && flags.every(flag => runtime.commands[command].includes(flag));
    const action = (command, args, readOnly, reason, prerequisites = []) => {
        if (!runtime.runner || !target.root)
            return;
        nextAction = { executable: process.execPath, args: [runtime.runner, command, ...args], cwd: target.root, readOnly,
            requires: prerequisites, reason };
    };
    const targetArgs = target.root ? ['--cwd', target.root, '--json'] : [];
    if (parsed.invalid.length)
        requires.push(...parsed.invalid);
    else if (runtime.status !== 'available')
        requires.push('Use a verified ATM runner entrypoint; imported library/test harness paths are not executable ATM routes.');
    else if (['selection-required', 'missing-target', 'unsafe-target', 'runtime-distribution', 'ambiguous-identity'].includes(target.state))
        requires.push(target.reason);
    else if (target.identity?.kind === 'framework' && !supports('framework-mode')) {
        requires.push('This target is the ATM framework, but this runtime lacks framework-mode. Select the framework runner; do not retry unsupported commands.');
    }
    else if (target.state === 'invalid-config' || target.state === 'legacy-layout') {
        if (supports('doctor', '--cwd', '--json'))
            action('doctor', targetArgs, true, target.reason);
        else
            requires.push('Inspect and preserve the reported metadata; this runtime has no supported diagnostic route.');
    }
    else if ((target.state === 'uninitialized' || target.state === 'partial') && supports('setup', '--cwd', '--agents', '--dry-run', '--json')) {
        if (!parsed.agents)
            requires.push(`Select supported agents (${supportedAgentIds.join(', ')}) or explicitly choose none; rerun this help with --agents.`);
        else
            action('setup', [...targetArgs, '--agents', parsed.agents, '--dry-run'], true, 'Run the official target/content safety preflight; the preview does not initialize or repair the project.');
    }
    else if (target.state === 'uninitialized' || target.state === 'partial') {
        if (supports('bootstrap', '--cwd', '--json')) {
            action('bootstrap', ['--help', '--json'], true, 'Legacy help only. Before a later bootstrap write, require authoritative target/content safety preflight and project setup authorization; preserve user content and never add --force.');
        }
        else
            requires.push('Select an official runtime with bootstrap/setup; no installation or upgrade is performed by help.');
    }
    else if (target.state === 'ready') {
        if (supports('next', '--cwd', '--prompt', '--json') && parsed.prompt) {
            action('next', [...targetArgs, '--prompt', parsed.prompt], true, 'Ask the existing router for the current request; consume its playbook before any write.', ['This action grants no claim, scope, identity, or write authority']);
        }
        else if (supports('next', '--cwd', '--json')) {
            action('next', targetArgs, true, 'Read-only orientation. Supply --prompt to this help for the user-requested route.');
        }
        else
            requires.push('The loaded runtime has no supported next route; select a compatible official runtime.');
    }
    return { schemaId: 'atm.firstRun.v1', specVersion: '0.1.0', readOnly: true, authority: 'advisory-only', runtime, target,
        versionRelation: target.recordedVersion && runtime.version ? target.recordedVersion === runtime.version ? 'same' : 'different' : 'unknown',
        versionMeaning: 'Recorded target version is historical metadata; actual command capabilities come from this loaded runtime.',
        nextAction, requires };
}
function readEntryOptions(argv) {
    const output = { cwd: null, prompt: null, agents: null, invalid: [] };
    for (const flag of ['--cwd', '--prompt', '--agents']) {
        const indexes = argv.flatMap((value, index) => value === flag ? [index] : []);
        if (!indexes.length)
            continue;
        const value = argv[indexes[0] + 1];
        if (indexes.length > 1 || !value?.trim() || value.startsWith('--')) {
            output.invalid.push(`Provide exactly one nonempty value for ${flag}.`);
            continue;
        }
        output[flag.slice(2)] = value;
    }
    if (output.agents && output.agents !== 'none') {
        const ids = [...new Set(output.agents.split(',').map(id => id.trim()))];
        if (ids.some(id => !supportedAgentIds.includes(id)))
            output.invalid.push('Use supported adapter IDs or none; do not infer agent identity from a model name.');
        else
            output.agents = ids.join(',');
    }
    return output;
}
function canonical(file) { try {
    return existsSync(file) ? realpathSync(file) : null;
}
catch {
    return null;
} }
function matchesOnefileProvenance(actual, installationRoot, env) {
    const payload = env.ATM_ONEFILE_PAYLOAD_SHA256;
    const extracted = env.ATM_ONEFILE_EXTRACTED_ROOT ? canonical(env.ATM_ONEFILE_EXTRACTED_ROOT) : null;
    if (env.ATM_ONEFILE_RUNTIME !== '1' || !payload || !/^[a-f0-9]{64}$/.test(payload) || !extracted
        || path.basename(extracted) !== payload || !env.ATM_ONEFILE_LAUNCHER_PATH
        || canonical(env.ATM_ONEFILE_LAUNCHER_PATH) !== actual
        || canonical(path.join(extracted, 'packages/cli')) !== canonical(installationRoot))
        return false;
    // The launcher already verifies payload integrity before importing this CLI.
    // These bounded observations bind the emitted persistent argv to that same
    // execution; they are not a second signature or integrity authority.
    const marker = readIdentityJson(path.join(extracted, '.payload-ready.json'));
    return marker?.schemaVersion === 'atm.onefilePayload.v0.1' && marker.payloadSha256 === payload;
}
function within(candidate, parent) {
    const relative = path.relative(parent, candidate);
    return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
