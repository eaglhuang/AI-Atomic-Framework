// Resolve the local ATM monorepo (AI-Atomic-Framework) for real-backend imports.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  process.env.ATM_MONOREPO,
  resolve(HERE, '../../../AI-Atomic-Framework'),
  resolve(HERE, '../../AI-Atomic-Framework'),
  '/workspace/AI-Atomic-Framework',
].filter(Boolean);

export function resolveAtmMonorepo() {
  for (const c of CANDIDATES) {
    const core = join(c, 'packages/core/src/broker/decision.ts');
    if (existsSync(core)) return c;
  }
  throw new Error(
    `ATM monorepo not found (looked for packages/core/src/broker/decision.ts). Set ATM_MONOREPO. Tried: ${CANDIDATES.join(', ')}`
  );
}

export function atmCoreBroker(subpath) {
  return join(resolveAtmMonorepo(), 'packages/core/src/broker', subpath);
}

/** Real ATM TS sources need Node ≥22 (strip-types). Prefer ATM_NODE or nvm Node 24. */
export function requireNodeForRealAtm() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    throw new Error(
      `atm_backend=real requires Node ≥22 (got ${process.versions.node}). ` +
        `Use: /workspace/.nvm/versions/node/v24.21.0/bin/node src/cli.mjs ...`
    );
  }
}

export function atmVersionLabel(root = resolveAtmMonorepo()) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'));
    return `@ai-atomic-framework/core@${pkg.version} (source:${root}/packages/core)`;
  } catch {
    return `atm-monorepo:${root}`;
  }
}
