#!/usr/bin/env node
/**
 * validate-map-spec-schema.ts
 *
 * Owner: atm.atom-map-spec-map (TASK-AAO-0023).
 *
 * Validates every `atomic_workbench/maps/**\/map.spec.json` file against
 * `schemas/atom-map.schema.json`. Fails with a non-zero exit code if any
 * map spec drifts from the schema. Exits 0 with `[map-spec-schema:<mode>]
 * ok` when all maps match.
 *
 * Modes:
 *   --mode validate   (default)   verify every map.spec.json in the repo
 *   --mode lint                   alias for validate (kept for parity with peer validators)
 *
 * Optional flags:
 *   --json                        emit a JSON summary on stdout in addition to the banner
 *   --maps-root <dir>             override the maps root (default: atomic_workbench/maps)
 *   --schema <path>               override the schema path (default: schemas/atom-map.schema.json)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface CliOptions {
  mode: 'validate' | 'lint';
  mapsRoot: string;
  schemaPath: string;
  jsonOutput: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let mode: CliOptions['mode'] = 'validate';
  let mapsRoot = path.join(repoRoot, 'atomic_workbench', 'maps');
  let schemaPath = path.join(repoRoot, 'schemas', 'atom-map.schema.json');
  let jsonOutput = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      const value = argv[index + 1];
      if (value === 'validate' || value === 'lint') {
        mode = value;
      }
      index += 1;
      continue;
    }
    if (arg === '--maps-root') {
      const value = argv[index + 1];
      if (value) mapsRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--schema') {
      const value = argv[index + 1];
      if (value) schemaPath = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      jsonOutput = true;
      continue;
    }
  }

  return { mode, mapsRoot, schemaPath, jsonOutput };
}

function listMapSpecFiles(mapsRoot: string): string[] {
  const results: string[] = [];
  if (!existsSync(mapsRoot)) return results;

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry);
      let info;
      try {
        info = statSync(absolutePath);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        walk(absolutePath);
      } else if (entry === 'map.spec.json') {
        results.push(absolutePath);
      }
    }
  };

  walk(mapsRoot);
  results.sort();
  return results;
}

function loadJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

interface Violation {
  mapFile: string;
  errors: Array<{
    instancePath: string;
    schemaPath: string;
    keyword: string;
    message: string;
    params: Record<string, unknown>;
  }>;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = options.mode;

  if (!existsSync(options.schemaPath)) {
    console.error(`[map-spec-schema:${mode}] missing schema: ${path.relative(repoRoot, options.schemaPath)}`);
    process.exit(1);
  }

  const schema = loadJson(options.schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const mapFiles = listMapSpecFiles(options.mapsRoot);
  if (mapFiles.length === 0) {
    console.error(`[map-spec-schema:${mode}] no map.spec.json files found under ${path.relative(repoRoot, options.mapsRoot)}`);
    process.exit(1);
  }

  const violations: Violation[] = [];
  for (const mapFile of mapFiles) {
    let document: unknown;
    try {
      document = loadJson(mapFile);
    } catch (err) {
      violations.push({
        mapFile,
        errors: [
          {
            instancePath: '',
            schemaPath: '',
            keyword: 'parse',
            message: `JSON parse error: ${(err as Error).message}`,
            params: {}
          }
        ]
      });
      continue;
    }

    if (!validate(document)) {
      const errors = (validate.errors ?? []).map((entry) => ({
        instancePath: entry.instancePath ?? '',
        schemaPath: entry.schemaPath ?? '',
        keyword: entry.keyword ?? '',
        message: entry.message ?? 'schema violation',
        params: (entry.params ?? {}) as Record<string, unknown>
      }));
      violations.push({ mapFile, errors });
    }
  }

  const summary = {
    schemaId: 'atm.mapSpecSchemaReport.v1',
    specVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode,
    schemaPath: path.relative(repoRoot, options.schemaPath),
    mapsRoot: path.relative(repoRoot, options.mapsRoot),
    inspectedCount: mapFiles.length,
    okCount: mapFiles.length - violations.length,
    violationCount: violations.length,
    violations: violations.map((entry) => ({
      mapFile: path.relative(repoRoot, entry.mapFile),
      errors: entry.errors
    }))
  };

  if (violations.length === 0) {
    console.log(`[map-spec-schema:${mode}] ok (${mapFiles.length} map.spec.json files validated against atom-map.schema.json)`);
    if (options.jsonOutput) {
      console.log(JSON.stringify(summary, null, 2));
    }
    process.exit(0);
  }

  console.error(`[map-spec-schema:${mode}] failed: ${violations.length} of ${mapFiles.length} map specs violate the schema`);
  for (const entry of violations) {
    const relPath = path.relative(repoRoot, entry.mapFile);
    console.error(`  ${relPath}`);
    for (const err of entry.errors.slice(0, 10)) {
      const where = err.instancePath || '(root)';
      console.error(`    [${err.keyword}] ${where}: ${err.message}`);
    }
    if (entry.errors.length > 10) {
      console.error(`    ... and ${entry.errors.length - 10} more errors`);
    }
  }
  if (options.jsonOutput) {
    console.error(JSON.stringify(summary, null, 2));
  }
  process.exit(1);
}

main();
