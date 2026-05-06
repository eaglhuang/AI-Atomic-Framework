import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'tests', 'package-skeleton.fixture.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

for (const packageSpec of fixture.packages) {
  console.log(`${packageSpec.name}\t${packageSpec.directory}\t${packageSpec.role}`);
}