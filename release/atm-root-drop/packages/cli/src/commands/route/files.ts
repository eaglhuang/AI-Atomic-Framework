import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.ts';

export function routeContextDir(cwd: string) {
  return path.join(cwd, '.atm', 'runtime', 'routes');
}

export function routeContextPath(cwd: string, routeId: string) {
  return path.join(routeContextDir(cwd), `${sanitizeRouteFileName(routeId)}.json`);
}

export function routeFreezeRuntimePath(cwd: string, routeId: string) {
  return path.join(routeContextDir(cwd), `${sanitizeRouteFileName(routeId)}.freeze.json`);
}

export function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function relativePath(cwd: string, filePath: string) {
  return path.relative(cwd, filePath).replace(/\\/g, '/');
}

export function sanitizeRouteToken(value: string) {
  return value.replace(/[^A-Za-z0-9._:-]+/g, '-');
}

export function sanitizeRouteFileName(routeId: string) {
  if (!routeId.startsWith('route-')) {
    throw new CliError('ATM_CLI_USAGE', 'route id must start with route-.', { exitCode: 2 });
  }
  return sanitizeRouteToken(routeId);
}

export function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function restoreBackups(cwd: string, backups: Record<string, string | null>) {
  for (const [file, content] of Object.entries(backups)) {
    const fullPath = path.resolve(cwd, file);
    if (content === null) {
      rmSync(fullPath, { force: true });
    } else {
      writeFileSync(fullPath, content, 'utf8');
    }
  }
}
