import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolvePinnedRunnerSource } from '../../_vendor/plugin-governance-local/dist/bootstrap/bootstrap/bootstrap-support.js';
import { safeInstallPath } from '../../_vendor/integrations-core/dist/manifest/safe-install.js';
export function sharedProjectLauncher(runtime) {
    const url = pathToFileURL(path.resolve(runtime)).href;
    return [
        '#!/usr/bin/env node',
        '// ATM shared npm runtime launcher v1',
        "import { existsSync } from 'node:fs';",
        "import { fileURLToPath } from 'node:url';",
        `const runtime = ${JSON.stringify(url)};`,
        'const entrypoint = fileURLToPath(runtime);',
        'if (!existsSync(entrypoint)) {',
        "  console.error('ATM_SHARED_RUNTIME_MISSING: restore the shared CLI at its original absolute path. To move it, inspect and rename this generated project atm.mjs to a retained backup, then rerun setup from the new stable installation.');",
        '  process.exitCode = 1;',
        '} else {',
        '  process.argv[1] = entrypoint;',
        '  await import(runtime);',
        '}',
        ''
    ].join('\n');
}
/** Resolve from this module's preserved bundle identity, never argv or an
 * environment hint. The manifest hashes establish package-entry consistency,
 * not publisher authentication or immutable pinning. */
export function verifiedNpmRuntime(moduleUrl) {
    const moduleFile = fileURLToPath(moduleUrl);
    const root = path.resolve(path.dirname(moduleFile), '../../..');
    const moduleRelativePath = path.relative(root, moduleFile).split(path.sep).join('/');
    if (!['data', 'layout'].some(layout => moduleRelativePath === `${layout}/commands/setup/project-runner.js`)) {
        throw new Error('ATM_SETUP_RUNNER_MISSING: use the installed ATM package or an official onefile runner.');
    }
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const layoutRoot = manifest.layoutRoot ?? 'layout';
    const packageRoot = path.resolve(root, '../..');
    const pkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    if (pkg.name !== '@ai-atomic-framework/cli' || pkg.bin?.atm !== 'dist/npm-runtime/atm.mjs'
        || !['data', 'layout'].includes(layoutRoot) || moduleRelativePath !== `${layoutRoot}/commands/setup/project-runner.js`
        || manifest.schemaId !== 'atm.cliNpmRuntimeManifest.v1' || manifest.moduleIdentity !== 'original-dist-relative-url'
        || manifest.entrypoints?.bin !== 'atm.mjs' || manifest.entrypoints?.runtime !== 'runtime.mjs'
        || !Array.isArray(manifest.files))
        throw new Error('ATM_SETUP_RUNTIME_IDENTITY_INVALID: shared package identity is inconsistent.');
    for (const name of ['atm.mjs', 'runtime.mjs']) {
        const records = manifest.files.filter((file) => file.path === name);
        const bytes = readFileSync(path.join(root, name));
        const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        if (records.length !== 1 || records[0].sha256 !== digest)
            throw new Error('ATM_SETUP_RUNTIME_IDENTITY_INVALID: shared package entry digest does not match its manifest.');
    }
    return path.join(root, 'atm.mjs');
}
/** Read-only launcher admission, shared by setup preview and the write boundary.
 * Source selection is the same canonical decision used by bootstrap. */
export function preflightSetupProjectRunner(cwd, moduleUrl = import.meta.url, pinnedSource = resolvePinnedRunnerSource()) {
    const projectRunner = safeInstallPath(cwd, 'atm.mjs');
    if (existsSync(projectRunner) && !lstatSync(projectRunner).isFile())
        throw new Error('ATM_SETUP_RUNNER_CONFLICT: atm.mjs must be a regular file; inspect it before retrying setup.');
    const runtime = pinnedSource ? null : verifiedNpmRuntime(moduleUrl);
    if (runtime === projectRunner || (runtime && !existsSync(runtime)))
        throw new Error('ATM_SETUP_RUNNER_MISSING: no stable external runtime is available for this project.');
    const content = pinnedSource ? readFileSync(pinnedSource.path) : Buffer.from(sharedProjectLauncher(runtime));
    const previous = existsSync(projectRunner) ? readFileSync(projectRunner) : null;
    if (previous && !previous.equals(content)) {
        throw new Error('ATM_SETUP_RUNNER_CONFLICT: preserved existing project launcher; it references a different runtime or was edited. Inspect it and, only if replacement is intended, rename it to a retained backup before rerunning setup.');
    }
    return { projectRunner, runtime, content, previous };
}
/** Npm's small bin depends on adjacent assets; only the missing-pinned-source
 * case gets a shared reference. Recheck admission immediately before writing. */
export function ensureSetupProjectRunner(cwd, status, moduleUrl = import.meta.url) {
    if (status === 'skipped-existing-different')
        throw new Error('ATM_SETUP_RUNNER_CONFLICT: preserved a different existing atm.mjs; select a compatible runtime before retrying.');
    const { projectRunner, runtime, content, previous } = preflightSetupProjectRunner(cwd, moduleUrl, status === 'source-unavailable' ? null : resolvePinnedRunnerSource());
    if (status !== 'source-unavailable') {
        if (!existsSync(projectRunner))
            throw new Error('ATM_SETUP_RUNNER_MISSING: bootstrap did not provide a project entrypoint.');
        return { mode: 'bootstrap-pinned', path: 'atm.mjs' };
    }
    if (previous === null) {
        try {
            writeFileSync(projectRunner, content, { flag: 'wx' });
        }
        catch (error) {
            if (error.code === 'EEXIST')
                throw new Error('ATM_SETUP_RUNNER_CONFLICT: preserved a project runner created concurrently; inspect it before retrying setup.');
            throw error;
        }
    }
    // Ask bootstrap itself to record pinned-runner metadata. Never hand-edit the
    // project's runtime state or mutate the hosting process's environment.
    const child = spawnSync(process.execPath, [runtime, 'bootstrap', '--cwd', cwd, '--json'], {
        cwd, env: { ...process.env, ATM_PINNED_RUNNER_SOURCE: projectRunner }, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024
    });
    if (child.status !== 0)
        throw new Error(`ATM_SETUP_RUNNER_BOOTSTRAP_FAILED: shared launcher was preserved for retry. ${child.stderr || child.stdout}`);
    const result = JSON.parse(child.stdout);
    if (result.ok !== true)
        throw new Error('ATM_SETUP_RUNNER_BOOTSTRAP_FAILED: shared launcher metadata was not verified.');
    return { mode: 'shared-npm-runtime', path: 'atm.mjs', sharedRuntimeMustRemainAvailable: true };
}
