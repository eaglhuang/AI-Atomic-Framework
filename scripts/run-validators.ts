import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'scripts', 'validators.config.json');
if (!existsSync(configPath)) {
  throw new Error(`validators config missing: ${path.relative(root, configPath)}`);
}
const config: any = JSON.parse(readFileSync(configPath, 'utf8'));
const validatorMap = new Map(config.validators.map((entry: any) => [entry.name, entry]));

const parsedCli = parseCliArgs(process.argv.slice(2));
const profileConfig = resolveProfileConfig(parsedCli.profile);
const selectedNames = applyFilters(resolveProfileValidatorNames(parsedCli.profile), parsedCli.filters);
const selectedValidators = selectedNames.map((name: any) => {
  const validator = validatorMap.get(name);
  if (!validator) {
    throw new Error(`Unknown validator in profile "${parsedCli.profile}": ${name}`);
  }
  return validator;
});

if (selectedValidators.length === 0) {
  const summary = createSummary({
    profile: parsedCli.profile,
    mode: profileConfig.mode,
    filters: parsedCli.filters,
    parallel: parsedCli.parallel,
    legacy: parsedCli.legacy,
    startedAt: Date.now(),
    results: []
  });
  emitSummary(summary, parsedCli.json);
  process.exitCode = 0;
  process.exit();
}

const startedAt = Date.now();
const results = parsedCli.parallel && !parsedCli.legacy
  ? await Promise.all(selectedValidators.map((validator: any) => runValidator(validator, profileConfig.mode, { json: parsedCli.json })))
  : await runValidatorsSequential(selectedValidators, profileConfig.mode, {
      json: parsedCli.json,
      stopOnFailure: parsedCli.legacy
    });

const summary = createSummary({
  profile: parsedCli.profile,
  mode: profileConfig.mode,
  filters: parsedCli.filters,
  parallel: parsedCli.parallel && !parsedCli.legacy,
  legacy: parsedCli.legacy,
  startedAt,
  results
});
emitSummary(summary, parsedCli.json);
process.exitCode = summary.failed > 0 ? 1 : 0;

function parseCliArgs(argv: any) {
  const positional: string[] = [];
  const options: {
    filters: string[];
    parallel: boolean;
    json: boolean;
    legacy: boolean;
  } = {
    filters: [],
    parallel: false,
    json: false,
    legacy: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--filter') {
      const value = argv[index + 1];
      const valueText = String(value ?? '');
      if (!valueText || valueText.startsWith('--')) {
        throw new Error('--filter requires a value');
      }
      options.filters.push(...valueText.split(',').map((entry: any) => entry.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg === '--parallel') {
      options.parallel = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--legacy') {
      options.legacy = true;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unsupported option: ${arg}`);
    }
    positional.push(arg);
  }

  return {
    profile: positional[0] ?? 'standard',
    ...options
  };
}

function resolveProfileConfig(profileName: any) {
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown validator profile: ${profileName}`);
  }
  return profile;
}

function resolveProfileValidatorNames(profileName: any): string[] {
  const profile = resolveProfileConfig(profileName);
  const inherited: string[] = profile.extends ? resolveProfileValidatorNames(profile.extends) : [];
  return [...new Set([...inherited, ...(profile.validators ?? [])])];
}

function applyFilters(validatorNames: any, filters: any) {
  if (!filters || filters.length === 0) {
    return validatorNames;
  }
  return validatorNames.filter((name: any) => {
    const entry: any = validatorMap.get(name);
    if (!entry) {
      return false;
    }
    return filters.some((filter: any) => {
      if (filter.startsWith('tag:')) {
        const tag = filter.slice(4).toLowerCase();
        return (entry.tags ?? []).some((candidate: any) => String(candidate).toLowerCase() === tag);
      }
      const needle = filter.toLowerCase();
      const byName = name.toLowerCase().includes(needle);
      const byTag = (entry.tags ?? []).some((candidate: any) => String(candidate).toLowerCase().includes(needle));
      return byName || byTag;
    });
  });
}

async function runValidatorsSequential(validators: any, mode: any, options: any) {
  const results: any[] = [];
  for (const validator of validators) {
    const result = await runValidator(validator, mode, options);
    results.push(result);
    if (options.stopOnFailure && result.ok !== true) {
      break;
    }
  }
  return results;
}

function runValidator(validator: any, mode: any, options: any): Promise<any> {
  return new Promise<any>((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ['--experimental-strip-types', path.join(root, validator.entry), '--mode', mode], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      const ok = (code ?? 1) === 0;
      if (!options.json) {
        if (stdout) {
          process.stdout.write(stdout);
        }
        if (stderr) {
          process.stderr.write(stderr);
        }
      }
      resolve({
        name: validator.name,
        entry: validator.entry,
        tags: validator.tags ?? [],
        slow: validator.slow === true,
        mode,
        ok,
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

function createSummary({ profile, mode, filters, parallel, legacy, startedAt, results }: any) {
  const durationMs = Date.now() - startedAt;
  const passed = results.filter((entry: any) => entry.ok === true).length;
  const failed = results.length - passed;
  return {
    profile,
    mode,
    total: results.length,
    passed,
    failed,
    durationMs,
    filters,
    parallel,
    legacy,
    validators: results
  };
}

function emitSummary(summary: any, jsonMode: any) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  const status = summary.failed === 0 ? 'ok' : 'failed';
  process.stdout.write(`[validators:${summary.profile}] ${status} (passed=${summary.passed}, failed=${summary.failed}, total=${summary.total}, durationMs=${summary.durationMs})\n`);
}
