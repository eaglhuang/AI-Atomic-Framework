import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistryDocumentFile, writeRegistryArtifacts } from '../packages/core/src/registry/registry.ts';
import { syncProtectedSurfaceDigests } from './hash-protected-surfaces.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(root, 'atomic-registry.json');

const digestSync = syncProtectedSurfaceDigests(root);

const validation = validateRegistryDocumentFile(registryPath);
if (!validation.ok) {
  console.error(`[sync-registry-artifacts] registry validation failed: ${validation.promptReport?.summary || 'unknown error'}`);
  process.exit(1);
}

const registryDocument = JSON.parse(readFileSync(registryPath, 'utf8'));
const written = writeRegistryArtifacts(registryDocument, {
  repositoryRoot: root,
  registryPath,
  catalogPath: 'atomic_workbench/registry-catalog.md'
});

console.log(`[sync-registry-artifacts] synced ${digestSync.touched.length} protected surfaces and wrote ${written.registryPath} and ${written.catalogPath}`);
