#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICE_ROLE_IDS, POLICE_ROLE_REGISTRY } from '../packages/core/src/police/role-registry.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policeDir = path.join(root, 'packages/core/src/police');
const rolesDir = path.join(policeDir, 'roles');
const familyPath = path.join(policeDir, 'family.ts');
const typesPath = path.join(policeDir, 'types.ts');

function fail(message: string): never {
  console.error(`[validate-police-atomic-map] ${message}`);
  process.exit(1);
}

function lineCount(filePath: string): number {
  return readFileSync(filePath, 'utf8').split(/\r?\n/).length;
}

const expectedRoles = [
  'dedup',
  'demand',
  'quality',
  'map-integration',
  'atomization',
  'decomposition',
  'evolution',
  'polymorph',
  'rollback',
  'evidence-integrity',
  'reversibility',
  'noise-control',
  'adopter-neutrality'
] as const;

for (const role of expectedRoles) {
  const rolePath = path.join(rolesDir, `${role}.ts`);
  if (!existsSync(rolePath)) fail(`missing role module: roles/${role}.ts`);
}

const roleFiles = readdirSync(rolesDir).filter((name) => name.endsWith('.ts'));
if (roleFiles.length !== 13) fail(`expected 13 role files, found ${roleFiles.length}`);

const familyLines = lineCount(familyPath);
if (familyLines >= 500) fail(`family.ts must be under 500 lines, found ${familyLines}`);

if (POLICE_ROLE_IDS.length !== 13) fail(`registry must contain 13 roles, found ${POLICE_ROLE_IDS.length}`);
if (POLICE_ROLE_REGISTRY.length !== 13) fail(`registry entries must be 13, found ${POLICE_ROLE_REGISTRY.length}`);
for (let i = 0; i < expectedRoles.length; i += 1) {
  if (POLICE_ROLE_IDS[i] !== expectedRoles[i]) {
    fail(`registry order mismatch at ${i}: expected ${expectedRoles[i]}, got ${POLICE_ROLE_IDS[i]}`);
  }
}

const typesSource = readFileSync(typesPath, 'utf8');
const familySource = readFileSync(familyPath, 'utf8');
const requiredTypeExports = [
  'PoliceFinding',
  'PoliceFamilyReport',
  'PoliceFamilyGateReport',
  'DedupPoliceInput',
  'DemandPoliceInput',
  'QualityPoliceInput',
  'PolymorphPoliceInput',
  'RollbackPoliceInput',
  'SharedGateReport'
];
for (const name of requiredTypeExports) {
  if (!typesSource.includes(`export interface ${name}`) && !typesSource.includes(`export type ${name}`)) {
    fail(`types.ts must export ${name}`);
  }
}
if (!familySource.includes("export type * from './types.ts'")) {
  fail('family.ts must re-export types.ts');
}

const reportPath = path.join(root, 'docs/reports/police-family-atomic-map.md');
if (!existsSync(reportPath)) fail('missing docs/reports/police-family-atomic-map.md');

console.log(
  JSON.stringify(
    {
      ok: true,
      familyLines,
      roleCount: 13,
      roles: [...POLICE_ROLE_IDS]
    },
    null,
    2
  )
);
