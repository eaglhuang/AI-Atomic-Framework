import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const fixtureRoot = path.join(repoRoot, 'fixtures', 'git-boundary');

function readFixture(relativePath: string) {
  return readFileSync(path.join(fixtureRoot, relativePath), 'utf8');
}

export const gitBoundaryFixtures = {
  allow: {
    remoteOnly: readFixture(path.join('allow', 'remote-only.txt')),
    localOnly: readFixture(path.join('allow', 'local-only.txt'))
  },
  json: {
    blockBase: readFixture(path.join('json', 'block-base.json')),
    blockRemote: readFixture(path.join('json', 'block-remote.json')),
    blockLocal: readFixture(path.join('json', 'block-local.json')),
    composerBase: readFixture(path.join('json', 'composer-base.json')),
    composerRemote: readFixture(path.join('json', 'composer-remote.json')),
    composerLocal: readFixture(path.join('json', 'composer-local.json')),
    invalidBefore: readFixture(path.join('json', 'invalid-before.json')),
    invalidAfter: readFixture(path.join('json', 'invalid-after.json'))
  },
  atomMap: {
    ownerShardBase: readFixture(path.join('atom-map', 'owner-shard-base.json')),
    ownerShardUpdated: readFixture(path.join('atom-map', 'owner-shard-updated.json'))
  },
  text: {
    sampleBefore: readFixture(path.join('text', 'sample-before.ts')),
    sampleAfter: readFixture(path.join('text', 'sample-after.ts'))
  }
} as const;

export function resolveGitBoundaryFixtureRoot() {
  return fixtureRoot;
}
