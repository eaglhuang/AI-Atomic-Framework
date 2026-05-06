import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError, makeResult, message, parseOptions, relativePathFrom } from './shared.mjs';
import { runValidate } from './validate.mjs';

const helloWorldSpecPath = path.join('examples', 'hello-world', 'atoms', 'hello-world.atom.json');
const helloWorldSourcePath = path.join('examples', 'hello-world', 'src', 'hello-world.atom.mjs');

export async function runHelloWorldSmoke(cwd) {
  const specPath = path.join(cwd, helloWorldSpecPath);
  const sourcePath = path.join(cwd, helloWorldSourcePath);
  const checks = [];

  checks.push({ name: 'spec-exists', passed: existsSync(specPath) });
  checks.push({ name: 'source-exists', passed: existsSync(sourcePath) });

  const validation = runValidate(['--cwd', cwd, '--spec', specPath]);
  checks.push({ name: 'spec-validates', passed: validation.ok === true });

  let smokeResult = null;
  if (existsSync(sourcePath)) {
    const module = await import(`${pathToFileURL(sourcePath).href}?selfHostSmoke=${Date.now()}`);
    smokeResult = module.run({ name: 'ATM' });
  }
  checks.push({ name: 'message-output', passed: smokeResult?.message === 'Hello, ATM!' });
  checks.push({ name: 'atom-id-output', passed: smokeResult?.atomId === 'atom.example.hello-world' });

  return {
    ok: checks.every((check) => check.passed),
    checks,
    passCount: checks.filter((check) => check.passed).length,
    total: checks.length,
    specPath: helloWorldSpecPath,
    sourcePath: helloWorldSourcePath,
    smokeResult
  };
}

export async function runTestAsync(argv) {
  const { options } = parseOptions(argv, 'test');
  if (options.atom !== 'hello-world') {
    throw new CliError('ATM_CLI_USAGE', 'test requires --atom hello-world', { exitCode: 2 });
  }
  const smoke = await runHelloWorldSmoke(options.cwd);
  return makeResult({
    ok: smoke.ok,
    command: 'test',
    cwd: options.cwd,
    messages: [
      smoke.ok
        ? message('info', 'ATM_TEST_HELLO_WORLD_OK', 'hello-world atom smoke validation passed.')
        : message('error', 'ATM_TEST_HELLO_WORLD_FAILED', 'hello-world atom smoke validation failed.', { checks: smoke.checks })
    ],
    evidence: {
      atom: options.atom,
      passCount: smoke.passCount,
      total: smoke.total,
      checks: smoke.checks,
      specPath: relativePathFrom(options.cwd, path.join(options.cwd, smoke.specPath)),
      sourcePath: relativePathFrom(options.cwd, path.join(options.cwd, smoke.sourcePath))
    }
  });
}
