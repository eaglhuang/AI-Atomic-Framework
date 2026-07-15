import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveNodejsTeamWorkerAdapter } from '../../../packages/core/src/team-runtime/nodejs-worker-adapter.ts';

export function runPolyglotWorkerExamplesValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'polyglot-worker-examples') return false;

  const examplesDir = path.join(process.cwd(), 'examples', 'team-runtime');
  const readme = readFileSync(path.join(examplesDir, 'README.md'), 'utf8');
  const python = readFileSync(path.join(examplesDir, 'python-reference-worker-adapter.py'), 'utf8');
  const csharp = readFileSync(path.join(examplesDir, 'csharp-reference-worker-adapter.cs'), 'utf8');
  const nodeFallback = resolveNodejsTeamWorkerAdapter({ runtimeMode: 'broker-only' });

  assert.ok(readme.includes('Node.js remains the default Team runtime'), 'README must keep Node.js as the default runtime');
  assert.ok(readme.includes('Command-backed evidence is still required before closeout'), 'README must require command-backed evidence');
  assert.ok(readme.includes('Captain-owned task lifecycle remains unchanged'), 'README must preserve closure authority');

  const requiredGovernance = [
    ...nodeFallback.brokerFallback.preservesGovernance,
    'closure-authority'
  ];

  for (const [language, content, adapterId] of [
    ['python', python, 'atm.python.reference-worker'],
    ['csharp', csharp, 'atm.csharp.reference-worker']
  ] as const) {
    assert.ok(content.includes('atm.teamWorkerAdapterContract.v1'), `${language} example must use the Team worker adapter schema`);
    assert.ok(content.includes(adapterId), `${language} example must declare its reference adapter id`);
    assert.ok(content.includes(language), `${language} example must declare runtimeLanguage`);
    assert.ok(content.includes('Node.js remains the default ATM Team runtime'), `${language} example must not claim default-runtime status`);
    assert.ok(content.includes('commandBackedEvidenceRequired') || content.includes('CommandBackedEvidenceRequired'), `${language} example must require command-backed evidence`);
    assert.ok(content.includes('closureAuthorityPreserved') || content.includes('ClosureAuthorityPreserved'), `${language} example must preserve closure authority`);
    assert.ok(content.includes('artifactContractPreserved') || content.includes('ArtifactContractPreserved'), `${language} example must preserve artifact handoff`);
    assert.ok(content.includes('retryContractPreserved') || content.includes('RetryContractPreserved'), `${language} example must preserve retry governance`);

    for (const preserved of requiredGovernance) {
      assert.ok(content.includes(preserved), `${language} example must preserve ${preserved}`);
    }
  }

  console.log('[validate-team-agents] ok (polyglot-worker-examples)');
  return true;
}
