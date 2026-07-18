import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.js';
export function routeContextDir(cwd) {
    return path.join(cwd, '.atm', 'runtime', 'routes');
}
export function routeContextPath(cwd, routeId) {
    return path.join(routeContextDir(cwd), `${sanitizeRouteFileName(routeId)}.json`);
}
export function routeFreezeRuntimePath(cwd, routeId) {
    return path.join(routeContextDir(cwd), `${sanitizeRouteFileName(routeId)}.freeze.json`);
}
export function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export function relativePath(cwd, filePath) {
    return path.relative(cwd, filePath).replace(/\\/g, '/');
}
export function sanitizeRouteToken(value) {
    return value.replace(/[^A-Za-z0-9._:-]+/g, '-');
}
export function sanitizeRouteFileName(routeId) {
    if (!routeId.startsWith('route-')) {
        throw new CliError('ATM_CLI_USAGE', 'route id must start with route-.', { exitCode: 2 });
    }
    return sanitizeRouteToken(routeId);
}
export function unique(values) {
    return [...new Set(values.filter(Boolean))];
}
export function restoreBackups(cwd, backups) {
    for (const [file, content] of Object.entries(backups)) {
        const fullPath = path.resolve(cwd, file);
        if (content === null) {
            rmSync(fullPath, { force: true });
        }
        else {
            writeFileSync(fullPath, content, 'utf8');
        }
    }
}
