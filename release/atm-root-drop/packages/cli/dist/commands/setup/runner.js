import path from 'node:path';
/** Ignore inherited onefile hints when a child runs a different entrypoint. */
export function setupRunnerPath(entrypoint = process.argv[1], env = process.env) {
    const actual = path.resolve(entrypoint ?? 'atm.mjs');
    if (env.ATM_ONEFILE_LAUNCHER_PATH && env.ATM_ONEFILE_EXTRACTED_ROOT) {
        const relative = path.relative(path.resolve(env.ATM_ONEFILE_EXTRACTED_ROOT), actual);
        if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
            return path.resolve(env.ATM_ONEFILE_LAUNCHER_PATH);
        }
    }
    return actual;
}
