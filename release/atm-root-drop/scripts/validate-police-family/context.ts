import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorePoliceFamilies, runLifecyclePolice, runPoliceChecks, type PoliceFamilyReport } from './deps.ts';

export interface PoliceFamilyContext {
  readonly root: string;
  readonly mode: string;
  readonly fixture: any;
  readonly sharedCoreFamilies: PoliceFamilyReport[];
  fail(message: any): void;
  check(condition: any, message: any): void;
  readJson(relativePath: any): any;
  readText(relativePath: any): string;
  materializeCuratorInput(fixturePath: string): any;
  buildCoreFamilies(options: { mapFixture: any; layerPolicy: any; importGraph: any; registryGate: any; lifecycleInput: any; }): PoliceFamilyReport[];
}

export function createPoliceFamilyContext(): PoliceFamilyContext {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const mode = process.argv.includes('--mode')
    ? process.argv[process.argv.indexOf('--mode') + 1]
    : 'validate';

  function fail(message: any) {
    console.error(`[police-family:${mode}] ${message}`);
    process.exitCode = 1;
  }

  function check(condition: any, message: any) {
    if (!condition) {
      fail(message);
    }
  }

  function readJson(relativePath: any) {
    return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
  }

  function readText(relativePath: any) {
    return readFileSync(path.join(root, relativePath), 'utf8');
  }

  const fixture = readJson('tests/police.fixture.json');

  function materializeCuratorInput(fixturePath: string) {
    const curatorFixture = readJson(fixturePath);
    return {
      ...curatorFixture.input,
      repositoryRoot: root
    };
  }

  function buildCoreFamilies(options: { mapFixture: any; layerPolicy: any; importGraph: any; registryGate: any; lifecycleInput: any; }) {
    const policeReport = runPoliceChecks({
      lifecycleMode: 'evolution',
      mapFixture: options.mapFixture,
      layerPolicy: options.layerPolicy,
      importGraph: options.importGraph,
      forbiddenPatterns: fixture.forbiddenImport.forbiddenPatterns,
      registryGate: options.registryGate
    });
    const lifecycleReport = runLifecyclePolice(options.lifecycleInput);
    return buildCorePoliceFamilies({
      policeReport,
      lifecycleReport: lifecycleReport as unknown as Record<string, unknown>
    });
  }

  const sharedCoreFamilies = buildCoreFamilies({
    mapFixture: readJson(fixture.dependencyGraph.positivePath),
    layerPolicy: readJson(fixture.layerBoundary.policyPath),
    importGraph: readJson(fixture.layerBoundary.positivePath),
    registryGate: readJson(fixture.registryGate.positivePath),
    lifecycleInput: readJson(fixture.lifecyclePolice.positivePath)
  });

  return { root, mode, fixture, sharedCoreFamilies, fail, check, readJson, readText, materializeCuratorInput, buildCoreFamilies };
}
