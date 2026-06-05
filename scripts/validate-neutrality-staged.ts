import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runHook } from '../packages/cli/src/commands/hook.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = path.join(root, '.atm-temp', 'validate-neutrality-staged-sandbox');

function fail(message: string) {
  console.error(`[neutrality-staged:validate] ${message}`);
  process.exitCode = 1;
}

function check(condition: boolean, message: string) {
  if (!condition) {
    fail(message);
  }
}

// 1. Cleanup and create temp sandbox
if (existsSync(tempDir)) {
  rmSync(tempDir, { recursive: true, force: true });
}
mkdirSync(tempDir, { recursive: true });

// Helper to run git commands
function runGit(args: string[]) {
  const result = spawnSync('git', args, { cwd: tempDir, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Git command failed: git ${args.join(' ')}\n${result.stderr}`);
  }
}

try {
  // 2. Init git repo
  runGit(['init']);
  runGit(['config', 'user.name', 'ATM Validator']);
  runGit(['config', 'user.email', 'atm@example.invalid']);

  // 3. Setup neutrality policy
  const policyDir = path.join(tempDir, 'docs', 'governance');
  mkdirSync(policyDir, { recursive: true });
  const policyContent = {
    protectedFiles: [],
    protectedScopes: [
      {
        pathPrefix: "packages/core/src",
        extensions: [".ts"]
      }
    ],
    bannedTerms: ["eaglhuang/3KLife"],
    bannedPathPatterns: ["<non-ascii-filename>"],
    ignoredPrefixes: []
  };
  writeFileSync(
    path.join(policyDir, 'docs-neutrality-policy.json'),
    JSON.stringify(policyContent, null, 2),
    'utf8'
  );

  // 4. Create safe file and git add
  const srcDir = path.join(tempDir, 'packages', 'core', 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(path.join(srcDir, 'safe.ts'), 'export const hello = "world";', 'utf8');
  runGit(['add', 'packages/core/src/safe.ts']);

  // 5. Test 1: pre-commit hook with only safe staged file should pass
  const result1 = runHook(['pre-commit', '--cwd', tempDir]);
  check(result1.ok === true, 'pre-commit hook should pass with only safe file staged');

  // 6. Create unsafe file but do NOT git add (only in worktree)
  const unsafePath = path.join(srcDir, 'unsafe.ts');
  writeFileSync(unsafePath, 'export const name = "eaglhuang/3KLife";', 'utf8');

  // 7. Test 2: pre-commit hook should pass when unsafe file is NOT staged
  const result2 = runHook(['pre-commit', '--cwd', tempDir]);
  check(result2.ok === true, 'pre-commit hook should pass when unsafe file is NOT staged');

  // 8. git add unsafe.ts
  runGit(['add', 'packages/core/src/unsafe.ts']);

  // 9. Test 3: pre-commit hook should fail since unsafe.ts is staged
  const result3: any = runHook(['pre-commit', '--cwd', tempDir]);
  check(result3.ok === false, 'pre-commit hook should fail when unsafe file is staged');
  check(
    Boolean(result3.evidence?.neutralityReport?.findings?.length > 0),
    'evidence neutralityReport should contain findings'
  );
  const termFinding = result3.evidence.neutralityReport.findings.find(
    (f: any) => f.kind === 'term' && f.file === 'packages/core/src/unsafe.ts'
  );
  check(termFinding !== undefined, 'findings should report term violation in unsafe.ts');

  // 10. Modify unsafe.ts in worktree to be safe, but do NOT git add (staged remains unsafe)
  writeFileSync(unsafePath, 'export const name = "neutral";', 'utf8');

  // 11. Test 4: pre-commit hook should still fail because it must read from git index
  const result4 = runHook(['pre-commit', '--cwd', tempDir]);
  check(result4.ok === false, 'pre-commit hook should fail because git index is still unsafe');

  console.log('[neutrality-staged:validate] ok (staged-only validation cases passed)');
} catch (error: any) {
  fail(`Exception occurred: ${error.message}\n${error.stack}`);
} finally {
  // Cleanup temp sandbox
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
