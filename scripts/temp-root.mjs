import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createTempWorkspace(prefix) {
  const baseRoot = resolveTempBaseRoot();
  mkdirSync(baseRoot, { recursive: true });
  const workspacePath = path.join(
    baseRoot,
    `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

function resolveTempBaseRoot() {
  const explicitRoot = process.env.ATM_TEMP_ROOT;
  if (explicitRoot) {
    return explicitRoot;
  }
  const repoLocalRoot = path.join(process.cwd(), '.atm-temp');
  if (existsSync(process.cwd())) {
    return repoLocalRoot;
  }
  return os.tmpdir();
}
