import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export function generatedOutputDigest(cwd, file) {
    if (path.isAbsolute(file) || file.split('/').some((part) => part === '..' || part === '.git'))
        throw new Error('Unsafe generated output path');
    const parts = file.split('/');
    for (let i = 1; i <= parts.length; i++) {
        const info = lstatSync(path.join(cwd, ...parts.slice(0, i)));
        if (info.isSymbolicLink())
            throw new Error('Generated output digest cannot follow a symlink');
    }
    return `sha256:${createHash('sha256').update(readFileSync(path.join(cwd, file))).digest('hex')}`;
}
export function ignoredGeneratedOutputs(cwd, files) {
    if (!files.length)
        return new Set();
    const env = { ...process.env };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX'])
        delete env[key];
    const dir = mkdtempSync(path.join(os.tmpdir(), 'atm-generated-input-'));
    let fd;
    try {
        const file = path.join(dir, 'paths');
        writeFileSync(file, `${files.join('\0')}\0`);
        fd = openSync(file, 'r');
        const output = execFileSync('git', ['check-ignore', '--stdin', '-z', '--no-index'], {
            cwd, env, encoding: 'utf8', stdio: [fd, 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024
        });
        return new Set(output.split('\0').filter(Boolean));
    }
    catch (error) {
        if (error.status === 1)
            return new Set();
        throw error;
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
        rmSync(dir, { recursive: true, force: true });
    }
}
